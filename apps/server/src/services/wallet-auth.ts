import { randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import { z } from 'zod';
import { AUTH_LIMITS, type WalletChallenge, type WalletProof, type WalletPurpose } from '@shillex/shared';
import type { AppDeps } from '../deps.ts';
import type { Db } from '../db/client.ts';
import { authNonces, authTokens } from '../db/schema.ts';
import { hashToken } from '../lib/auth.ts';
import { AppError } from '../lib/errors.ts';
import { challengeInput, decodeAddress, fromBase64, messageText, newNonce, signInMatches, verifyEd25519 } from '../lib/siws.ts';

type Deps = Pick<AppDeps, 'db' | 'config' | 'now'>;
const DAY_MS = 24 * 60 * 60_000;

export const WalletProofBody = z.object({
  nonce: z.string().min(8).max(64),
  mode: z.enum(['signIn', 'message']),
  address: z.string().min(32).max(44),
  signedMessage: z.string().min(1).max(4096),
  signature: z.string().min(1).max(128),
  walletName: z.string().trim().max(AUTH_LIMITS.walletNameMax).nullish(),
});

const expired = () => new AppError(400, 'CHALLENGE_EXPIRED', 'That sign-in request expired. Try again.');
const invalid = () => new AppError(400, 'SIGN_IN_INVALID', 'The wallet signature didn’t check out. Try again.');

/** Stores and returns a fresh SIWS challenge. Nonces older than a day are cleared on the way (no separate job). */
export async function issueChallenge(deps: Deps, o: { purpose: WalletPurpose; user: { id: string; username: string } | null; address?: string }): Promise<WalletChallenge> {
  const now = deps.now();
  await deps.db.delete(authNonces).where(lt(authNonces.createdAt, new Date(now.getTime() - DAY_MS)));
  const nonce = newNonce();
  const input = challengeInput({ publicUrl: deps.config.publicUrl, purpose: o.purpose, username: o.user?.username ?? null, nonce, now, address: o.address });
  const message = o.address ? messageText({ ...input, address: o.address }) : null;
  await deps.db.insert(authNonces).values({ nonce, purpose: o.purpose, userId: o.user?.id ?? null, input, message, createdAt: now, expiresAt: new Date(input.expirationTime) });
  return { nonce, input, message };
}

/**
 * Checks a signed challenge (spec §3.3) and returns the wallet it proves. The nonce is claimed first, in one atomic update,
 * so a bad signature still burns it and nothing can be replayed. `userId` binds `link` and `confirm` nonces to their user.
 */
export async function verifyProof(deps: Deps, proof: WalletProof, purpose: WalletPurpose, userId: string | null): Promise<{ address: string; walletName: string | null }> {
  const now = deps.now();
  const [row] = await deps.db.update(authNonces).set({ usedAt: now }).where(and(
    eq(authNonces.nonce, proof.nonce), eq(authNonces.purpose, purpose), isNull(authNonces.usedAt), gt(authNonces.expiresAt, now),
    userId ? eq(authNonces.userId, userId) : isNull(authNonces.userId),
  )).returning();
  if (!row) throw expired();
  const key = decodeAddress(proof.address);
  const signed = fromBase64(proof.signedMessage);
  const signature = fromBase64(proof.signature);
  if (!key || !signed || !signature) throw invalid();
  if (proof.mode === 'message') {
    if (row.message === null || row.input.address !== proof.address || !Buffer.from(signed).equals(Buffer.from(row.message, 'utf8'))) throw invalid();
  } else if (!signInMatches(row.input, new TextDecoder().decode(signed), proof.address)) throw invalid();
  if (!verifyEd25519(key, signed, signature)) throw invalid();
  return { address: proof.address, walletName: proof.walletName?.trim() || null };
}

/** A one-use token (15 minutes) letting a just-signed, unknown wallet pick a username. Stored as sha256 like sessions. */
export async function issueSignupToken(deps: Deps, data: { address: string; walletName: string | null }): Promise<string> {
  const now = deps.now();
  await deps.db.delete(authTokens).where(lt(authTokens.createdAt, new Date(now.getTime() - DAY_MS)));
  const token = randomBytes(32).toString('base64url');
  await deps.db.insert(authTokens).values({ id: hashToken(token), kind: 'wallet_signup', userId: null, data, createdAt: now, expiresAt: new Date(now.getTime() + AUTH_LIMITS.signupTokenTtlMs) });
  return token;
}

/** Claims a signup token inside the caller's transaction; null when it is unknown, used or expired. */
export async function claimSignupToken(tx: Db, token: string, now: Date): Promise<{ address: string; walletName: string | null } | null> {
  const [row] = await tx.update(authTokens).set({ usedAt: now }).where(and(
    eq(authTokens.id, hashToken(token)), eq(authTokens.kind, 'wallet_signup'), isNull(authTokens.usedAt), gt(authTokens.expiresAt, now),
  )).returning();
  return row?.data ?? null;
}
