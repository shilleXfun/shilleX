import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, desc, eq, isNull, lt, notInArray } from 'drizzle-orm';
import { REACTIONS, type Page, type PostView, type ThreadView } from '@shillex/shared';
import { posts, reactions, bookmarks, subscriptions } from '../db/schema.ts';
import { requireUser } from '../lib/auth.ts';
import { parse } from '../lib/validate.ts';
import { errors } from '../lib/errors.ts';
import { clampLimit } from '../lib/pagination.ts';
import { createPost, createRepost, deletePost, loadPost } from '../services/posts.ts';
import { hydratePosts, collectMints, reactionSummaries } from '../services/hydrate.ts';
import { canReadPost, hiddenAuthorIds, isBlockedEitherWay } from '../services/visibility.ts';
import { notify } from '../services/notify.ts';

const CreateBody = z.object({
  body: z.string().max(10_000).default(''),
  parentId: z.string().optional(),
  quoteOfId: z.string().optional(),
  communityId: z.string().optional(),
  uploadIds: z.array(z.string()).max(10).optional(),
  alts: z.array(z.string().max(200)).max(10).optional(),
});

export default async function postsRoutes(app: FastifyInstance) {
  const deps = app.deps;
  const { db, now } = deps;

  async function readable(id: string, userId: string) {
    const p = await loadPost(db, id);
    if (!p || !(await canReadPost(db, p, userId))) throw errors.notFound('Post');
    return p;
  }
  async function viewOne(id: string, userId: string) {
    const [v] = await hydratePosts(db, userId, [(await loadPost(db, id))!]);
    return v!;
  }

  app.post('/posts', { config: { rateLimit: { max: 30, timeWindow: '1 minute', keyGenerator: (r) => r.user?.id ?? r.ip } } }, async (req, reply) => {
    const user = requireUser(req);
    const input = parse(CreateBody, req.body);
    const row = await createPost(deps, user, input);
    const post = await viewOne(row.id, user.id);
    return reply.status(201).send({ post, tokens: await deps.tokens.getViews(collectMints([post])) });
  });

  app.get<{ Params: { id: string } }>('/posts/:id', async (req) => {
    const user = requireUser(req);
    const root = await readable(req.params.id, user.id);
    const hidden = await hiddenAuthorIds(db, user.id);
    const chain: typeof root[] = [];
    let cur = root;
    while (cur.parentId && chain.length < 20) {
      const parent = await loadPost(db, cur.parentId);
      if (!parent) break;
      chain.unshift(parent); cur = parent;
    }
    const replyRows = await db.select().from(posts).where(and(
      eq(posts.parentId, root.id), eq(posts.kind, 'reply'),
      hidden.length ? notInArray(posts.authorId, hidden) : undefined,
    )).orderBy(asc(posts.id)).limit(200);
    const [post, ...rest] = await hydratePosts(db, user.id, [root, ...chain, ...replyRows]);
    const ancestors = rest.slice(0, chain.length);
    const replies = rest.slice(chain.length).filter((p) => !p.deleted || p.counts.replies > 0);
    const view: ThreadView = { post: post!, ancestors, replies, tokens: await deps.tokens.getViews(collectMints([post!, ...ancestors, ...replies])) };
    return view;
  });

  app.delete<{ Params: { id: string } }>('/posts/:id', async (req, reply) => {
    await deletePost(deps, requireUser(req), req.params.id);
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>('/posts/:id/repost', async (req, reply) => {
    const user = requireUser(req);
    const r = await createRepost(deps, user, req.params.id);
    return reply.status(r.created ? 201 : 200).send({ post: await viewOne(r.post.id, user.id) });
  });
  app.delete<{ Params: { id: string } }>('/posts/:id/repost', async (req, reply) => {
    const user = requireUser(req);
    await db.delete(posts).where(and(eq(posts.authorId, user.id), eq(posts.kind, 'repost'), eq(posts.repostOfId, req.params.id)));
    return reply.status(204).send();
  });

  app.put<{ Params: { id: string; emoji: string } }>('/posts/:id/reactions/:emoji', async (req) => {
    const user = requireUser(req);
    const emoji = decodeURIComponent(req.params.emoji);
    if (!(REACTIONS as readonly string[]).includes(emoji)) throw errors.badRequest('BAD_REACTION', 'Unsupported reaction');
    const p = await readable(req.params.id, user.id);
    if (p.deletedAt) throw errors.badRequest('POST_DELETED', 'That post was deleted');
    if (await isBlockedEitherWay(db, user.id, p.authorId)) throw errors.forbidden('BLOCKED', 'You can’t react to this account');
    const inserted = await db.insert(reactions).values({ targetType: 'post', targetId: p.id, userId: user.id, emoji, createdAt: now() }).onConflictDoNothing().returning();
    if (inserted.length) await notify(deps, { userId: p.authorId, type: 'reaction', actorId: user.id, targetType: 'post', targetId: p.id, data: { postId: p.id, emoji } });
    return { reactions: (await reactionSummaries(db, 'post', [p.id], user.id)).get(p.id) ?? [] };
  });
  app.delete<{ Params: { id: string; emoji: string } }>('/posts/:id/reactions/:emoji', async (req) => {
    const user = requireUser(req);
    const emoji = decodeURIComponent(req.params.emoji);
    await db.delete(reactions).where(and(eq(reactions.targetType, 'post'), eq(reactions.targetId, req.params.id), eq(reactions.userId, user.id), eq(reactions.emoji, emoji)));
    return { reactions: (await reactionSummaries(db, 'post', [req.params.id], user.id)).get(req.params.id) ?? [] };
  });

  app.put<{ Params: { id: string } }>('/posts/:id/bookmark', async (req, reply) => {
    const user = requireUser(req);
    await readable(req.params.id, user.id);
    await db.insert(bookmarks).values({ userId: user.id, postId: req.params.id, createdAt: now() }).onConflictDoNothing();
    return reply.status(204).send();
  });
  app.delete<{ Params: { id: string } }>('/posts/:id/bookmark', async (req, reply) => {
    const user = requireUser(req);
    await db.delete(bookmarks).where(and(eq(bookmarks.userId, user.id), eq(bookmarks.postId, req.params.id)));
    return reply.status(204).send();
  });

  app.put<{ Params: { id: string } }>('/posts/:id/subscription', async (req, reply) => {
    const user = requireUser(req);
    await readable(req.params.id, user.id);
    await db.insert(subscriptions).values({ userId: user.id, targetType: 'post', targetId: req.params.id, createdAt: now() }).onConflictDoNothing();
    return reply.status(204).send();
  });
  app.delete<{ Params: { id: string } }>('/posts/:id/subscription', async (req, reply) => {
    const user = requireUser(req);
    await db.delete(subscriptions).where(and(eq(subscriptions.userId, user.id), eq(subscriptions.targetType, 'post'), eq(subscriptions.targetId, req.params.id)));
    return reply.status(204).send();
  });

  app.get<{ Querystring: { cursor?: string; limit?: string } }>('/bookmarks', async (req) => {
    const user = requireUser(req);
    const limit = clampLimit(req.query.limit, 20, 50);
    const rows = await db.select({ p: posts, at: bookmarks.createdAt }).from(bookmarks)
      .innerJoin(posts, eq(posts.id, bookmarks.postId))
      .where(and(eq(bookmarks.userId, user.id), isNull(posts.deletedAt), req.query.cursor ? lt(posts.id, req.query.cursor) : undefined))
      .orderBy(desc(posts.id)).limit(limit + 1);
    const readableRows = [];
    for (const r of rows.slice(0, limit)) if (await canReadPost(db, r.p, user.id)) readableRows.push(r.p);
    const items = await hydratePosts(db, user.id, readableRows);
    const page: Page<PostView> = { items, nextCursor: rows.length > limit ? rows[limit - 1]!.p.id : null, tokens: await deps.tokens.getViews(collectMints(items)) };
    return page;
  });
}
