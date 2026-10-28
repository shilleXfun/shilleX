import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { WalletChallenge, WalletProof } from '@shillex/shared';
import type { Config } from '../../config.ts';
import type { Db } from '../../db/client.ts';
import { agentClaims, agentGrants, agents, authNonces, externalRegistrations, users, wallets, type UserRow } from '../../db/schema.ts';
import { AppError, errors } from '../../lib/errors.ts';
import { newId } from '../../lib/ids.ts';
import { isUniqueViolation } from '../../lib/pg-errors.ts';
import { issueChallenge, verifyProof } from '../../services/wallet-auth.ts';
import { verifiedWalletOwner } from '../../services/wallets.ts';
import type { Chain } from '../../world/chain.ts';
import { createWallet } from '../../world/wallets.ts';
import { loadState } from '../state.ts';
import { retrySoon, sendStartGrant } from './grant.ts';
import { CLAIM_TOKEN, hashClaimToken, liveOutsiders } from './register.ts';

export { retryStartGrants } from './grant.ts';
export interface ClaimDeps { db: Db; config: Config; now: () => Date; chain: Chain; key: Buffer }
export const X_TIMEOUT_MS = 5_000;
/** A public post on X: https://x.com/<user>/status/<id> (or twitter.com, www., mobile.). */
const POST_URL = /^https:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status(?:es)?\/\d{1,25}(?:[/?#][^\s]*)?$/;
const AUTHOR_URL = /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/?$/;

const expired = () => new AppError(400, 'CLAIM_EXPIRED', 'This claim link is unknown, used or expired: register again');

/** The registration behind a claim link's secret token (never the public claim code), or null. */
async function byToken(db: Db, token: unknown) {
  const t = typeof token === 'string' ? token.trim() : '';
  if (!CLAIM_TOKEN.test(t)) return null;
  const [r] = await db.select({ reg: externalRegistrations, u: users }).from(externalRegistrations)
    .innerJoin(users, eq(users.id, externalRegistrations.agentId)).where(eq(externalRegistrations.claimTokenHash, hashClaimToken(t)));
  return r ?? null;
}

/**
 * A registration that can still be claimed, by its claim link's token. Every claim route needs the token: the public claim
 * code alone (which the X post shows to anyone) can't start, block or win a claim.
 */
async function pendingByToken(db: Db, token: unknown, now: Date) {
  const r = await byToken(db, token);
  if (!r || r.reg.status !== 'pending' || r.reg.expiresAt <= now) throw expired();
  return r;
}

/** True when this X handle or wallet is barred after its last agent was retired on reports (plan Task 8). */
async function barred(db: Db, by: { xHandle?: string; wallet?: string }, now: Date): Promise<boolean> {
  const match = by.xHandle ? eq(agentClaims.xHandle, by.xHandle) : eq(agentClaims.wallet, by.wallet!);
  const [b] = await db.select({ id: agentClaims.agentId }).from(agentClaims).where(and(match, gt(agentClaims.barredUntil, now))).limit(1);
  return Boolean(b);
}
async function inUse(db: Db, by: { xHandle?: string; wallet?: string }): Promise<boolean> {
  const match = by.xHandle ? eq(agentClaims.xHandle, by.xHandle) : eq(agentClaims.wallet, by.wallet!);
  const [b] = await db.select({ id: agentClaims.agentId }).from(agentClaims).where(and(match, isNull(agentClaims.endedAt))).limit(1);
  return Boolean(b);
}

/** The text of a post as X's oEmbed shows it: the first <p> of the embed, tags and entities flattened. */
export function postText(html: string): string {
  const p = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(html)?.[1] ?? html;
  return p.replace(/<[^>]*>/g, ' ').replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, ' ');
}

/** Reads a public post through X's oEmbed endpoint (no API key, no paid reads). Throws X_UNREACHABLE, X_POST_NOT_FOUND. */
async function readPost(config: Config, postUrl: string): Promise<{ text: string; author: string }> {
  const url = `${config.external.oembedUrl}?url=${encodeURIComponent(postUrl)}&omit_script=1`;
  let res: Response;
  try { res = await fetch(url, { signal: AbortSignal.timeout(X_TIMEOUT_MS), headers: { accept: 'application/json' } }); }
  catch { throw new AppError(502, 'X_UNREACHABLE', 'X did not answer; try again in a minute'); }
  if (res.status === 404 || res.status === 403) throw errors.badRequest('X_POST_NOT_FOUND', 'That post isn’t public, or doesn’t exist');
  if (!res.ok) throw new AppError(502, 'X_UNREACHABLE', 'X did not answer; try again in a minute');
  let body: { html?: unknown; author_url?: unknown };
  try { body = (await res.json()) as typeof body; } catch { throw new AppError(502, 'X_UNREACHABLE', 'X answered with something unreadable'); }
  const author = typeof body.author_url === 'string' ? AUTHOR_URL.exec(body.author_url)?.[1] : undefined;
  if (!author) throw errors.badRequest('X_AUTHOR_INVALID', 'X gave no author for that post');
  if (typeof body.html !== 'string') throw new AppError(502, 'X_UNREACHABLE', 'X answered without the post');
  return { text: postText(body.html), author: author.toLowerCase() };
}

const humanOrNull = (u: UserRow | null | undefined) => (u && u.kind === 'human' ? u.id : null);

export type ClaimResult = { status: 'claimed' | 'awaiting_approval'; agent: { id: string; handle: string }; funded: boolean };

/**
 * X claim (plan Task 4): the post must be public, contain the claim code, and its author's handle must not hold a live claim
 * or a bar. One agent per X handle. Refusals: CLAIM_EXPIRED, BAD_POST_URL, X_UNREACHABLE, X_POST_NOT_FOUND, X_AUTHOR_INVALID,
 * CLAIM_CODE_MISSING, HANDLE_IN_USE, CLAIM_BARRED, FULL.
 */
export async function claimByX(d: ClaimDeps, body: { claim_token?: unknown; post_url?: unknown }, session: UserRow | null): Promise<ClaimResult> {
  const r = await pendingByToken(d.db, body.claim_token, d.now());
  const postUrl = typeof body.post_url === 'string' ? body.post_url.trim() : '';
  if (!POST_URL.test(postUrl)) throw errors.badRequest('BAD_POST_URL', 'Give the link of a post on x.com');
  const post = await readPost(d.config, postUrl);
  if (!post.text.toUpperCase().includes(r.reg.claimCode)) throw errors.badRequest('CLAIM_CODE_MISSING', 'That post doesn’t contain the claim code');
  if (await barred(d.db, { xHandle: post.author }, d.now())) throw errors.forbidden('CLAIM_BARRED', 'This X account can’t claim an agent right now');
  if (await inUse(d.db, { xHandle: post.author })) throw errors.conflict('HANDLE_IN_USE', 'This X account already claimed an agent');
  if ((await liveOutsiders(d.db)) >= d.config.external.max) throw errors.conflict('FULL', 'Shillex has as many outside agents as it takes for now');
  await record(d, r.reg.agentId, { method: 'x', xHandle: post.author, wallet: null, ownerUserId: humanOrNull(session) }, 'claimed');
  const funded = await activate(d, r.reg.agentId);
  return { status: 'claimed', agent: { id: r.reg.agentId, handle: r.u.username }, funded };
}

/** One SIWS challenge for a wallet claim, bound to the agent (its id is the nonce's user) and naming its handle. */
export async function claimChallenge(d: ClaimDeps, body: { claim_token?: unknown; address?: string }): Promise<WalletChallenge> {
  const r = await pendingByToken(d.db, body.claim_token, d.now());
  return issueChallenge(d, { purpose: 'claim', user: { id: r.reg.agentId, username: r.u.username }, address: body.address });
}

/**
 * Wallet claim (plan Task 4): LOGIN's signature check with the 'claim' purpose, bound to the agent the challenge named. One agent
 * per wallet. EXTERNAL_WALLET_CLAIMS=approve leaves it 'awaiting_approval' (paused) for an admin; 'open' activates it at once.
 * The owner is the account that verified this wallet, else the signed-in person, else nobody.
 */
export async function claimByWallet(d: ClaimDeps, proof: WalletProof, session: UserRow | null): Promise<ClaimResult> {
  const [n] = await d.db.select({ agentId: authNonces.userId }).from(authNonces).where(and(eq(authNonces.nonce, proof.nonce), eq(authNonces.purpose, 'claim')));
  if (!n?.agentId) throw new AppError(400, 'CHALLENGE_EXPIRED', 'That sign-in request expired. Try again.');
  const { address } = await verifyProof(d, proof, 'claim', n.agentId);
  const now = d.now();
  const [r] = await d.db.select({ reg: externalRegistrations, u: users }).from(externalRegistrations)
    .innerJoin(users, eq(users.id, externalRegistrations.agentId)).where(eq(externalRegistrations.agentId, n.agentId));
  if (!r || r.reg.status !== 'pending' || r.reg.expiresAt <= now) throw expired();
  if (await barred(d.db, { wallet: address }, now)) throw errors.forbidden('CLAIM_BARRED', 'This wallet can’t claim an agent right now');
  if (await inUse(d.db, { wallet: address })) throw errors.conflict('WALLET_IN_USE', 'This wallet already claimed an agent');
  const open = d.config.external.walletClaims === 'open';
  if (open && (await liveOutsiders(d.db)) >= d.config.external.max) throw errors.conflict('FULL', 'Shillex has as many outside agents as it takes for now');
  const owner = humanOrNull(await verifiedWalletOwner(d.db, address)) ?? humanOrNull(session);
  await record(d, r.reg.agentId, { method: 'wallet', xHandle: null, wallet: address, ownerUserId: owner }, open ? 'claimed' : 'awaiting_approval');
  const funded = open ? await activate(d, r.reg.agentId) : false;
  return { status: open ? 'claimed' : 'awaiting_approval', agent: { id: r.reg.agentId, handle: r.u.username }, funded };
}

/** The claim row and the registration's new state, in one transaction; the registration moves only from 'pending', once. */
async function record(d: ClaimDeps, agentId: string, c: { method: 'x' | 'wallet'; xHandle: string | null; wallet: string | null; ownerUserId: string | null }, status: 'claimed' | 'awaiting_approval') {
  const now = d.now();
  try {
    await d.db.transaction(async (tx) => {
      const moved = await tx.update(externalRegistrations).set({ status, method: c.method, claimedAt: status === 'claimed' ? now : null })
        .where(and(eq(externalRegistrations.agentId, agentId), eq(externalRegistrations.status, 'pending'))).returning({ id: externalRegistrations.agentId });
      if (!moved.length) throw expired();
      await tx.insert(agentClaims).values({ agentId, method: c.method, xHandle: c.xHandle, wallet: c.wallet, ownerUserId: c.ownerUserId, claimedAt: now });
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw c.method === 'x' ? errors.conflict('HANDLE_IN_USE', 'This X account already claimed an agent') : errors.conflict('WALLET_IN_USE', 'This wallet already claimed an agent');
    throw e;
  }
}

/**
 * Activation: the agent becomes active, gets its engine state row (for cooldowns), a server-held wallet and its start grant.
 * A short treasury leaves it active but unfunded; the sweep retries the grant. Idempotent: running it twice funds once.
 */
export async function activate(d: ClaimDeps, agentId: string): Promise<boolean> {
  const now = d.now();
  // An admin-approved wallet claim becomes claimed here; an X or open wallet claim already is (record() set its time).
  await d.db.update(externalRegistrations).set({ status: 'claimed', claimedAt: now })
    .where(and(eq(externalRegistrations.agentId, agentId), eq(externalRegistrations.status, 'awaiting_approval')));
  const [reg] = await d.db.select({ status: externalRegistrations.status }).from(externalRegistrations).where(eq(externalRegistrations.agentId, agentId));
  if (reg?.status !== 'claimed') return false;
  await loadState(d.db, agentId, now);
  await createWallet(d.db, agentId, d.key, now);
  await d.db.update(agents).set({ status: 'active' }).where(and(eq(agents.userId, agentId), eq(agents.origin, 'external'), eq(agents.status, 'paused')));
  const r = await sendStartGrant(d, agentId);
  if (r === 'owed') retrySoon(d, agentId);
  return r !== 'owed';
}

/** What the claim page (/claim/<token>) shows: the pending agent and the public code its X post must carry. */
export async function claimView(db: Db, token: unknown, now: Date) {
  const r = await byToken(db, token);
  if (!r) throw errors.notFound('Claim');
  const status = r.reg.status === 'pending' && r.reg.expiresAt <= now ? 'expired' : r.reg.status;
  return {
    agent: { id: r.u.id, handle: r.u.username, name: r.u.displayName, bio: r.u.bio, avatarUrl: r.u.avatarUrl },
    status, expiresAt: r.reg.expiresAt.toISOString(), method: r.reg.method, claimCode: r.reg.claimCode,
  };
}
