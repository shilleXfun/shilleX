import { createHash, randomBytes } from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import type { Config } from '../config.ts';
import type { Db } from '../db/client.ts';
import { oauthStates, userXAccounts, users } from '../db/schema.ts';
import { AppError } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { isUniqueViolation } from '../lib/pg-errors.ts';
import { isReservedUsername } from '../lib/reserved.ts';
import { usernameTaken } from './accounts.ts';

/**
 * Owners sign in with X (2026-10-28 brief §1): OAuth 2.0 authorization code with PKCE (S256), scopes users.read and
 * tweet.read, nothing posted. The first sign-in makes a person's account named after the X username; later ones find it by the
 * X user id. X_OAUTH_CLIENT_ID / X_OAUTH_CLIENT_SECRET; the callback is PUBLIC_URL/api/auth/x/callback.
 */
export const AUTHORIZE_URL = 'https://x.com/i/oauth2/authorize';
export const TOKEN_URL = 'https://api.x.com/2/oauth2/token';
export const ME_URL = 'https://api.x.com/2/users/me';
export const STATE_TTL_MS = 10 * 60_000;
export interface XLoginDeps { db: Db; config: Config; now: () => Date }

const b64url = (b: Buffer) => b.toString('base64url');
export const callbackUrl = (config: Config) => `${config.publicUrl.replace(/\/$/, '')}/api/auth/x/callback`;
const expired = () => new AppError(400, 'X_LOGIN_EXPIRED', 'That X sign-in expired or was already used: try again');

/** Where to send the owner: X's consent page, with a fresh state and PKCE challenge kept for 10 minutes. */
export async function startXLogin(d: XLoginDeps, next: string | null): Promise<string> {
  const x = d.config.xOAuth;
  if (!x) throw new AppError(404, 'X_LOGIN_OFF', 'Sign-in with X is not set up here');
  const state = b64url(randomBytes(24)), verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  await d.db.delete(oauthStates).where(lt(oauthStates.createdAt, new Date(d.now().getTime() - STATE_TTL_MS)));
  await d.db.insert(oauthStates).values({ state, verifier, next: safeNext(next), createdAt: d.now() });
  const q = new URLSearchParams({ response_type: 'code', client_id: x.clientId, redirect_uri: callbackUrl(d.config), scope: 'users.read tweet.read', state, code_challenge: challenge, code_challenge_method: 'S256' });
  return `${AUTHORIZE_URL}?${q}`;
}

/** Only a path on this site: never an open redirect. */
export function safeNext(next: string | null | undefined): string | null {
  return typeof next === 'string' && /^\/(?!\/)[^\s\\]*$/.test(next) ? next.slice(0, 300) : null;
}

/** X's answer: the code is traded for a token, the token for the X user, the X user for an account (made on first sign-in). */
export async function finishXLogin(d: XLoginDeps, q: { code?: string; state?: string }, fetchImpl: typeof fetch = fetch): Promise<{ userId: string; next: string | null }> {
  const x = d.config.xOAuth;
  if (!x) throw new AppError(404, 'X_LOGIN_OFF', 'Sign-in with X is not set up here');
  if (!q.code || !q.state) throw expired();
  const [st] = await d.db.delete(oauthStates).where(eq(oauthStates.state, q.state)).returning();
  if (!st || d.now().getTime() - st.createdAt.getTime() > STATE_TTL_MS) throw expired();
  const tokenRes = await fetchImpl(TOKEN_URL, {
    method: 'POST', signal: AbortSignal.timeout(10_000),
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${Buffer.from(`${x.clientId}:${x.clientSecret}`).toString('base64')}` },
    body: new URLSearchParams({ code: q.code, grant_type: 'authorization_code', redirect_uri: callbackUrl(d.config), code_verifier: st.verifier, client_id: x.clientId }).toString(),
  });
  const token = (await tokenRes.json().catch(() => ({}))) as { access_token?: string };
  if (!tokenRes.ok || !token.access_token) throw new AppError(502, 'X_LOGIN_FAILED', 'X did not accept the sign-in: try again');
  const meRes = await fetchImpl(ME_URL, { headers: { authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(10_000) });
  const me = ((await meRes.json().catch(() => ({}))) as { data?: { id?: string; username?: string; name?: string } }).data;
  if (!meRes.ok || !me?.id || !me.username) throw new AppError(502, 'X_LOGIN_FAILED', 'X did not say who you are: try again');
  const [known] = await d.db.select({ userId: userXAccounts.userId }).from(userXAccounts).where(eq(userXAccounts.xUserId, me.id));
  if (known) {
    await d.db.update(userXAccounts).set({ username: me.username }).where(eq(userXAccounts.xUserId, me.id));
    return { userId: known.userId, next: st.next };
  }
  const id = newId(), at = d.now();
  const name = (me.name ?? me.username).replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40) || me.username;
  for (let i = 0; i < 6; i++) {
    const username = await freeUsername(d, me.username, i);
    try {
      await d.db.transaction(async (tx) => {
        await tx.insert(users).values({ id, username, displayName: name, passwordHash: null, createdAt: at });
        await tx.insert(userXAccounts).values({ xUserId: me.id!, userId: id, username: me.username!, linkedAt: at });
      });
      return { userId: id, next: st.next };
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
  }
  throw new AppError(409, 'X_LOGIN_FAILED', 'Could not make an account for that X user: try again');
}

/** The X username as a Shillex username (3-20 of A-Z 0-9 _), with a number added when it is taken or reserved. */
async function freeUsername(d: XLoginDeps, x: string, attempt: number): Promise<string> {
  let base = x.replace(/[^A-Za-z0-9_]/g, '').slice(0, 16);
  if (base.length < 3) base = `${base}_x`.padEnd(3, 'x');
  for (let n = attempt; n < attempt + 50; n++) {
    const name = n === 0 ? base : `${base.slice(0, 16)}${n + 1}`;
    if (!isReservedUsername(d.config, name) && !(await usernameTaken(d.db, name))) return name;
  }
  return `${base.slice(0, 12)}${randomBytes(3).toString('hex')}`;
}
