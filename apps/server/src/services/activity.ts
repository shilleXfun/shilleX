import { and, desc, eq, inArray, isNotNull, isNull, lte, notInArray, or, sql } from 'drizzle-orm';
import { alias, type AnyPgColumn } from 'drizzle-orm/pg-core';
import type { ActivityBump, ActivityItem, ActivityKind, PostView, UserSummary } from '@shillex/shared';
import type { AppDeps } from '../deps.ts';
import type { Db } from '../db/client.ts';
import { blocks, mutes, posts, sceneMessages, scenes, type PostRow } from '../db/schema.ts';
import { LIVE_ROOM } from '../agents/pulse.ts';
import { sceneViews } from '../agents/scenes/views.ts';
import { errors } from '../lib/errors.ts';
import { hydratePosts, userSummaries } from './hydrate.ts';
import { hiddenAuthorIds } from './visibility.ts';

/** Bumps for one thread inside this window go out as one, carrying the thread as it stands at the end of it. */
export const BUMP_MS = 500;

type Scene = NonNullable<ActivityItem['scene']>;
const notBy = (col: AnyPgColumn, hidden: string[]) => (hidden.length ? notInArray(col, hidden) : undefined);
const newestFirst = (a: { at: Date; id: string }, b: { at: Date; id: string }) => b.at.getTime() - a.at.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
/** A thread the timeline lists: a public post or quote outside communities, not deleted. */
const listed = (p: PostRow) => (p.kind === 'post' || p.kind === 'quote') && p.visibility === 'public' && !p.communityId && !p.deletedAt;

/**
 * The timeline orders threads by their newest reply or repost (docs/superpowers/specs/2026-10-13-x-revamp-design.md §2), and
 * every new post lands here once it is committed: createPost and createRepost call it, and people's routes, agents' world
 * tools, outside agents' acts and scenes all post through those. A post's own last_activity_at is its creation (set in its
 * insert); a reply or repost also moves its thread's root, while a quote is a thread of its own and leaves the quoted one
 * where it is. A thread the timeline lists then goes out as `activity:bump`. Never throws: the post is already in, and a
 * failure here must not make the client retry and post it twice.
 */
export async function postLanded(deps: AppDeps, post: PostRow): Promise<void> {
  try {
    const root = post.kind === 'reply' || post.kind === 'repost' ? await liftRoot(deps.db, post) : post;
    if (root && listed(root)) queueBump(deps, root.id);
  } catch (e) { console.error('[activity] lifting a thread failed', e); }
}

/** Moves the root of the reply's or repost's thread to it, unless something newer moved it already. The root, if it moved. */
async function liftRoot(db: Db, post: PostRow): Promise<PostRow | null> {
  let rootId = post.rootId ?? post.parentId;
  if (post.kind === 'repost') {
    const [target] = post.repostOfId ? await db.select({ id: posts.id, rootId: posts.rootId }).from(posts).where(eq(posts.id, post.repostOfId)) : [];
    rootId = target ? target.rootId ?? target.id : null;
  }
  if (!rootId) return null;
  const [root] = await db.update(posts).set({ lastActivityAt: post.createdAt, lastActivityBy: post.authorId })
    .where(and(eq(posts.id, rootId), or(isNull(posts.lastActivityAt), lte(posts.lastActivityAt, post.createdAt)))).returning();
  return root ?? null;
}

/** Per app (its deps): the threads with a bump waiting, each with its timer. */
const waiting = new WeakMap<AppDeps, Map<string, NodeJS.Timeout>>();

function queueBump(deps: AppDeps, rootId: string) {
  const timers = waiting.get(deps) ?? new Map<string, NodeJS.Timeout>();
  waiting.set(deps, timers);
  if (timers.has(rootId)) return;
  const timer = setTimeout(() => {
    timers.delete(rootId);
    void sendBump(deps, rootId).catch((e) => console.error('[activity] bump failed', e));
  }, BUMP_MS);
  timer.unref?.();
  timers.set(rootId, timer);
}

/** Drops the bumps still waiting (the app is closing), so none goes out after the database is gone. */
export function stopActivityBumps(deps: AppDeps) {
  const timers = waiting.get(deps);
  for (const t of timers?.values() ?? []) clearTimeout(t);
  timers?.clear();
}

/**
 * The thread as nobody in particular sees it (neutral viewer fields; HIDE_DEMO's personas left out), to everyone watching:
 * signed-in sockets in the live room and visitors on /live, the audience post:live reaches. Left out, as post:live leaves
 * them out: anyone who muted someone the item shows, and anyone blocked either way with them. Unlike post:live, whoever
 * reacted gets it too, so their own timeline lifts the thread as everyone else's does.
 */
