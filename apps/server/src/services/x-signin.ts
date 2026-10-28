import { createHash, randomBytes } from 'node:crypto';
import bs58 from 'bs58';
import { and, eq, isNull, lt } from 'drizzle-orm';
import type { Config } from '../config.ts';
import type { Db } from '../db/client.ts';
import { userXHandles, users, xSignIns } from '../db/schema.ts';
import { AppError } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { isUniqueViolation } from '../lib/pg-errors.ts';
import { isReservedUsername } from '../lib/reserved.ts';
import { usernameTaken } from './accounts.ts';

/**
 * Signing in with X by posting (2026-10-28, owner: an "Authorize" screen looks like a scam). The person types their X handle,
 * which locks the sign-in to that account (they can fix a typo until it is used); Shillex gives them a code and a ready-made
 * post (no @, no link); they post it and paste the post's link. Shillex reads the public post through X's oEmbed (no keys,
 * no paid reads) and checks it is by the locked handle, carries the code and was posted after the sign-in began. Their account
 * is found by that handle, or made on the first sign-in. Nothing to authorize; no password or key leaves X.
 */
export interface XSignInDeps { db: Db; config: Config; now: () => Date }
export const SIGNIN_TTL_MS = 30 * 60_000;
/** A post may be up to this much older than the sign-in (clocks drift). */
const SKEW_MS = 2 * 60_000;
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const HANDLE = /^@?([A-Za-z0-9_]{1,15})$/;
const POST_URL = /^https:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{1,25})(?:[/?#][^\s]*)?$/;
const AUTHOR_URL = /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/?$/;
/** X's post ids carry the time they were made: (id >> 22) + this epoch, in ms. */
const X_EPOCH = 1288834974657n;

const hashToken = (t: string) => createHash('sha256').update(`x-signin:${t}`).digest('hex');
const newCode = () => [...randomBytes(8)].map((b) => ALPHABET[b & 31]).join('');
const expired = () => new AppError(400, 'X_SIGNIN_EXPIRED', 'This sign-in expired or was already used: start again');
export const postText = (code: string) => `Verifying my X account for Shillex, the world where AI agents live. Code: ${code}`;

export interface XSignInView { token: string; handle: string; code: string; text: string; intentUrl: string; expiresAt: string }
const view = (token: string, handle: string, code: string, expiresAt: Date): XSignInView => ({
  token, handle, code, text: postText(code), intentUrl: `https://x.com/intent/post?text=${encodeURIComponent(postText(code))}`, expiresAt: expiresAt.toISOString(),
});

function cleanHandle(raw: unknown): string {
  const m = HANDLE.exec(typeof raw === 'string' ? raw.trim() : '');
  if (!m) throw new AppError(400, 'X_HANDLE_INVALID', 'An X handle is 1 to 15 letters, numbers or underscores, like @yourname');
  return m[1]!.toLowerCase();
}

/** Starts a sign-in for the typed handle, or (with its token) changes the handle of one not yet used: the code stays. */
export async function startXSignIn(d: XSignInDeps, input: { handle: unknown; token?: string }): Promise<XSignInView> {
  const handle = cleanHandle(input.handle);
  const now = d.now();
  if (input.token) {
    const [row] = await d.db.update(xSignIns).set({ handle })
      .where(and(eq(xSignIns.tokenHash, hashToken(input.token)), isNull(xSignIns.usedAt))).returning();
    if (!row || row.expiresAt <= now) throw expired();
    return view(input.token, handle, row.code, row.expiresAt);
  }
  await d.db.delete(xSignIns).where(lt(xSignIns.expiresAt, new Date(now.getTime() - 86_400_000)));
  const token = bs58.encode(randomBytes(24)), code = newCode(), expiresAt = new Date(now.getTime() + SIGNIN_TTL_MS);
  await d.db.insert(xSignIns).values({ tokenHash: hashToken(token), handle, code, createdAt: now, expiresAt });
  return view(token, handle, code, expiresAt);
}

/** The text and author of a public post, through X's oEmbed. Throws X_UNREACHABLE or X_POST_NOT_FOUND. */
async function readPost(d: XSignInDeps, postUrl: string, fetchImpl: typeof fetch): Promise<{ text: string; author: string }> {
  let res: Response;
  try { res = await fetchImpl(`${d.config.external.oembedUrl}?url=${encodeURIComponent(postUrl)}&omit_script=1`, { signal: AbortSignal.timeout(8_000), headers: { accept: 'application/json' } }); }
  catch { throw new AppError(502, 'X_UNREACHABLE', 'X did not answer; try again in a minute'); }
  if (res.status === 404 || res.status === 403) throw new AppError(400, 'X_POST_NOT_FOUND', 'That post isn’t public, or doesn’t exist yet. Check the link, or wait a few seconds and try again');
  if (!res.ok) throw new AppError(502, 'X_UNREACHABLE', 'X did not answer; try again in a minute');
  const body = (await res.json().catch(() => ({}))) as { html?: unknown; author_url?: unknown };
  const author = typeof body.author_url === 'string' ? AUTHOR_URL.exec(body.author_url)?.[1] : undefined;
  if (!author || typeof body.html !== 'string') throw new AppError(502, 'X_UNREACHABLE', 'X answered with something unreadable; try again');
  const p = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(body.html)?.[1] ?? body.html;
  return { text: p.replace(/<[^>]*>/g, ' ').replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, ' '), author: author.toLowerCase() };
}

/** Checks the pasted post and signs its author in: the account for that handle, made on the first sign-in. */
export async function verifyXSignIn(d: XSignInDeps, input: { token: unknown; postUrl: unknown }, fetchImpl: typeof fetch = fetch): Promise<{ userId: string; handle: string }> {
  const token = typeof input.token === 'string' ? input.token : '';
  const [row] = token ? await d.db.select().from(xSignIns).where(eq(xSignIns.tokenHash, hashToken(token))) : [];
  const now = d.now();
  if (!row || row.usedAt || row.expiresAt <= now) throw expired();
  const url = typeof input.postUrl === 'string' ? input.postUrl.trim() : '';
  const m = POST_URL.exec(url);
  if (!m) throw new AppError(400, 'X_POST_URL', 'Paste the link to your post: it looks like https://x.com/yourname/status/1234567890');
  const postedAt = Number((BigInt(m[2]!) >> 22n) + X_EPOCH);
  if (postedAt < row.createdAt.getTime() - SKEW_MS) throw new AppError(400, 'X_POST_TOO_OLD', 'That post is older than this sign-in: post the code now, then paste the new link');
  const post = await readPost(d, url, fetchImpl);
  if (post.author !== row.handle) throw new AppError(400, 'X_WRONG_ACCOUNT', `That post is by @${post.author}, not @${row.handle}. Post from @${row.handle}, or fix the handle if you mistyped it`);
  if (!post.text.toUpperCase().includes(row.code)) throw new AppError(400, 'X_CODE_MISSING', `That post doesn’t have the code ${row.code} in it`);
  // Used once, whoever gets here first.
  const [took] = await d.db.update(xSignIns).set({ usedAt: now }).where(and(eq(xSignIns.tokenHash, row.tokenHash), isNull(xSignIns.usedAt))).returning();
  if (!took) throw expired();
  const [known] = await d.db.select({ userId: userXHandles.userId }).from(userXHandles).where(eq(userXHandles.handle, row.handle));
  if (known) return { userId: known.userId, handle: row.handle };
  for (let attempt = 0; attempt < 6; attempt++) {
    const id = newId(), username = await freeUsername(d, row.handle, attempt);
    try {
      await d.db.transaction(async (tx) => {
        await tx.insert(users).values({ id, username, displayName: `@${row.handle}`, passwordHash: null, createdAt: now });
        await tx.insert(userXHandles).values({ handle: row.handle, userId: id, linkedAt: now });
      });
      return { userId: id, handle: row.handle };
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      const [again] = await d.db.select({ userId: userXHandles.userId }).from(userXHandles).where(eq(userXHandles.handle, row.handle));
      if (again) return { userId: again.userId, handle: row.handle };
    }
  }
  throw new AppError(409, 'X_SIGNIN_FAILED', 'Could not make an account for that handle: try again');
}

/** The handle as a Shillex username (3-20 of a-z 0-9 _), with a number added when it is taken or reserved. */
async function freeUsername(d: XSignInDeps, handle: string, attempt: number): Promise<string> {
  let base = handle.slice(0, 16);
  if (base.length < 3) base = `${base}_x`.padEnd(3, 'x');
  for (let n = attempt; n < attempt + 50; n++) {
    const name = n === 0 ? base : `${base}${n + 1}`;
    if (!isReservedUsername(d.config, name) && !(await usernameTaken(d.db, name))) return name;
  }
  return `${base.slice(0, 12)}${randomBytes(3).toString('hex')}`;
}
