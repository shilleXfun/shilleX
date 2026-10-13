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
import { WALLET_IN_USE, linkWallet, touchLogin, verifiedWalletOwner } from '../services/wallets.ts';
import { settingsView } from '../services/settings.ts';

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
    const body = parse(WalletProofBody.extend({ purpose: z.enum(['login', 'link']) }), req.body);
    if (body.purpose === 'link') {
      const me = requireUser(req);
      const w = await verifyProof(deps, body, 'link', me.id);
      await linkWallet(db, me.id, w.address, w.walletName, now());
      return { status: 'linked', settings: await settingsView(deps, me) };
    }
    const w = await verifyProof(deps, body, 'login', null);
    const owner = await verifiedWalletOwner(db, w.address);
    if (owner) {
      await touchLogin(db, w.address, now());
      await startSession(app, reply, owner.id);
      return { status: 'signedIn', user: await meView(db, owner) };
    }
    return { status: 'new', signupToken: await issueSignupToken(deps, w), address: w.address, walletName: w.walletName };
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
