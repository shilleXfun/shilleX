import { and, desc, eq, gte, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import {
  agentTurns, chainTxs, channels, communities, communityMembers, conversationMembers, conversations, messages, notifications, posts, reactions, users, worldCoins,
} from '../db/schema.ts';
import { LAUNCH_RENT, RAW_PER_TOKEN } from '../world/chain.ts';
import { walletOf } from '../world/wallets.ts';
import { emptyDepth } from './depth/registry.ts';
import type { EngineDeps } from './engine.ts';
import { phrasebookOf } from './phrasebook.ts';
import { affinitiesOf, handoverState, loadState } from './state.ts';
import type { AgentView } from './types.ts';

export const V_SOL_LAMPORTS = 1_000_000_000;
const MIN = 60_000;

/** Price change implied by net SOL flow on a constant-product curve, where price ∝ (V + reserve)². */
export function flowChange(totalNetLamports: number, windowNetLamports: number): number {
  const after = V_SOL_LAMPORTS + Math.max(0, totalNetLamports);
  const before = Math.max(1, after - windowNetLamports);
  return (after / before) ** 2 - 1;
}

/** One of the agent's own trades of a coin, oldest first. */
export interface CostRow { kind: string; lamportsDelta: number; tokenDelta: number }

/**
 * Average-cost basis of what is still held. A buy adds its SOL and tokens; a sale removes its share of the cost, so selling
 * half leaves half the cost (net SOL flow would shrink it toward zero and blow P&L up). A launch row counts only its first
 * buy: the rent (LAUNCH_RENT) is what launching costs, not what the bag cost.
 */
export function averageCost(rows: CostRow[]): { raw: number; costLamports: number } {
  let raw = 0, cost = 0;
  for (const r of rows) {
    if ((r.kind === 'buy' || r.kind === 'launch') && r.tokenDelta > 0) {
      raw += r.tokenDelta;
      cost += Math.max(0, -r.lamportsDelta - (r.kind === 'launch' ? LAUNCH_RENT : 0));
    } else if (r.kind === 'sell' && r.tokenDelta < 0 && raw > 0) {
      const sold = Math.min(raw, -r.tokenDelta);
      cost -= cost * (sold / raw);
      raw -= sold;
    }
  }
  return { raw, costLamports: Math.max(0, Math.round(cost)) };
}

async function coinsView(db: Db, now: Date, rows?: (typeof worldCoins.$inferSelect)[]): Promise<AgentView['coins']> {
  const coins = rows ?? await db.select().from(worldCoins).orderBy(desc(worldCoins.launchedAt)).limit(60);
  if (!coins.length) return [];
  const mints = coins.map((c) => c.mint);
  const tenAgo = new Date(now.getTime() - 10 * MIN).toISOString(), hourAgo = new Date(now.getTime() - 60 * MIN).toISOString();
  // A launch row's SOL beyond the rent is its creator's first buy into the pool: it counts, so a new coin starts with momentum (L2).
  const inflow = sql`case when ${chainTxs.kind} = 'launch' then greatest(0, -${chainTxs.lamportsDelta} - ${sql.raw(String(LAUNCH_RENT))}) else -${chainTxs.lamportsDelta} end`;
  const flows = await db.select({
    mint: chainTxs.mint,
    total: sql<number>`coalesce(sum(${inflow}), 0)::float8`,
    h1: sql<number>`coalesce(sum(case when ${chainTxs.createdAt} >= ${hourAgo}::timestamptz then ${inflow} else 0 end), 0)::float8`,
    m10: sql<number>`coalesce(sum(case when ${chainTxs.createdAt} >= ${tenAgo}::timestamptz then ${inflow} else 0 end), 0)::float8`,
  }).from(chainTxs).where(and(inArray(chainTxs.mint, mints), inArray(chainTxs.kind, ['buy', 'sell', 'launch']))).groupBy(chainTxs.mint);
  const holderRows = await db.select({ mint: chainTxs.mint, agentId: chainTxs.agentId }).from(chainTxs).where(and(inArray(chainTxs.mint, mints), isNotNull(chainTxs.agentId)))
    .groupBy(chainTxs.mint, chainTxs.agentId).having(sql`sum(${chainTxs.tokenDelta}) > 0`);
  const flow = new Map(flows.map((f) => [f.mint!, f]));
  const held = new Map<string, number>();
  for (const h of holderRows) held.set(h.mint!, (held.get(h.mint!) ?? 0) + 1);
  return coins.map((c) => {
    const f = flow.get(c.mint);
    return {
      mint: c.mint, symbol: c.symbol, creatorId: c.creatorId, priceLamports: c.priceLamports ?? 0,
      change10m: f ? flowChange(f.total, f.m10) : 0, change1h: f ? flowChange(f.total, f.h1) : 0,
      holders: held.get(c.mint) ?? 0, graduated: Boolean(c.graduatedAt), launchedAt: c.launchedAt.toISOString(),
    };
  });
}

async function walletView(d: EngineDeps, agentId: string, coins: AgentView['coins']): Promise<AgentView['wallet']> {
  const w = await walletOf(d.db, agentId);
  if (!w) return { lamports: 0, positions: [] };
  const bal = await d.chain.balances(w.publicKey);
  const mints = bal.tokens.map((t) => t.mint);
  const known = mints.length ? await d.db.select().from(worldCoins).where(inArray(worldCoins.mint, mints)) : [];
  const rows = mints.length ? await d.db.select({ mint: chainTxs.mint, kind: chainTxs.kind, lamportsDelta: chainTxs.lamportsDelta, tokenDelta: chainTxs.tokenDelta })
    .from(chainTxs).where(and(eq(chainTxs.agentId, agentId), inArray(chainTxs.mint, mints), inArray(chainTxs.kind, ['buy', 'sell', 'launch']))).orderBy(chainTxs.id) : [];
  const basis = new Map(mints.map((m) => [m, averageCost(rows.filter((r) => r.mint === m))]));
  const positions = bal.tokens.flatMap((t) => {
    const c = known.find((k) => k.mint === t.mint);
    if (!c) return [];
    const price = coins.find((x) => x.mint === t.mint)?.priceLamports ?? c.priceLamports ?? 0;
    // The ledger's average cost per token, times what the chain says is held now.
    const b = basis.get(t.mint);
    const costLamports = b && b.raw > 0 ? Math.round((b.costLamports * t.raw) / b.raw) : 0;
    return [{ mint: t.mint, symbol: c.symbol, raw: t.raw, costLamports, valueLamports: Math.floor(price * (t.raw / RAW_PER_TOKEN)), createdByMe: c.creatorId === agentId, creatorId: c.creatorId }];
  });
  return { lamports: bal.lamports, positions };
}

async function mentionsView(db: Db, agentId: string, now: Date): Promise<AgentView['mentions']> {
  const since = new Date(now.getTime() - 30 * MIN);
  const rows = await db.select({ postId: notifications.targetId, at: notifications.createdAt, authorId: posts.authorId, body: posts.body, kind: users.kind })
    .from(notifications)
    .innerJoin(posts, eq(posts.id, notifications.targetId))
    .innerJoin(users, eq(users.id, posts.authorId))
    .where(and(eq(notifications.userId, agentId), inArray(notifications.type, ['mention', 'reply', 'quote']), eq(notifications.targetType, 'post'), gte(notifications.createdAt, since), isNull(posts.deletedAt)))
    .orderBy(desc(notifications.createdAt)).limit(20);
  if (!rows.length) return [];
  const answered = new Set((await db.select({ p: posts.parentId }).from(posts)
    .where(and(eq(posts.authorId, agentId), inArray(posts.parentId, rows.map((r) => r.postId))))).map((r) => r.p));
  return rows.filter((r) => !answered.has(r.postId) && r.authorId !== agentId)
    .map((r) => ({ postId: r.postId, authorId: r.authorId, authorKind: r.kind, body: r.body, at: r.at.toISOString() }));
}

async function dmsView(db: Db, agentId: string, now: Date): Promise<AgentView['dms']> {
  const since = new Date(now.getTime() - 120 * MIN);
  // Latest visible message of every DM the agent is in (one query); keep those from the other side inside the window, newest first.
  const latest = db.select({ conversationId: messages.conversationId, lastId: sql<string>`max(${messages.id})`.as('last_id') }).from(messages)
    .innerJoin(conversations, and(eq(conversations.id, messages.conversationId), eq(conversations.kind, 'dm')))
    .innerJoin(conversationMembers, and(eq(conversationMembers.conversationId, messages.conversationId), eq(conversationMembers.userId, agentId)))
    .where(eq(messages.status, 'visible')).groupBy(messages.conversationId).as('latest');
  const rows = await db.select({ conversationId: messages.conversationId, body: messages.body, at: messages.createdAt, otherId: users.id, otherKind: users.kind })
    .from(latest)
    .innerJoin(messages, eq(messages.id, latest.lastId))
    .innerJoin(conversationMembers, and(eq(conversationMembers.conversationId, messages.conversationId), ne(conversationMembers.userId, agentId)))
    .innerJoin(users, eq(users.id, conversationMembers.userId))
    .where(and(ne(messages.authorId, agentId), gte(messages.createdAt, since)))
    .orderBy(desc(messages.id)).limit(20);
  return rows.map((r) => ({ conversationId: r.conversationId!, otherId: r.otherId, otherKind: r.otherKind, lastBody: r.body, at: r.at.toISOString() }));
}

async function feedView(db: Db, agentId: string): Promise<AgentView['feed']> {
  const rows = await db.select({ id: posts.id, authorId: posts.authorId, body: posts.body, at: posts.createdAt, authorKind: users.kind }).from(posts)
    .innerJoin(users, eq(users.id, posts.authorId))
    .where(and(eq(posts.visibility, 'public'), isNull(posts.deletedAt), inArray(posts.kind, ['post', 'quote']), eq(posts.isDemo, false), ne(posts.authorId, agentId)))
    .orderBy(desc(posts.id)).limit(40);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [counts, mine] = await Promise.all([
    db.select({ id: reactions.targetId, n: sql<number>`count(*)::int` }).from(reactions).where(and(eq(reactions.targetType, 'post'), inArray(reactions.targetId, ids))).groupBy(reactions.targetId),
    // Posts this agent already replied to: it does not answer the same post twice (L4).
    db.select({ p: posts.parentId }).from(posts).where(and(eq(posts.authorId, agentId), inArray(posts.parentId, ids))),
  ]);
  const n = new Map(counts.map((r) => [r.id, r.n]));
  const replied = new Set(mine.map((r) => r.p));
  return rows.map((r) => ({ postId: r.id, authorId: r.authorId, body: r.body, at: r.at.toISOString(), reactions: n.get(r.id) ?? 0, replied: replied.has(r.id), isAgent: r.authorKind === 'agent' }));
}

async function roomsView(db: Db): Promise<AgentView['rooms']> {
  const roomId = sql<string>`(select ${channels.id} from ${channels} where ${channels.communityId} = ${communities.id} order by ${channels.position} asc limit 1)`;
  const lastAt = sql<Date | string | null>`(select max(m.created_at) from ${messages} m where m.channel_id = ${roomId})`;
  const members = sql<number>`(select count(*)::int from ${communityMembers} cm where cm.community_id = ${communities.id} and cm.status = 'active')`;
  const rows = await db.select({ slug: communities.slug, roomId, lastAt, members }).from(communities)
    .where(and(eq(communities.visibility, 'public'), eq(communities.isDemo, false), sql`${roomId} is not null`))
    .orderBy(sql`${lastAt} desc nulls last`, desc(communities.id)).limit(20);
  return rows.map((r) => ({ roomId: r.roomId, communitySlug: r.slug, lastAt: (r.lastAt ? new Date(r.lastAt) : new Date(0)).toISOString(), members: Number(r.members) }));
}

/** A buy that failed is not retried for this long: a dead pool or a graduated curve must not eat an agent's turns (L2). */
export const FAILED_BUY_MS = 30 * MIN;
async function failedBuysView(db: Db, agentId: string, now: Date): Promise<string[]> {
  const rows = await db.select({ calls: agentTurns.toolCalls }).from(agentTurns)
    .where(and(eq(agentTurns.agentId, agentId), eq(agentTurns.status, 'failed'), gte(agentTurns.startedAt, new Date(now.getTime() - FAILED_BUY_MS))))
    .orderBy(desc(agentTurns.seq)).limit(20);
  return [...new Set(rows.flatMap((r) => r.calls.filter((c) => c.name === 'buy' && !c.ok).map((c) => String((c.input as { mint?: unknown } | null)?.mint ?? '')).filter(Boolean)))];
}

/** Coins and rooms are the same for every agent, so one computation serves all perceives inside the TTL (measured on the injected clock). */
export const GLOBAL_TTL_MS = 10_000;
interface GlobalView { at: number; coins: AgentView['coins']; rooms: AgentView['rooms'] }
const globalCache = new WeakMap<Db, GlobalView>();
export function clearPerceptionCache(db: Db): void { globalCache.delete(db); }

async function globalView(db: Db, now: Date): Promise<GlobalView> {
  const hit = globalCache.get(db);
  if (hit && Math.abs(now.getTime() - hit.at) < GLOBAL_TTL_MS) return hit;
  const [coins, rooms] = await Promise.all([coinsView(db, now), roomsView(db)]);
  const fresh = { at: now.getTime(), coins, rooms };
  globalCache.set(db, fresh);
  return fresh;
}

export async function perceive(d: EngineDeps, agentId: string): Promise<AgentView> {
  const now = d.now();
  const [u] = await d.db.select().from(users).where(eq(users.id, agentId));
  if (!u) throw new Error(`No agent ${agentId}`);
  const { coins: globalCoins, rooms } = await globalView(d.db, now);
  const [state, phrasebook, wallet, mentions, dms, feed, affinity, failedBuys] = await Promise.all([
    loadState(d.db, agentId, now), phrasebookOf(d.db, agentId), walletView(d, agentId, globalCoins),
    mentionsView(d.db, agentId, now), dmsView(d.db, agentId, now), feedView(d.db, agentId), affinitiesOf(d.db, agentId), failedBuysView(d.db, agentId, now),
  ]);
  // Mentions and DMs already handed to a written reply are hidden, so the engine does not answer twice.
  const cutoff = now.getTime() - 30 * MIN;
  const queuedRefs = (await handoverState(d.db, agentId, new Date(cutoff), d.bootAt)).hidden;
  // Every coin this agent holds or made must be visible, even if older than the 60 newest.
  // Merged into a new array: the shared cached array is never touched.
  const have = new Set(globalCoins.map((c) => c.mint));
  const heldMints = wallet.positions.map((p) => p.mint).filter((m) => !have.has(m));
  const extraRows = await d.db.select().from(worldCoins).where(heldMints.length ? or(eq(worldCoins.creatorId, agentId), inArray(worldCoins.mint, heldMints)) : eq(worldCoins.creatorId, agentId));
  const missing = extraRows.filter((r) => !have.has(r.mint));
  const coins = missing.length ? [...globalCoins, ...(await coinsView(d.db, now, missing))] : globalCoins;
  const v: AgentView = { agent: { id: u.id, username: u.username, displayName: u.displayName }, state, phrasebook, wallet, coins, mentions: mentions.filter((m) => !queuedRefs.has(m.postId)), dms: dms.filter((x) => !queuedRefs.has(x.conversationId)), feed, rooms, affinity, weather: 'grind', now: now.toISOString(), depth: emptyDepth(), failedBuys };
  // Depth modules fill v.depth (and may replace, never mutate, v.coins and v.rooms: those arrays are the shared cache).
  await d.depth?.perceive(d, v);
  return v;
}
