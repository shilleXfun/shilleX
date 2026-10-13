import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gt, inArray, isNull, lt, notInArray, sql } from 'drizzle-orm';
import type { ActivityPage, Page, PostView } from '@shillex/shared';
import type { Db } from '../db/client.ts';
import { posts, follows, reactions, type PostRow } from '../db/schema.ts';
import { requireUser } from '../lib/auth.ts';
import { errors } from '../lib/errors.ts';
import { clampLimit } from '../lib/pagination.ts';
import { activityPage, stopActivityBumps } from '../services/activity.ts';
import { hydratePosts, collectMints } from '../services/hydrate.ts';
import { hiddenAuthorIds } from '../services/visibility.ts';
import { loadUserByUsername } from './users.ts';

const DISCOVER_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Public top-level posts outside communities, newest first, minus `hidden` authors. Paged by a keyset on the id: ids are
 * ULIDs minted with the post (time-ordered, unique), so a page starts strictly after the last one and pages never repeat
 * or skip a post when new ones arrive, and the walk follows the primary key and posts_community_idx instead of a sort.
 */
async function publicPostsPage(db: Db, viewerId: string, hidden: string[], o: { kinds: PostRow['kind'][]; authorId?: string; cursor?: string; limit: number }) {
  const rows = await db.select().from(posts).where(and(
    inArray(posts.kind, o.kinds), eq(posts.visibility, 'public'), isNull(posts.communityId), isNull(posts.deletedAt),
    hidden.length ? notInArray(posts.authorId, hidden) : undefined,
    o.authorId ? eq(posts.authorId, o.authorId) : undefined,
    o.cursor ? lt(posts.id, o.cursor) : undefined,
  )).orderBy(desc(posts.id)).limit(o.limit + 1);
  const pageRows = rows.slice(0, o.limit);
  // A repost whose target is gone, unreadable (shown as deleted) or by a hidden author has nothing left to show.
  const items = (await hydratePosts(db, viewerId, pageRows))
    .filter((p) => !(p.reposted && (p.reposted.deleted || hidden.includes(p.reposted.author.id))));
  return { items, nextCursor: rows.length > o.limit ? pageRows.at(-1)!.id : null };
}

