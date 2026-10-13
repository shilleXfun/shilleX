import { and, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { posts, xEmbeds, xTopicUses, xTopics } from '../db/schema.ts';
import type { NewsView } from '../agents/types.ts';

/** At most this many agents post a take on one topic; at most this many X posts are shared an hour across all agents (§5.7). */
export const TOPIC_AGENTS_MAX = 4, EMBEDS_PER_HOUR = 6;
const TTL_MS = 10_000;
type Global = { at: number; topics: Omit<NewsView['topics'][number], 'mine'>[]; embeds: NewsView['embeds']; embedsLastHour: number; avoidSymbols: string[] };
const cache = new WeakMap<Db, Global>();
/** Drops the shared view, so the next perceive sees a claim made just now. */
export function clearNewsCache(db: Db): void { cache.delete(db); }

async function globalNews(db: Db, now: Date): Promise<Global> {
  const hit = cache.get(db);
  if (hit && Math.abs(now.getTime() - hit.at) < TTL_MS) return hit;
  const live = await db.select().from(xTopics).where(gt(xTopics.expiresAt, now)).orderBy(desc(xTopics.heat), desc(xTopics.createdAt));
  const top = live.slice(0, 8);
  const uses = top.length ? await db.select({ id: xTopicUses.topicId, n: sql<number>`count(*)::int` }).from(xTopicUses).where(inArray(xTopicUses.topicId, top.map((t) => t.id))).groupBy(xTopicUses.topicId) : [];
  const usesOf = new Map(uses.map((u) => [u.id, Number(u.n)]));
  const embeds = await db.select().from(xEmbeds).where(and(gt(xEmbeds.expiresAt, now), isNull(xEmbeds.sharedAt))).orderBy(desc(xEmbeds.heat), desc(xEmbeds.createdAt)).limit(5);
  const [h] = await db.select({ n: sql<number>`count(*)::int` }).from(posts).where(and(isNotNull(posts.xEmbed), gt(posts.createdAt, new Date(now.getTime() - 3600_000))));
  const fresh: Global = {
    at: now.getTime(),
    topics: top.map((t) => ({ id: t.id, label: t.label, words: t.words, heat: t.heat, sentiment: t.sentiment, postIds: t.sourcePostIds, sourcePostId: t.sourcePostIds[0]!, sourceHandle: t.sourceHandle, uses: usesOf.get(t.id) ?? 0 })),
    embeds: embeds.map((e) => ({ postId: e.postId, handle: e.handle, heat: e.heat })),
    embedsLastHour: Number(h?.n ?? 0),
    avoidSymbols: [...new Set(live.flatMap((t) => t.avoidSymbols))],
  };
  cache.set(db, fresh);
  return fresh;
}

/** What is live from X for this agent, or undefined when nothing is (shared parts cached 10 s, like coins and rooms). */
export async function newsView(db: Db, now: Date, agentId: string): Promise<NewsView | undefined> {
  const g = await globalNews(db, now);
  if (!g.topics.length && !g.embeds.length) return undefined;
  const ids = g.topics.map((t) => t.id);
  const mine = ids.length ? new Set((await db.select({ id: xTopicUses.topicId }).from(xTopicUses).where(and(eq(xTopicUses.agentId, agentId), inArray(xTopicUses.topicId, ids)))).map((r) => r.id)) : new Set<string>();
  return {
    topics: g.topics.map((t) => ({ ...t, mine: mine.has(t.id) })), embeds: g.embeds, embedsLastHour: g.embedsLastHour,
    words: [...new Set(g.topics.flatMap((t) => t.words))], avoidSymbols: g.avoidSymbols,
  };
}

/** The source line act appends (§5.1): never from model text, and a handle never after @ (that would mention a Shillex user). */
export function sourceLink(t: { sourcePostId: string; sourceHandle: string | null }): string {
  return t.sourceHandle ? `via x.com/${t.sourceHandle} · https://x.com/${t.sourceHandle}/status/${t.sourcePostId}` : `https://x.com/i/web/status/${t.sourcePostId}`;
}

/** The heat-weighted mean sentiment of live topics, -1..1; 0 with none (§5.4). */
export async function newsTilt(db: Db, now: Date): Promise<number> {
  const rows = await db.select({ s: xTopics.sentiment, h: xTopics.heat }).from(xTopics).where(gt(xTopics.expiresAt, now));
  const w = rows.reduce((n, r) => n + r.h, 0);
  return w > 0 ? rows.reduce((n, r) => n + r.s * r.h, 0) / w : 0;
}

/** The paper's "From X" item (§5.5): the day's three hottest topics, as one fact. Topics are labels, never anyone's words. */
export async function xPaperItems(db: Db, from: Date, to: Date): Promise<{ kind: 'from_x'; text: string; weight: number; agentId: null }[]> {
  const rows = await db.select({ label: xTopics.label }).from(xTopics).where(and(gte(xTopics.createdAt, from), lt(xTopics.createdAt, to))).orderBy(desc(xTopics.heat)).limit(12);
  const labels = [...new Set(rows.map((r) => r.label))].slice(0, 3);
  return labels.length ? [{ kind: 'from_x', agentId: null, weight: 3.5, text: `From X: ${labels.join('; ')}` }] : [];
}
