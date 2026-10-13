import { and, desc, eq, gte, inArray, isNull, lt } from 'drizzle-orm';
import type { AgentsOverview, UserSummary } from '@shillex/shared';
import type { Db } from '../db/client.ts';
import { agentAffinity, agentState, chainTxs, factionMembers, factions, users, worldCoins, type ChainTxRow } from '../db/schema.ts';
import { toUserSummary } from '../services/users.ts';
import { fadedMood } from './state.ts';
import type { Indexer } from '../world/indexer.ts';

/** Rugs since `since`, newest first: each sale in which a coin's creator sold ≥ 70% of the bag it held just before that sale. */
export async function rugSales(db: Db, since: Date): Promise<{ sale: ChainTxRow; soldPct: number }[]> {
  const creatorOf = new Map((await db.select({ mint: worldCoins.mint, creatorId: worldCoins.creatorId }).from(worldCoins)).map((c) => [c.mint, c.creatorId]));
  const sells = await db.select().from(chainTxs).where(and(eq(chainTxs.kind, 'sell'), gte(chainTxs.createdAt, since))).orderBy(desc(chainTxs.createdAt));
  const out: { sale: ChainTxRow; soldPct: number }[] = [];
  for (const s of sells) {
    if (!s.mint || creatorOf.get(s.mint) !== s.agentId) continue;
    // The bag is what the creator held just before this sale (ids are monotonic), so selling in halves is one rug, not two.
    const before = await db.select({ t: chainTxs.tokenDelta }).from(chainTxs)
      .where(and(eq(chainTxs.agentId, s.agentId), eq(chainTxs.mint, s.mint), inArray(chainTxs.kind, ['launch', 'buy', 'sell']), lt(chainTxs.id, s.id)));
    const held = before.reduce((n, x) => n + Number(x.t), 0);
    const soldPct = held > 0 ? (-Number(s.tokenDelta) / held) * 100 : 0;
    if (soldPct >= 70) out.push({ sale: s, soldPct });
  }
  return out;
}

/** What is happening with the agents right now: movers, the worst feuds, newest launches, today's rugs (a creator selling ≥ 70% of its bag) and every mood. Agents only. */
export async function buildOverview(d: { db: Db; indexer: Indexer; now: () => Date }): Promise<AgentsOverview> {
  const { db } = d;
  const [cards, coins, aff, states, agentRows, members] = await Promise.all([
    d.indexer.leaderboard(), d.indexer.coins(),
    db.select().from(agentAffinity), db.select().from(agentState),
    db.select().from(users).where(eq(users.kind, 'agent')),
    db.select({ agentId: factionMembers.agentId, id: factions.id, name: factions.name, colour: factions.colour }).from(factionMembers)
      .innerJoin(factions, eq(factions.id, factionMembers.factionId)).where(and(isNull(factionMembers.leftAt), isNull(factions.splitAt))),
  ]);
  const summary = new Map<string, UserSummary>(agentRows.map((u) => [u.id, toUserSummary(u)]));
  const score = new Map(aff.map((r) => [`${r.agentId}>${r.otherId}`, r.score]));
  const seen = new Set<string>();
  const feuds: AgentsOverview['feuds'] = [];
  for (const r of aff) {
    const key = [r.agentId, r.otherId].sort().join('|');
    if (seen.has(key) || !summary.has(r.agentId) || !summary.has(r.otherId)) continue;
    seen.add(key);
    const mutual = (r.score + (score.get(`${r.otherId}>${r.agentId}`) ?? 0)) / 2;
    if (mutual <= -0.4) feuds.push({ a: summary.get(r.agentId)!, b: summary.get(r.otherId)!, affinity: mutual });
  }
  feuds.sort((x, y) => x.affinity - y.affinity);

  const day = new Date(`${d.now().toISOString().slice(0, 10)}T00:00:00Z`);
  const coinOf = new Map(coins.map((c) => [c.mint, c]));
  const rugs: AgentsOverview['rugs'] = [];
  for (const { sale, soldPct } of await rugSales(db, day)) {
    const coin = coinOf.get(sale.mint!);
    if (coin) rugs.push({ coin, creator: summary.get(sale.agentId!)!, soldPct, at: sale.createdAt.toISOString() });
  }

  const byPnl = [...cards].sort((a, b) => b.pnlSol - a.pnlSol);
  const stateOf = new Map(states.map((s) => [s.agentId, s]));
  const factionOf = new Map(members.map((m) => [m.agentId, { id: m.id, name: m.name, colour: m.colour }]));
  return {
    movers: { up: byPnl.filter((c) => c.pnlSol > 0).slice(0, 5), down: byPnl.filter((c) => c.pnlSol < 0).reverse().slice(0, 5) },
    feuds: feuds.slice(0, 5),
    launches: [...coins].sort((a, b) => b.launchedAt.localeCompare(a.launchedAt)).slice(0, 6),
    rugs,
    moods: cards.map((c) => {
      const st = stateOf.get(c.user.id);
      return { user: c.user, mood: st ? fadedMood(st.mood, st.updatedAt, d.now()) : 0, pnlSol: c.pnlSol, faction: factionOf.get(c.user.id) ?? null, broke: !!st?.brokeSince, ghost: !!st?.ghostSince };
    }),
  };
}
