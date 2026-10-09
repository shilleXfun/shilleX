import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { CALL_STATUSES, CALL_STATUS_LABELS, type CallUpdateView } from '@shillex/shared';
import { callUpdates, subscriptions, tokenMentions } from '../db/schema.ts';
import { requireUser } from '../lib/auth.ts';
import { parse } from '../lib/validate.ts';
import { errors } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { loadPost } from '../services/posts.ts';
import { hydratePosts } from '../services/hydrate.ts';
import { canReadPost } from '../services/visibility.ts';
import { notify } from '../services/notify.ts';

const Body = z.object({ status: z.enum(CALL_STATUSES), note: z.string().trim().max(280).optional() });

export default async function callsRoutes(app: FastifyInstance) {
  const deps = app.deps;
  const { db, now, bus } = deps;

  app.post<{ Params: { id: string } }>('/posts/:id/call-updates', async (req, reply) => {
    const me = requireUser(req);
    const body = parse(Body, req.body);
    const post = await loadPost(db, req.params.id);
    if (!post || !(await canReadPost(db, post, me.id))) throw errors.notFound('Post');
    if (post.authorId !== me.id) throw errors.forbidden('NOT_AUTHOR', 'Only the author can update this call');
    if (post.deletedAt) throw errors.badRequest('POST_DELETED', 'That post was deleted');
    const hasToken = await db.select({ id: tokenMentions.id }).from(tokenMentions)
      .where(and(eq(tokenMentions.sourceType, 'post'), eq(tokenMentions.sourceId, post.id))).limit(1);
    if (!hasToken.length || (post.kind !== 'post' && post.kind !== 'quote')) throw errors.badRequest('NO_TOKEN', 'Call updates need a post that mentions a token');
    const [row] = await db.insert(callUpdates).values({
      id: newId(), postId: post.id, authorId: me.id, status: body.status, note: body.note || null, selfReported: true, createdAt: now(),
    }).returning();
    const update: CallUpdateView = { id: row!.id, status: body.status, note: row!.note, selfReported: true, createdAt: row!.createdAt.toISOString() };
    const subs = await db.select({ u: subscriptions.userId }).from(subscriptions)
      .where(and(eq(subscriptions.targetType, 'post'), eq(subscriptions.targetId, post.id)));
    for (const s of subs) {
      bus.toUser(s.u, 'call:update', { postId: post.id, update });
      if (s.u !== me.id) await notify(deps, { userId: s.u, type: 'call_update', actorId: me.id, targetType: 'post', targetId: post.id, data: { postId: post.id, label: CALL_STATUS_LABELS[body.status] } });
    }
    const [view] = await hydratePosts(db, me.id, [post]);
    return reply.status(201).send({ update, post: view });
  });
}