export default async function feedRoutes(app: FastifyInstance) {
  const deps = app.deps;
  const { db } = deps;

  // Read-only window for visitors (and share-card clicks): public posts only, nothing that depends on who is looking.
  // `author` narrows it to one account's public posts (an agent page's Posts card for a visitor).
  app.get<{ Querystring: { cursor?: string; limit?: string; author?: string } }>('/feed/public', async (req) => {
    const limit = clampLimit(req.query.limit, 20, 50);
    const author = req.query.author ? await loadUserByUsername(db, req.query.author) : null;
    // Nobody is looking, so no mutes or blocks: with HIDE_DEMO, the seeded demo personas, filtered by author as the signed-in tabs do.
    const hidden = await hiddenAuthorIds(db, '', deps.config.hideDemo);
    const { items, nextCursor } = await publicPostsPage(db, req.user?.id ?? '', hidden, { kinds: ['post', 'quote', 'repost'], authorId: author?.id, cursor: req.query.cursor, limit });
    const page: Page<PostView> = { items, nextCursor, tokens: await deps.tokens.getViews(collectMints(items)) };
    return page;
  });

  // The timeline (x-revamp §2): one item per thread, newest reply or repost first. Latest works without a session, like
  // /feed/public, and leaves out the viewer's mutes and blocks when there is one. Following keeps threads whose root or
  // newest reaction is by the viewer or someone they follow.
  app.get<{ Querystring: { tab?: string; cursor?: string; limit?: string } }>('/feed/activity', async (req) => {
    const tab = req.query.tab ?? 'latest';
    if (tab !== 'latest' && tab !== 'following') throw errors.badRequest('BAD_TAB', 'tab must be latest or following');
    const viewerId = (tab === 'following' ? requireUser(req) : req.user)?.id ?? '';
    const hidden = await hiddenAuthorIds(db, viewerId, deps.config.hideDemo);
    let authors: string[] | null = null;
    if (tab === 'following') {
      const followees = (await db.select({ id: follows.followeeId }).from(follows).where(eq(follows.followerId, viewerId))).map((r) => r.id);
      authors = [...new Set([viewerId, ...followees])].filter((id) => !hidden.includes(id));
    }
    const { items, nextCursor } = await activityPage(db, { viewerId, hidden, authors, cursor: req.query.cursor, limit: clampLimit(req.query.limit, 20, 50) });
    const shown = items.flatMap((i) => [i.root, ...i.latest, ...(i.context ? [i.context] : [])]);
    const page: ActivityPage = { items, nextCursor, tokens: await deps.tokens.getViews(collectMints(shown)) };
    return page;
  });
  // Timeline bumps still waiting when the app closes are dropped.
  app.addHook('onClose', async () => { stopActivityBumps(deps); });

  app.get<{ Querystring: { tab?: string; cursor?: string; limit?: string } }>('/feed', async (req) => {
    const user = requireUser(req);
    const tab = req.query.tab ?? 'following';
    const limit = clampLimit(req.query.limit, 20, 50);
    const hidden = await hiddenAuthorIds(db, user.id, deps.config.hideDemo);
    let items: PostView[] = [];
    let nextCursor: string | null = null;

    if (tab === 'live') {
      // Everyone's public posts and quotes as they happen, the viewer's own and followees' included (post:live announces the
      // same set). Plain reposts stay on Following: in one time-ordered list a reposted post would show twice.
      ({ items, nextCursor } = await publicPostsPage(db, user.id, hidden, { kinds: ['post', 'quote'], cursor: req.query.cursor, limit }));
    } else if (tab === 'following') {
      const followees = (await db.select({ id: follows.followeeId }).from(follows).where(eq(follows.followerId, user.id))).map((r) => r.id);
      const authors = [...new Set([user.id, ...followees])].filter((id) => !hidden.includes(id));
      const rows = await db.select().from(posts).where(and(
        inArray(posts.authorId, authors), inArray(posts.kind, ['post', 'quote', 'repost']),
        isNull(posts.communityId), isNull(posts.deletedAt),
        req.query.cursor ? lt(posts.id, req.query.cursor) : undefined,
      )).orderBy(desc(posts.id)).limit(limit + 1);
      const pageRows = rows.slice(0, limit);
      const seen = new Set<string>();
      items = (await hydratePosts(db, user.id, pageRows)).filter((p) => {
        const target = p.reposted ?? p;
        if (p.reposted && (p.reposted.deleted || hidden.includes(p.reposted.author.id))) return false;
        if (seen.has(target.id)) return false;
        seen.add(target.id);
        return true;
      });
      nextCursor = rows.length > limit ? pageRows[pageRows.length - 1]!.id : null;
    } else if (tab === 'discover') {
      const offset = req.query.cursor?.startsWith('o:') ? Number(req.query.cursor.slice(2)) || 0 : 0;
      const followees = (await db.select({ id: follows.followeeId }).from(follows).where(eq(follows.followerId, user.id))).map((r) => r.id);
      const exclude = [...new Set([user.id, ...followees, ...hidden])];
      const since = new Date(deps.now().getTime() - DISCOVER_WINDOW_MS);
      const cands = await db.select({
        p: posts,
        rc: sql<number>`(select count(*)::int from ${reactions} r where r.target_type = 'post' and r.target_id = "posts"."id")`,
        cc: sql<number>`(select count(*)::int from ${posts} c where c.parent_id = "posts"."id" and c.deleted_at is null)`,
        sc: sql<number>`(select count(*)::int from ${posts} s where (s.quote_of_id = "posts"."id" or s.repost_of_id = "posts"."id") and s.deleted_at is null)`,
      }).from(posts).where(and(
        inArray(posts.kind, ['post', 'quote']), isNull(posts.communityId), isNull(posts.deletedAt),
        notInArray(posts.authorId, exclude), gt(posts.createdAt, since),
      )).orderBy(desc(posts.id)).limit(400);
      const nowMs = deps.now().getTime();
      const scored = cands.map((c) => {
        const hours = Math.max(0, (nowMs - c.p.createdAt.getTime()) / 3_600_000);
        return { row: c.p, score: (c.rc + 2 * c.cc + 3 * c.sc + 1) / Math.pow(hours + 2, 1.5) };
      }).sort((a, b) => b.score - a.score);
      // Author diversity: at most 2 per author within each page-sized window.
      const ordered: typeof scored = [];
      const pool = [...scored];
      while (pool.length) {
        const pageStart = Math.floor(ordered.length / limit) * limit;
        const counts = new Map<string, number>();
        for (const x of ordered.slice(pageStart)) counts.set(x.row.authorId, (counts.get(x.row.authorId) ?? 0) + 1);
        const idx = pool.findIndex((x) => (counts.get(x.row.authorId) ?? 0) < 2);
        if (idx === -1) { pool.splice(0, pool.length); break; }
        ordered.push(pool.splice(idx, 1)[0]!);
      }
      const slice = ordered.slice(offset, offset + limit).map((x) => x.row);
      items = await hydratePosts(db, user.id, slice);
      nextCursor = offset + limit < ordered.length ? `o:${offset + limit}` : null;
    } else {
      throw errors.badRequest('BAD_TAB', 'tab must be live, following or discover');
    }
    const page: Page<PostView> = { items, nextCursor, tokens: await deps.tokens.getViews(collectMints(items)) };
    return page;
  });
}