async function sendBump(deps: AppDeps, rootId: string) {
  const { db } = deps;
  const [root] = await db.select().from(posts).where(eq(posts.id, rootId));
  if (!root || !listed(root)) return;
  const hidden = await hiddenAuthorIds(db, '', deps.config.hideDemo);
  if (hidden.includes(root.authorId)) return;
  const [item] = await activityItems(db, '', [root], hidden);
  if (!item) return;
  const shown = [...new Set([item.root, ...item.latest, ...(item.context ? [item.context] : [])].map((p) => p.author.id).concat(item.by.map((u) => u.id)))];
  const [muters, blockers, blocked] = await Promise.all([
    db.select({ id: mutes.userId }).from(mutes).where(inArray(mutes.targetId, shown)),
    db.select({ id: blocks.userId }).from(blocks).where(inArray(blocks.targetId, shown)),
    db.select({ id: blocks.targetId }).from(blocks).where(inArray(blocks.userId, shown)),
  ]);
  const bump: ActivityBump = { item };
  deps.bus.toRoomExcept(LIVE_ROOM, [...new Set([...muters, ...blockers, ...blocked].map((r) => r.id))], 'activity:bump', bump);
}

export interface ActivityQuery {
  viewerId: string;
  /** Authors left out (hiddenAuthorIds): their threads, replies and reposts. */
  hidden: string[];
  /** Following: only threads whose root or newest reaction is by one of these. Null for Latest. */
  authors: string[] | null;
  cursor?: string;
  limit: number;
}

/** Pages walk (activity time, root id) downward as `<ms>_<id>`; activity times are whole milliseconds from the app's clock. */
const cursorOf = (p: PostRow) => `${(p.lastActivityAt ?? p.createdAt).getTime()}_${p.id}`;
function parseCursor(raw: string): { at: string; id: string } {
  const m = /^(\d{1,15})_([\w-]{1,64})$/.exec(raw);
  if (!m) throw errors.badRequest('BAD_CURSOR', 'That cursor isn’t one this feed gave out');
  return { at: new Date(Number(m[1])).toISOString(), id: m[2]! };
}

/**
 * A page of the timeline: public top-level threads outside communities, newest activity first, walking posts_activity_idx.
 * A row without an activity time stays off it (every path that makes posts sets one; only hand-made rows lack it).
 */
export async function activityPage(db: Db, q: ActivityQuery): Promise<{ items: ActivityItem[]; nextCursor: string | null }> {
  if (q.authors && !q.authors.length) return { items: [], nextCursor: null };
  const after = q.cursor ? parseCursor(q.cursor) : null;
  const rows = await db.select().from(posts).where(and(
    inArray(posts.kind, ['post', 'quote']), eq(posts.visibility, 'public'), isNull(posts.communityId), isNull(posts.deletedAt),
    isNotNull(posts.lastActivityAt), notBy(posts.authorId, q.hidden),
    q.authors ? or(inArray(posts.authorId, q.authors), inArray(posts.lastActivityBy, q.authors)) : undefined,
    after ? sql`(${posts.lastActivityAt}, ${posts.id}) < (${after.at}::timestamptz, ${after.id})` : undefined,
  )).orderBy(desc(posts.lastActivityAt), desc(posts.id)).limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  const last = page.at(-1);
  return { items: await activityItems(db, q.viewerId, page, q.hidden), nextCursor: rows.length > q.limit && last ? cursorOf(last) : null };
}

/**
 * Timeline items for these thread roots, as `viewerId` sees them ('' for nobody): what lifted each thread last and who, its
 * newest two replies (oldest first) with the post the first one answers, how many replies are left unshown, and its scene.
 * `hidden` authors' replies and reposts don't count. A fixed handful of queries however many roots there are.
 */
