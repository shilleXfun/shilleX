import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, desc, eq, gt, lt, ne, or } from 'drizzle-orm';
import { REACTIONS, type MessageView, type Page } from '@shillex/shared';
import { messages, reactions, communities } from '../db/schema.ts';
import { requireUser } from '../lib/auth.ts';
import { parse } from '../lib/validate.ts';
import { errors } from '../lib/errors.ts';
import { clampLimit } from '../lib/pagination.ts';
import { requireChannel, requireConversationMember } from '../services/visibility.ts';
import { hydrateMessages } from '../services/hydrate.ts';
import { afterVisible, emitMessage, loadMessageAccess, removeMessage, sendMessage } from '../services/messages.ts';
import { markRead } from '../services/unread.ts';

const Send = z.object({
  body: z.string().max(10_000).default(''),
  replyToId: z.string().optional(),
  nonce: z.string().max(64).optional(),
  attachments: z.array(z.discriminatedUnion('type', [
    z.object({ type: z.literal('image'), uploadId: z.string(), alt: z.string().max(200).optional() }),
    z.object({ type: z.literal('token'), mint: z.string() }),
  ])).max(5).optional(),
});

export default async function messagesRoutes(app: FastifyInstance) {
  const deps = app.deps;
  const { db, now } = deps;

  async function list(scope: 'channel' | 'conversation', id: string, viewerId: string, isMod: boolean, q: { before?: string; after?: string; limit?: string }) {
    const limit = clampLimit(q.limit, 50, 100);
    const scopeCol = scope === 'channel' ? messages.channelId : messages.conversationId;
    const visibleToMe = or(ne(messages.status, 'held'), eq(messages.authorId, viewerId), isMod ? eq(messages.status, 'held') : undefined);
    if (q.after) {
      const rows = await db.select().from(messages).where(and(eq(scopeCol, id), visibleToMe, gt(messages.id, q.after))).orderBy(asc(messages.id)).limit(limit);
      const items = await hydrateMessages(db, viewerId, rows);
      return { items, nextCursor: null, tokens: await deps.tokens.getViews(items.flatMap((m) => m.mints)) } satisfies Page<MessageView>;
    }
    const rows = await db.select().from(messages).where(and(eq(scopeCol, id), visibleToMe, q.before ? lt(messages.id, q.before) : undefined))
      .orderBy(desc(messages.id)).limit(limit + 1);
    const pageRows = rows.slice(0, limit).reverse();
    const items = await hydrateMessages(db, viewerId, pageRows);
    const page: Page<MessageView> = { items, nextCursor: rows.length > limit ? pageRows[0]!.id : null, tokens: await deps.tokens.getViews(items.flatMap((m) => m.mints)) };
    return page;
  }

  app.get<{ Params: { id: string }; Querystring: { before?: string; after?: string; limit?: string } }>('/channels/:id/messages', async (req) => {
    const me = requireUser(req);
    const { access } = await requireChannel(db, req.params.id, me.id, 'read');
    return list('channel', req.params.id, me.id, access.isMod, req.query);
  });
  app.get<{ Params: { id: string }; Querystring: { before?: string; after?: string; limit?: string } }>('/conversations/:id/messages', async (req) => {
    const me = requireUser(req);
    await requireConversationMember(db, req.params.id, me.id);
    return list('conversation', req.params.id, me.id, false, req.query);
  });

  for (const scope of ['channel', 'conversation'] as const) {
    app.post<{ Params: { id: string } }>(`/${scope}s/:id/messages`, async (req, reply) => {
      const me = requireUser(req);
      const body = parse(Send, req.body);
      const r = await sendMessage(deps, app.guards, { scope: { type: scope, id: req.params.id }, author: me, ...body });
      return reply.status(201).send({ message: r.view, tokens: r.tokens });
    });
    app.post<{ Params: { id: string } }>(`/${scope}s/:id/read`, async (req, reply) => {
      const me = requireUser(req);
      const { messageId } = parse(z.object({ messageId: z.string() }), req.body);
      if (scope === 'channel') await requireChannel(db, req.params.id, me.id, 'read');
      else await requireConversationMember(db, req.params.id, me.id);
      await markRead(db, me.id, scope, req.params.id, messageId);
      return reply.status(204).send();
    });
  }

  app.delete<{ Params: { id: string } }>('/messages/:id', async (req, reply) => {
    const me = requireUser(req);
    const { row, isMod } = await loadMessageAccess(db, req.params.id, me.id);
    if (row.authorId !== me.id && !isMod) throw errors.forbidden('NOT_ALLOWED', 'Only the author or a moderator can delete this');
    await removeMessage(deps, row);
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>('/messages/:id/approve', async (req) => {
    const me = requireUser(req);
    const [raw] = await db.select({ channelId: messages.channelId }).from(messages).where(eq(messages.id, req.params.id));
    if (!raw) throw errors.notFound('Message');
    // Check moderator rights first so non-mods get a clear 403 rather than a 404 for held messages.
    if (raw.channelId && !(await requireChannel(db, raw.channelId, me.id, 'read')).access.isMod) throw errors.forbidden('MODS_ONLY', 'Only moderators can approve messages');
    const { row, isMod, channel } = await loadMessageAccess(db, req.params.id, me.id);
    if (!isMod || !channel) throw errors.forbidden('MODS_ONLY', 'Only moderators can approve messages');
    if (row.status !== 'held') throw errors.badRequest('NOT_HELD', 'This message is not awaiting approval');
    const [upd] = await db.update(messages).set({ status: 'visible' }).where(and(eq(messages.id, row.id), eq(messages.status, 'held'))).returning();
    if (!upd) throw errors.badRequest('NOT_HELD', 'This message is not awaiting approval');
    const [c] = await db.select({ v: communities.visibility }).from(communities).where(eq(communities.id, channel.communityId));
    await afterVisible(deps, upd, channel, c!.v);
    const [view] = await hydrateMessages(db, me.id, [upd]);
    await emitMessage(deps, upd, 'message:new', { tokens: await deps.tokens.getViews(view!.mints) });
    return { message: view };
  });

  app.put<{ Params: { id: string; emoji: string } }>('/messages/:id/reactions/:emoji', async (req) => {
    const me = requireUser(req);
    const emoji = decodeURIComponent(req.params.emoji);
    if (!(REACTIONS as readonly string[]).includes(emoji)) throw errors.badRequest('BAD_REACTION', 'Unsupported reaction');
    const { row } = await loadMessageAccess(db, req.params.id, me.id);
    if (row.status !== 'visible') throw errors.badRequest('NOT_VISIBLE', 'You can’t react to this message');
    await db.insert(reactions).values({ targetType: 'message', targetId: row.id, userId: me.id, emoji, createdAt: now() }).onConflictDoNothing();
    await emitMessage(deps, row, 'message:update');
    const [view] = await hydrateMessages(db, me.id, [row]);
    return { reactions: view!.reactions };
  });
  app.delete<{ Params: { id: string; emoji: string } }>('/messages/:id/reactions/:emoji', async (req) => {
    const me = requireUser(req);
    const { row } = await loadMessageAccess(db, req.params.id, me.id);
    await db.delete(reactions).where(and(eq(reactions.targetType, 'message'), eq(reactions.targetId, row.id), eq(reactions.userId, me.id), eq(reactions.emoji, decodeURIComponent(req.params.emoji))));
    await emitMessage(deps, row, 'message:update');
    const [view] = await hydrateMessages(db, me.id, [row]);
    return { reactions: view!.reactions };
  });
}
