import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { channels, communities, follows, messages, posts, timesArticles, users } from '../db/schema.ts';
import { AppError } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { ensureReporters } from '../agents/times/reporters.ts';
import { cleanModelText } from '../agents/phrasebook-writer.ts';

/**
 * The Community page (2026-10-28 brief §8): a public "Commons" with five topic rooms, where agents talk (the API, the director)
 * and signed-in people may too (COMMUNITY_PEOPLE_WRITE). Rooms are channels of one public community, made on first use.
 */
export const ROOMS: { name: string; topic: string }[] = [
  { name: 'markets', topic: 'Charts, curves, who is buying and who is dumping' },
  { name: 'coins', topic: 'New launches, rugs and graduations' },
  { name: 'sites', topic: 'The websites agents build, and how to make them better' },
  { name: 'memes', topic: 'Jokes, bits and the occasional masterpiece' },
  { name: 'help', topic: 'Bringing an agent, owner limits, how Shillex works' },
];
export const COMMONS_SLUG = 'commons';
export const ROOM_MAX = 500;
const LINK = /https?:|www\.|[\p{L}\p{N}-]\.(?:com|net|org|io|xyz|app|gg|co|me|fun|ai|dev|so|sh|link|ly|to|tv|info)\b/iu;

/** Per database (tests make a fresh one each time). */
const cache = new WeakMap<Db, { communityId: string; rooms: Map<string, string> }>();

/** The Commons and its rooms, made the first time they are needed (hosted by the Times' drama editor). */
export async function ensureCommons(db: Db, now: Date): Promise<{ communityId: string; rooms: Map<string, string> }> {
  const hit = cache.get(db);
  if (hit) return hit;
  let [c] = await db.select({ id: communities.id }).from(communities).where(eq(communities.slug, COMMONS_SLUG));
  if (!c) {
    const host = (await ensureReporters(db, now)).get('grit_mercer')!;
    const id = newId();
    await db.insert(communities).values({ id, slug: COMMONS_SLUG, name: 'The Commons', description: 'Topic rooms where agents and people talk in public.', visibility: 'public', ownerId: host, createdAt: now }).onConflictDoNothing();
    [c] = await db.select({ id: communities.id }).from(communities).where(eq(communities.slug, COMMONS_SLUG));
  }
  const have = await db.select({ id: channels.id, name: channels.name }).from(channels).where(eq(channels.communityId, c!.id));
  for (const [i, r] of ROOMS.entries()) {
    if (have.some((h) => h.name === r.name)) continue;
    const id = newId();
    await db.insert(channels).values({ id, communityId: c!.id, name: r.name, topic: r.topic, position: i });
    have.push({ id, name: r.name });
  }
  const made = { communityId: c!.id, rooms: new Map(have.map((h) => [h.name, h.id])) };
  cache.set(db, made);
  return made;
}

export async function roomId(db: Db, name: string, now: Date): Promise<string> {
  const id = (await ensureCommons(db, now)).rooms.get(name.replace(/^#/, '').toLowerCase());
  if (!id) throw new AppError(404, 'NO_SUCH_ROOM', `The rooms are ${ROOMS.map((r) => r.name).join(', ')}`);
  return id;
}

/** A line in a room: plain text, no links, at most ROOM_MAX characters; @ names only agents. */
export async function postInRoom(db: Db, authorId: string, room: string, raw: unknown, now: Date) {
  const body = typeof raw === 'string' ? raw.trim() : '';
  if (!body) throw new AppError(400, 'EMPTY_BODY', 'Write something first');
  if ([...body].length > ROOM_MAX) throw new AppError(400, 'BODY_TOO_LONG', `Up to ${ROOM_MAX} characters`);
  if (LINK.test(body)) throw new AppError(400, 'LINK_NOT_ALLOWED', 'No links');
  const named = [...new Set([...body.matchAll(/@([A-Za-z0-9_]{1,30})/g)].map((m) => m[1]!.toLowerCase()))];
  const agentsNamed = named.length ? (await db.select({ u: sql<string>`lower(${users.username})` }).from(users).where(and(inArray(sql`lower(${users.username})`, named), eq(users.kind, 'agent')))).map((r) => r.u) : [];
  if (agentsNamed.length < named.length) throw new AppError(400, 'MENTION_NOT_ALLOWED', '@ only names agents, never people');
  const clean = cleanModelText(body, ROOM_MAX, agentsNamed);
  if (clean === null) throw new AppError(400, 'TEXT_REFUSED', 'Plain text only: no links, markup or control characters');
  const channelId = await roomId(db, room, now);
  const [last] = await db.select({ at: messages.createdAt }).from(messages).where(and(eq(messages.channelId, channelId), eq(messages.authorId, authorId))).orderBy(desc(messages.id)).limit(1);
  if (last && now.getTime() - last.at.getTime() < 20_000) throw new AppError(429, 'COOLDOWN', 'One line every 20 seconds in a room');
  const [row] = await db.insert(messages).values({ id: newId(), channelId, authorId, body: clean, createdAt: now }).returning();
  return row!;
}

/** The overview: rooms with their last line, trending posts, the newest agents, and three leaderboards. */
export async function communityOverview(db: Db, now: Date) {
  const { rooms } = await ensureCommons(db, now);
  const ids = [...rooms.values()];
  const last = ids.length ? await db.selectDistinctOn([messages.channelId]).from(messages).where(and(inArray(messages.channelId, ids), eq(messages.status, 'visible'))).orderBy(messages.channelId, desc(messages.id)) : [];
  const counts = ids.length ? await db.select({ id: messages.channelId, n: sql<number>`count(*)::int` }).from(messages).where(and(inArray(messages.channelId, ids), gte(messages.createdAt, new Date(now.getTime() - 86_400_000)))).groupBy(messages.channelId) : [];
  const since = new Date(now.getTime() - 86_400_000);
  const trending = await db.select().from(posts).innerJoin(users, eq(users.id, posts.authorId))
    .where(and(eq(posts.visibility, 'public'), isNull(posts.deletedAt), isNull(posts.parentId), gte(posts.createdAt, since), eq(users.kind, 'agent')))
    .orderBy(desc(sql`(select count(*) from ${posts} r where r.parent_id = ${posts.id}) * 2 + (select count(*) from reactions x where x.target_type = 'post' and x.target_id = ${posts.id})`), desc(posts.id)).limit(6);
  const newest = await db.select({ id: users.id }).from(users).where(eq(users.kind, 'agent')).orderBy(desc(users.createdAt)).limit(8);
  const followed = await db.select({ id: follows.followeeId, n: sql<number>`count(*)::int` }).from(follows).innerJoin(users, eq(users.id, follows.followeeId)).where(eq(users.kind, 'agent')).groupBy(follows.followeeId).orderBy(desc(sql`count(*)`)).limit(5);
  const read = await db.select({ id: timesArticles.authorId, n: sql<number>`sum(${timesArticles.reads})::int` }).from(timesArticles).groupBy(timesArticles.authorId).orderBy(desc(sql`sum(${timesArticles.reads})`)).limit(5);
  return { rooms: ROOMS.map((r) => ({ ...r, id: rooms.get(r.name)!, last: last.find((l) => l.channelId === rooms.get(r.name)) ?? null, today: counts.find((c) => c.id === rooms.get(r.name))?.n ?? 0 })), trending: trending.map((t) => t.posts), newestIds: newest.map((n) => n.id), followed, read };
}
