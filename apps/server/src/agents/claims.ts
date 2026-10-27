import { and, asc, desc, eq, isNull, lte } from 'drizzle-orm';
import { LAMPORTS_PER_SOL } from '@shillex/shared';
import type { Db } from '../db/client.ts';
import { agentAffinity, agentCalls, realMarket, users, worldCoins, type ThesisMarket } from '../db/schema.ts';
import { newId } from '../lib/ids.ts';
import { queueReaction } from './reactions.ts';
import { rememberEvent } from './state.ts';

/**
 * Public calls and their receipts (2026-10-27, Phase 3). The model says, beside a post, which calls the post makes ("$MOTH up within 6
 * hours"); a call is kept only when the post names the coin and the coin has a cached price. At its deadline it resolves against the
 * cache, right or wrong, and the agent that likes the caller least answers under the old post with the numbers: the receipts.
 */
export interface ClaimIn { coin: string; direction: 'up' | 'down'; hours: number }
/** A call needs at least this long to mean anything and may not run past this. */
export const CLAIM_MIN_H = 1, CLAIM_MAX_H = 72;
/** Calls one agent may have open at once: a post full of calls is noise. */
export const OPEN_PER_AGENT = 3;
/** A move smaller than this either way is no move: the call that said "up" over a flat hour was not right. */
export const FLAT = 0.02;

const sym = (s: string) => s.replace(/^\$/, '').toUpperCase();

/** The coin a ticker names right now, and its cached price: a live Shillex coin first, then a real one. */
export async function priceOfSymbol(db: Db, symbol: string): Promise<{ market: ThesisMarket; asset: string; symbol: string; price: number } | null> {
  const s = sym(symbol);
  const [w] = await db.select({ mint: worldCoins.mint, symbol: worldCoins.symbol, p: worldCoins.priceLamports }).from(worldCoins)
    .where(and(eq(worldCoins.symbol, s), isNull(worldCoins.archivedAt))).orderBy(desc(worldCoins.launchedAt)).limit(1);
  if (w?.p) return { market: 'world', asset: w.mint, symbol: w.symbol, price: w.p / LAMPORTS_PER_SOL };
  const [r] = await db.select({ a: realMarket.address, symbol: realMarket.symbol, p: realMarket.priceUsd }).from(realMarket).where(eq(realMarket.symbol, s)).orderBy(desc(realMarket.liquidityUsd)).limit(1);
  return r?.p ? { market: 'real', asset: r.a, symbol: r.symbol, price: r.p } : null;
}
async function priceOfAsset(db: Db, market: ThesisMarket, asset: string): Promise<number | null> {
  if (market === 'world') { const [w] = await db.select({ p: worldCoins.priceLamports }).from(worldCoins).where(eq(worldCoins.mint, asset)); return w?.p ? w.p / LAMPORTS_PER_SOL : null; }
  const [r] = await db.select({ p: realMarket.priceUsd }).from(realMarket).where(eq(realMarket.address, asset));
  return r?.p ?? null;
}

/** Keeps the calls a posted line makes: only coins the post names, with a price, within the agent's open-call limit. Returns how many. */
export async function storeClaims(db: Db, x: { agentId: string; postId: string | null; text: string; claims: ClaimIn[] }, now: Date): Promise<number> {
  const open = (await db.select({ id: agentCalls.id }).from(agentCalls).where(and(eq(agentCalls.agentId, x.agentId), eq(agentCalls.status, 'open')))).length;
  const named = new Set((x.text.match(/\$[A-Za-z0-9_]+/g) ?? []).map(sym));
  let n = 0;
  for (const c of x.claims.slice(0, 2)) {
    if (open + n >= OPEN_PER_AGENT || !named.has(sym(c.coin)) || (c.direction !== 'up' && c.direction !== 'down')) continue;
    const hours = Math.min(CLAIM_MAX_H, Math.max(CLAIM_MIN_H, Math.round(Number(c.hours) || 0)));
    const p = await priceOfSymbol(db, c.coin);
    if (!p) continue;
    await db.insert(agentCalls).values({ id: newId(), agentId: x.agentId, postId: x.postId, market: p.market, asset: p.asset, symbol: p.symbol, direction: c.direction,
      priceAtClaim: p.price, deadline: new Date(now.getTime() + hours * 3_600_000), createdAt: now });
    n++;
  }
  return n;
}

const pct = (x: number) => `${x >= 0 ? '+' : ''}${Math.round(x * 100)}%`;
const ago = (ms: number) => (ms < 2 * 3_600_000 ? `${Math.max(1, Math.round(ms / 60_000))} minutes` : `${Math.round(ms / 3_600_000)} hours`);

/**
 * Resolves every call past its deadline (at most `max` a run, oldest first): right when the price moved the called way by more than
 * FLAT. The caller remembers it; the agent that likes it least (or, with no rival, nobody) brings the receipts under the old post.
 * Returns the calls resolved.
 */
export async function resolveClaims(db: Db, now: Date, max = 20): Promise<number> {
  const due = await db.select().from(agentCalls).where(and(eq(agentCalls.status, 'open'), lte(agentCalls.deadline, now))).orderBy(asc(agentCalls.deadline)).limit(max);
  for (const c of due) {
    const price = await priceOfAsset(db, c.market, c.asset);
    // No price any more (a coin of a past season): the call lapses as wrong, quietly.
    const move = price === null ? 0 : price / c.priceAtClaim - 1;
    const right = c.direction === 'up' ? move > FLAT : move < -FLAT;
    await db.update(agentCalls).set({ status: right ? 'right' : 'wrong', priceAtResolve: price, resolvedAt: now }).where(eq(agentCalls.id, c.id));
    if (price === null) continue;
    await rememberEvent(db, c.agentId, right ? 'call_right' : 'call_wrong', { symbol: c.symbol, direction: c.direction, pct: Math.round(move * 100) }, now);
    if (!c.postId) continue;
    const [rival] = await db.select({ id: agentAffinity.agentId, score: agentAffinity.score }).from(agentAffinity).innerJoin(users, eq(users.id, agentAffinity.agentId))
      .where(and(eq(agentAffinity.otherId, c.agentId), eq(users.kind, 'agent'))).orderBy(asc(agentAffinity.score)).limit(1);
    if (!rival || rival.score > -0.1) continue;
    const [caller] = await db.select({ u: users.username }).from(users).where(eq(users.id, c.agentId));
    const event = `@${caller?.u ?? 'someone'} called $${c.symbol} ${c.direction} ${ago(now.getTime() - c.createdAt.getTime())} ago; it is ${pct(move)} since that post, so the call was ${right ? 'right' : 'wrong'}`;
    await queueReaction(db, { agentId: rival.id, kind: 'reply', format: right ? 'cope' : 'callout', event, postId: c.postId, aboutId: c.agentId }, now);
  }
  return due.length;
}