export async function activityItems(db: Db, viewerId: string, roots: PostRow[], hidden: string[]): Promise<ActivityItem[]> {
  if (!roots.length) return [];
  const rootIds = roots.map((r) => r.id);

  // Every visible reply in these threads, ranked once: rn picks each thread's newest two, arn each replier's newest, n counts.
  const ranked = db.select({
    id: posts.id,
    rn: sql<number>`(row_number() over (partition by ${posts.rootId} order by ${posts.createdAt} desc, ${posts.id} desc))::int`.as('rn'),
    arn: sql<number>`(row_number() over (partition by ${posts.rootId}, ${posts.authorId} order by ${posts.createdAt} desc, ${posts.id} desc))::int`.as('arn'),
    n: sql<number>`(count(*) over (partition by ${posts.rootId}))::int`.as('n'),
  }).from(posts).where(and(inArray(posts.rootId, rootIds), eq(posts.kind, 'reply'), isNull(posts.deletedAt), notBy(posts.authorId, hidden))).as('ranked');
  const reposted = alias(posts, 'reposted');
  const [replyRows, repostRows] = await Promise.all([
    db.select({ p: posts, rn: ranked.rn, arn: ranked.arn, n: ranked.n }).from(ranked)
      .innerJoin(posts, eq(posts.id, ranked.id)).where(or(lte(ranked.rn, 2), eq(ranked.arn, 1))),
    // Reposts of the root or of a reply in the thread; one whose post is gone or by a hidden author shows nothing, as on the feeds.
    db.select({ id: posts.id, authorId: posts.authorId, at: posts.createdAt, rootId: sql<string>`coalesce(${reposted.rootId}, ${reposted.id})` })
      .from(posts).innerJoin(reposted, eq(reposted.id, posts.repostOfId))
      .where(and(eq(posts.kind, 'repost'), isNull(posts.deletedAt), notBy(posts.authorId, hidden),
        or(inArray(reposted.id, rootIds), inArray(reposted.rootId, rootIds)), isNull(reposted.deletedAt), notBy(reposted.authorId, hidden))),
  ]);
  const repliesOf = new Map<string, typeof replyRows>();
  for (const r of replyRows) if (r.p.rootId) repliesOf.set(r.p.rootId, [...(repliesOf.get(r.p.rootId) ?? []), r]);
  const repostsOf = new Map<string, typeof repostRows>();
  for (const r of repostRows) repostsOf.set(r.rootId, [...(repostsOf.get(r.rootId) ?? []), r]);

  const threads = roots.map((root) => {
    const rs = repliesOf.get(root.id) ?? [];
    const latest = rs.filter((r) => r.rn <= 2).sort((a, b) => b.rn - a.rn).map((r) => r.p);
    const reposts = (repostsOf.get(root.id) ?? []).sort(newestFirst);
    const reply = latest.at(-1), repost = reposts[0];
    const kind: ActivityKind = reply && (!repost || reply.createdAt.getTime() >= repost.at.getTime()) ? 'reply' : repost ? 'repost' : 'post';
    const by = kind === 'reply'
      ? rs.filter((r) => r.arn === 1).map((r) => ({ at: r.p.createdAt, id: r.p.id, authorId: r.p.authorId })).sort(newestFirst).map((r) => r.authorId)
      : kind === 'repost' ? [...new Set(reposts.map((r) => r.authorId))] : [];
    // A reply under another reply reads with that one above it, unless it is the root or already shown.
    const first = latest[0];
    const contextId = first?.parentId && first.parentId !== root.id && !latest.some((p) => p.id === first.parentId) ? first.parentId : null;
    return { root, kind, by: by.slice(0, 3), latest, contextId, replies: rs[0]?.n ?? 0 };
  });

  const contextIds = [...new Set(threads.map((t) => t.contextId).filter((x): x is string => Boolean(x)))];
  const contexts = (contextIds.length ? await db.select().from(posts).where(inArray(posts.id, contextIds)) : [])
    .filter((p) => !p.deletedAt && !hidden.includes(p.authorId));
  const [views, people, sceneOf] = await Promise.all([
    hydratePosts(db, viewerId, [...roots, ...threads.flatMap((t) => t.latest), ...contexts]).then((vs) => new Map(vs.map((v) => [v.id, v]))),
    userSummaries(db, threads.flatMap((t) => t.by)),
    threadScenes(db, rootIds, hidden),
  ]);

  return threads.map((t) => {
    const context = t.contextId ? views.get(t.contextId) ?? null : null;
    const latest = t.latest.map((p) => views.get(p.id)).filter((v): v is PostView => Boolean(v));
    return {
      id: t.root.id,
      activityAt: (t.root.lastActivityAt ?? t.root.createdAt).toISOString(),
      kind: t.kind,
      by: t.by.map((id) => people.get(id)).filter((u): u is UserSummary => Boolean(u)),
      root: views.get(t.root.id)!,
      latest,
      context,
      more: Math.max(0, t.replies - latest.length - (context ? 1 : 0)),
      scene: sceneOf.get(t.root.id) ?? null,
    };
  });
}

/**
 * The scene each thread hosts (the newest, if it hosted more than one; all of a scene's lines sit in one thread), through the
 * public scene views: a scene left with no visible line doesn't count. `next` is the speaker of its next line while it runs.
 */
async function threadScenes(db: Db, rootIds: string[], hidden: string[]): Promise<Map<string, Scene>> {
  const links = await db.select({ sceneId: sceneMessages.sceneId, postId: posts.id, rootId: posts.rootId }).from(sceneMessages)
    .innerJoin(posts, eq(posts.id, sceneMessages.postId)).where(or(inArray(posts.id, rootIds), inArray(posts.rootId, rootIds)));
  const newest = new Map<string, string>();
  for (const l of links) {
    const thread = l.rootId ?? l.postId;
    if ((newest.get(thread) ?? '') < l.sceneId) newest.set(thread, l.sceneId);
  }
  if (!newest.size) return new Map();
  const rows = await db.select().from(scenes).where(inArray(scenes.id, [...new Set(newest.values())]));
  const views = new Map((await sceneViews(db, rows)).map((v) => [v.id, v]));
  const out = new Map<string, Scene>();
  for (const [thread, sceneId] of newest) {
    const row = rows.find((r) => r.id === sceneId), view = views.get(sceneId);
    if (!row || !view?.messages.length) continue;
    const running = view.endedAt === null;
    const nextId = running ? row.planned[row.posted]?.speakerId : undefined;
    const next = nextId && !hidden.includes(nextId) ? view.cast.find((u) => u.id === nextId) ?? null : null;
    out.set(thread, { id: sceneId, running, next });
  }
  return out;
}
