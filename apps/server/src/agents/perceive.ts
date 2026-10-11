import { and, desc, eq, gte, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import {
  chainTxs, channels, communities, communityMembers, conversationMembers, conversations, messages, notifications, posts, reactions, users, worldCoins,
} from '../db/schema.ts';
import { RAW_PER_TOKEN } from '../world/chain.ts';
import { walletOf } from '../world/wallets.ts';
import type { EngineDeps } from './engine.ts';
import { phrasebookOf } from './phrasebook.ts';
import { affinitiesOf, loadState } from './state.ts';
import type { AgentView } from './types.ts';

export const V_SOL_LAMPORTS = 1_000_000_000;
const MIN = 60_000;

/** Price change implied by net SOL flow on a constant-product curve, where price ∝ (V + reserve)². */
export function flowChange(totalNetLamports: number, windowNetLamports: number): number {
  const after = V_SOL_LAMPORTS + Math.max(0, totalNetLamports);
  const before = Math.max(1, after - windowNetLamports);
  return (after / before) ** 2 - 1;
}

async function coinsView(db: Db, now: Date): Promise<AgentView['coins']> {
  const coins = await db.select().from(worldCoins).orderBy(desc(worldCoins.launchedAt)).limit(60);
  if (!coins.length) return [];
  const mints = coins.map((c) => c.mint);
  const tenAgo = new Date(now.getTime() - 10 * MIN).toISOString(), hourAgo = new Date(now.getTime() - 60 * MIN).toISOString();
  const flows = await db.select({
    mint: chainTxs.mint,
    total: sql<number>`coalesce(sum(-${chainTxs.lamportsDelta}), 0)::float8`,
    h1: sql<number>`coalesce(sum(case when ${chainTxs.createdAt} >= ${hourAgo}::timestamptz then -${chainTxs.lamportsDelta} else 0 end), 0)::float8`,
    m10: sql<number>`coalesce(sum(case when ${chainTxs.createdAt} >= ${tenAgo}::timestamptz then -${chainTxs.lamportsDelta} else 0 end), 0)::float8`,
  }).from(chainTxs).where(and(inArray(chainTxs.mint, mints), inArray(chainTxs.kind, ['buy', 'sell']))).groupBy(chainTxs.mint);
  const holderRows = await db.select({ mint: chainTxs.mint, agentId: chainTxs.agentId }).from(chainTxs).where(inArray(chainTxs.mint, mints))
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
  const costs = mints.length ? await d.db.select({ mint: chainTxs.mint, cost: sql<number>`coalesce(sum(-${chainTxs.lamportsDelta}), 0)::float8` })
    .from(chainTxs).where(and(eq(chainTxs.agentId, agentId), inArray(chainTxs.mint, mints), inArray(chainTxs.kind, ['buy', 'sell', 'launch']))).groupBy(chainTxs.mint) : [];
  const cost = new Map(costs.map((c) => [c.mint!, c.cost]));
  const positions = bal.tokens.flatMap((t) => {
    const c = known.find((k) => k.mint === t.mint);
    if (!c) return [];
    const price = coins.find((x) => x.mint === t.mint)?.priceLamports ?? c.priceLamports ?? 0;
    return [{ mint: t.mint, symbol: c.symbol, raw: t.raw, costLamports: Math.max(0, cost.get(t.mint) ?? 0), valueLamports: Math.floor(price * (t.raw / RAW_PER_TOKEN)), createdByMe: c.creatorId === agentId, creatorId: c.creatorId }];
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
  const since = now.getTime() - 120 * MIN;
  const convs = await db.select({ id: conversations.id }).from(conversationMembers)
    .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
    .where(and(eq(conversationMembers.userId, agentId), eq(conversations.kind, 'dm'))).limit(20);
  const out: AgentView['dms'] = [];
  for (const c of convs) {
    const [last] = await db.select().from(messages).where(and(eq(messages.conversationId, c.id), eq(messages.status, 'visible'))).orderBy(desc(messages.id)).limit(1);
    if (!last || last.authorId === agentId || last.createdAt.getTime() < since) continue;
    const [other] = await db.select({ id: users.id, kind: users.kind }).from(conversationMembers).innerJoin(users, eq(users.id, conversationMembers.userId))
      .where(and(eq(conversationMembers.conversationId, c.id), ne(conversationMembers.userId, agentId)));
    if (other) out.push({ conversationId: c.id, otherId: other.id, otherKind: other.kind, lastBody: last.body, at: last.createdAt.toISOString() });
  }
  return out;
}

async function feedView(db: Db, agentId: string): Promise<AgentView['feed']> {
  const rows = await db.select({ id: posts.id, authorId: posts.authorId, body: posts.body, at: posts.createdAt }).from(posts)
    .where(and(eq(posts.visibility, 'public'), isNull(posts.deletedAt), inArray(posts.kind, ['post', 'quote']), eq(posts.isDemo, false), ne(posts.authorId, agentId)))
    .orderBy(desc(posts.id)).limit(40);
  if (!rows.length) return [];
  const counts = new Map((await db.select({ id: reactions.targetId, n: sql<number>`count(*)::int` }).from(reactions)
    .where(and(eq(reactions.targetType, 'post'), inArray(reactions.targetId, rows.map((r) => r.id)))).groupBy(reactions.targetId)).map((r) => [r.id, r.n]));
  return rows.map((r) => ({ postId: r.id, authorId: r.authorId, body: r.body, at: r.at.toISOString(), reactions: counts.get(r.id) ?? 0 }));
}

async function roomsView(db: Db): Promise<AgentView['rooms']> {
  const rows = await db.select({ communityId: communities.id, slug: communities.slug, roomId: sql<string>`(select ${channels.id} from ${channels} where ${channels.communityId} = ${communities.id} order by ${channels.position} asc limit 1)` })
    .from(communities).where(and(eq(communities.visibility, 'public'), eq(communities.isDemo, false))).limit(50);
  const out: AgentView['rooms'] = [];
  for (const r of rows) {
    if (!r.roomId) continue;
    const [last] = await db.select({ at: messages.createdAt }).from(messages).where(eq(messages.channelId, r.roomId)).orderBy(desc(messages.id)).limit(1);
    const [m] = await db.select({ n: sql<number>`count(*)::int` }).from(communityMembers).where(and(eq(communityMembers.communityId, r.communityId), eq(communityMembers.status, 'active')));
    out.push({ roomId: r.roomId, communitySlug: r.slug, lastAt: (last?.at ?? new Date(0)).toISOString(), members: m?.n ?? 0 });
  }
  return out.sort((a, b) => b.lastAt.localeCompare(a.lastAt)).slice(0, 20);
}

export async function perceive(d: EngineDeps, agentId: string): Promise<AgentView> {
  const now = d.now();
  const [u] = await d.db.select().from(users).where(eq(users.id, agentId));
  if (!u) throw new Error(`No agent ${agentId}`);
  const coins = await coinsView(d.db, now);
  const [state, phrasebook, wallet, mentions, dms, feed, rooms, affinity] = await Promise.all([
    loadState(d.db, agentId, now), phrasebookOf(d.db, agentId), walletView(d, agentId, coins),
    mentionsView(d.db, agentId, now), dmsView(d.db, agentId, now), feedView(d.db, agentId), roomsView(d.db), affinitiesOf(d.db, agentId),
  ]);
  return { agent: { id: u.id, username: u.username, displayName: u.displayName }, state, phrasebook, wallet, coins, mentions, dms, feed, rooms, affinity, weather: 'grind', now: now.toISOString() };
}
