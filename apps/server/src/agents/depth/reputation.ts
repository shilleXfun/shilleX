import { and, desc, eq, gte, inArray, isNotNull, lte } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { agentCommitments, agentTheses, chainTxs, debts, posts, saidVsDid, users, worldCoins } from '../../db/schema.ts';
import { stanceOf } from './beliefs.ts';
import type { DepthModule } from './registry.ts';

/**
 * The record a reputation is read from. Since 2026-10-25 (Phase C) also the promises it made in public and kept or broke, and the
 * calls its written plans made: a win is worth less than a broken promise costs, and a loss less than a win earns, so a reasonable
 * thesis that lost is not ruinous and one lucky trade is not a career.
 */
export interface RepFacts { rugs: number; honestCalls: number; wrongCalls: number; hypocrisy: number; repaid: number; defaulted: number; lent: number; kept?: number; broken?: number; won?: number; lost?: number }

export function reputationScore(f: RepFacts): number {
  return Math.tanh(0.25 * f.honestCalls - 0.15 * f.wrongCalls - 0.6 * f.rugs - 0.3 * f.hypocrisy + 0.3 * f.repaid - 0.6 * f.defaulted + 0.1 * f.lent
    + 0.05 * (f.kept ?? 0) - 0.5 * (f.broken ?? 0) + 0.08 * (f.won ?? 0) - 0.04 * (f.lost ?? 0));
}

const SIX_H = 6 * 3600_000;

async function priceAt(db: Db, mint: string, at: Date): Promise<number | null> {
  const [t] = await db.select({ l: chainTxs.lamportsDelta, k: chainTxs.tokenDelta }).from(chainTxs)
    .where(and(eq(chainTxs.mint, mint), inArray(chainTxs.kind, ['buy', 'sell']), lte(chainTxs.createdAt, at))).orderBy(desc(chainTxs.createdAt)).limit(1);
  if (!t || t.k === 0) return null;
  return Math.abs(t.l) / (Math.abs(t.k) / 1e6);
}

export async function repFacts(db: Db, userId: string, now: Date): Promise<RepFacts> {
  const mine = await db.select({ mint: worldCoins.mint }).from(worldCoins).where(eq(worldCoins.creatorId, userId));
  let rugs = 0;
  for (const { mint } of mine) {
    const txs = await db.select({ kind: chainTxs.kind, k: chainTxs.tokenDelta }).from(chainTxs).where(and(eq(chainTxs.mint, mint), eq(chainTxs.agentId, userId)));
    const bought = txs.filter((t) => t.kind === 'launch' || t.kind === 'buy').reduce((n, t) => n + t.k, 0);
    const sold = txs.filter((t) => t.kind === 'sell').reduce((n, t) => n - t.k, 0);
    if (bought > 0 && sold >= 0.7 * bought) rugs++;
  }
  const coins = await db.select({ mint: worldCoins.mint, symbol: worldCoins.symbol }).from(worldCoins);
  const recent = await db.select({ body: posts.body, at: posts.createdAt }).from(posts)
    .where(and(eq(posts.authorId, userId), gte(posts.createdAt, new Date(now.getTime() - 7 * 24 * 3600_000)), lte(posts.createdAt, new Date(now.getTime() - SIX_H))))
    .orderBy(desc(posts.createdAt)).limit(50);
  let honestCalls = 0, wrongCalls = 0;
  for (const p of recent) for (const c of coins) {
    const s = stanceOf(p.body, c.symbol);
    if (s === null || Math.abs(s) <= 0.3) continue;
    const [before, after] = [await priceAt(db, c.mint, p.at), await priceAt(db, c.mint, new Date(p.at.getTime() + SIX_H))];
    if (!before || !after) continue;
    const move = (after - before) / before;
    if (Math.abs(move) < 0.1) continue;
    if (Math.sign(move) === Math.sign(s)) honestCalls++; else wrongCalls++;
  }
  const hypocrisy = (await db.select({ id: saidVsDid.postId }).from(saidVsDid).where(eq(saidVsDid.agentId, userId))).length;
  const repaid = (await db.select({ id: debts.id }).from(debts).where(and(eq(debts.borrowerId, userId), isNotNull(debts.repaidAt)))).length;
  const defaulted = (await db.select({ id: debts.id }).from(debts).where(and(eq(debts.borrowerId, userId), isNotNull(debts.defaultedAt)))).length;
  const lent = (await db.select({ id: debts.id }).from(debts).where(eq(debts.lenderId, userId))).length;
  const promises = await db.select({ status: agentCommitments.status }).from(agentCommitments).where(eq(agentCommitments.agentId, userId));
  const closed = await db.select({ pnl: agentTheses.pnlPct }).from(agentTheses).where(and(eq(agentTheses.agentId, userId), isNotNull(agentTheses.pnlPct)));
  return {
    rugs, honestCalls, wrongCalls, hypocrisy, repaid, defaulted, lent,
    kept: promises.filter((p) => p.status === 'kept').length, broken: promises.filter((p) => p.status === 'broken').length,
    won: closed.filter((t) => (t.pnl ?? 0) > 0).length, lost: closed.filter((t) => (t.pnl ?? 0) <= 0).length,
  };
}

export class ReputationCache {
  private m = new Map<string, number>();
  private owner: Db | null = null;
  get(id: string) { return this.m.get(id) ?? 0; }
  set(id: string, v: number) { this.m.set(id, v); }
  all(): Record<string, number> { return Object.fromEntries(this.m); }
  /** The scores for this database only: the singleton outlives an app, so another db's scores are never shown. */
  allFor(db: Db): Record<string, number> { return this.owner === db ? this.all() : {}; }
  /** Recomputes every agent's score and replaces the cache wholesale, so nothing from an earlier db or a gone agent lingers. */
  async refresh(db: Db, now: Date) {
    const agentIds = (await db.select({ id: users.id }).from(users).where(eq(users.kind, 'agent'))).map((r) => r.id);
    const next = new Map<string, number>();
    for (const id of agentIds) next.set(id, reputationScore(await repFacts(db, id, now)));
    this.m = next;
    this.owner = db;
  }
}
/** Shared by the engine and the read routes (4.11). Filled at boot and by the sweep, never inside a tick. */
export const reputation = new ReputationCache();

export const reputationModule: DepthModule = {
  name: 'reputation',
  /** Only copies the cache: the refresh is too heavy for a tick. */
  async perceive(d, v) {
    v.depth.reputation = reputation.allFor(d.db);
  },
  modify(v, cs) {
    return cs.map((c) => {
      if (c.kind === 'buy' && c.target?.mint) {
        const creator = v.coins.find((x) => x.mint === c.target!.mint)?.creatorId;
        return creator ? { ...c, score: c.score * (1 + 0.5 * (v.depth.reputation[creator] ?? 0)) } : c;
      }
      if (c.kind === 'follow' && c.target?.userId) return { ...c, score: c.score * (1 + (v.depth.reputation[c.target.userId] ?? 0)) };
      return c;
    });
  },
  async sweep(d) { await reputation.refresh(d.db, d.now()); },
};
