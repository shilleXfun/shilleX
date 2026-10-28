import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { hash } from '@node-rs/argon2';
import type { WalletVerifyResult } from '@shillex/shared';
import type { Db } from '../db/client.ts';
import { userWallets, users, type UserRow } from '../db/schema.ts';
import { requireUser } from '../lib/auth.ts';
import { AppError, errors } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { isUniqueViolation } from '../lib/pg-errors.ts';
import { isReservedUsername } from '../lib/reserved.ts';
import { decodeAddress } from '../lib/siws.ts';
import { parse } from '../lib/validate.ts';
import { Username, endOtherSessions, meView, startSession, usernameTaken } from '../services/accounts.ts';
import { WalletProofBody, claimSignupToken, issueChallenge, issueSignupToken, verifyProof } from '../services/wallet-auth.ts';
import { WALLET_IN_USE, touchLogin, verifiedWalletOwner } from '../services/wallets.ts';

const Challenge = z.object({ purpose: z.enum(['login', 'reset', 'link', 'confirm']), address: z.string().min(32).max(44).optional() });
const WalletSignup = z.object({ signupToken: z.string().min(20).max(100), username: Username, displayName: z.string().trim().min(1).max(40).optional() });

export default async function walletAuthRoutes(app: FastifyInstance) {
  const deps = app.deps;
  const { db, config, now } = deps;

  app.post('/auth/wallet/challenge', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const body = parse(Challenge, req.body);
    if (body.address && !decodeAddress(body.address)) throw errors.badRequest('BAD_ADDRESS', 'That isn’t a Solana address');
    const user = body.purpose === 'link' || body.purpose === 'confirm' ? requireUser(req) : null;
    // Spec §8: admin stays a password login, so an admin account never gets a wallet to sign in (or reset) with.
    if (body.purpose === 'link' && config.adminUsernames.some((a) => a.toLowerCase() === user!.username.toLowerCase())) {
      throw errors.forbidden('ADMIN_PASSWORD_ONLY', 'Admin accounts sign in with a password only');
    }
    return issueChallenge(deps, { purpose: body.purpose, user, address: body.address });
  });

  app.post('/auth/wallet/verify', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply): Promise<WalletVerifyResult> => {
    // Sign-in only. Linking a wallet is POST /api/me/wallets, which also needs proof of the account holder.
    const body = parse(WalletProofBody.extend({ purpose: z.enum(['login']) }), req.body);
    const w = await verifyProof(deps, body, 'login', null);
    const owner = await verifiedWalletOwner(db, w.address);
    if (owner) {
      await touchLogin(db, w.address, now());
      await startSession(app, reply, owner.id);
      return { status: 'signedIn', user: await meView(db, owner) };
    }
    // One click (2026-10-28 brief §1): an unknown wallet gets an owner account at once, named after its address.
    const u = await walletAccount(db, config, w.address, w.walletName, now());
    if (!u) return { status: 'new', signupToken: await issueSignupToken(deps, w), address: w.address, walletName: w.walletName };
    await startSession(app, reply, u.id);
    return { status: 'signedIn', user: await meView(db, u) };
  });

  app.post('/auth/wallet/signup', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parse(WalletSignup, req.body);
    if (isReservedUsername(config, body.username)) throw errors.conflict('USERNAME_RESERVED', 'That username is reserved');
    if (await usernameTaken(db, body.username)) throw errors.conflict('USERNAME_TAKEN', 'That username is taken');
    const id = newId();
    const at = now();
    let u: UserRow;
    try {
      // One transaction: a refused name or a lost race rolls the token claim back, so the person can retry without signing again.
      u = await db.transaction(async (raw) => {
        const tx = raw as unknown as Db;
        const data = await claimSignupToken(tx, body.signupToken, at);
        if (!data) throw new AppError(400, 'SIGNUP_EXPIRED', 'That wallet sign-in expired. Sign with your wallet again.');
        const [held] = await tx.select().from(userWallets).where(eq(userWallets.address, data.address));
        if (held?.verifiedAt) throw errors.conflict('WALLET_IN_USE', WALLET_IN_USE);
        if (held) await tx.delete(userWallets).where(eq(userWallets.address, data.address)); // a signature beats a typed address
        const [row] = await tx.insert(users).values({ id, username: body.username, displayName: body.displayName ?? body.username, passwordHash: null, createdAt: at }).returning();
        await tx.insert(userWallets).values({ address: data.address, userId: id, walletName: data.walletName, verifiedAt: at, createdAt: at, lastLoginAt: at });
        return row!;
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      if (await usernameTaken(db, body.username)) throw errors.conflict('USERNAME_TAKEN', 'That username is taken');
      throw errors.conflict('WALLET_IN_USE', WALLET_IN_USE);
    }
    await startSession(app, reply, u.id);
    return reply.status(201).send({ user: await meView(db, u) });
  });

  app.post('/auth/password/reset-with-wallet', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parse(z.object({ proof: WalletProofBody, password: z.string().min(8).max(128) }), req.body);
    const { address } = await verifyProof(deps, body.proof, 'reset', null);
    const owner = await verifiedWalletOwner(db, address);
    if (!owner) throw errors.badRequest('NO_WALLET_ACCOUNT', 'No Shillex account has this wallet linked');
    await db.update(users).set({ passwordHash: await hash(body.password) }).where(eq(users.id, owner.id));
    await endOtherSessions(app, req, owner.id); // signed out here, so every session of the account ends
    await touchLogin(db, address, now());
    await startSession(app, reply, owner.id);
    const [fresh] = await db.select().from(users).where(eq(users.id, owner.id));
    return { user: await meView(db, fresh!) };
  });
}

/**
 * A new owner account for a wallet that signed in (one click): username `owner` + the address's first characters (more when
 * taken), the wallet linked and verified. Null when no free name was found or the wallet was taken meanwhile: the old
 * pick-a-username step is the fallback.
 */
async function walletAccount(db: Db, config: { adminUsernames: string[] }, address: string, walletName: string | null, at: Date): Promise<UserRow | null> {
  const clean = address.replace(/[^A-Za-z0-9]/g, '');
  for (let len = 6; len <= 14; len += 2) {
    const username = `owner${clean.slice(0, len)}`;
    if (isReservedUsername(config, username) || (await usernameTaken(db, username))) continue;
    try {
      return await db.transaction(async (raw) => {
        const tx = raw as unknown as Db;
        const [held] = await tx.select().from(userWallets).where(eq(userWallets.address, address));
        if (held?.verifiedAt) throw new AppError(409, 'WALLET_IN_USE', WALLET_IN_USE);
        if (held) await tx.delete(userWallets).where(eq(userWallets.address, address));
        const [row] = await tx.insert(users).values({ id: newId(), username, displayName: username, passwordHash: null, createdAt: at }).returning();
        await tx.insert(userWallets).values({ address, userId: row!.id, walletName, verifiedAt: at, createdAt: at, lastLoginAt: at });
        return row!;
      });
    } catch (e) {
      if (e instanceof AppError) return null;
      if (!isUniqueViolation(e)) throw e;
    }
  }
  return null;
}
