import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { PinView } from '@shillex/shared';
import { pins, posts, messages, channels } from '../db/schema.ts';
import { requireUser } from '../lib/auth.ts';
import { parse } from '../lib/validate.ts';
import { errors } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { getCommunityAccess, getCommunityAccessBySlug, requireCommunityRead, requireMod } from '../services/visibility.ts';
import { hydrateMessages, hydratePosts } from '../services/hydrate.ts';

export default async function pinsRoutes(app: FastifyInstance) {
  const { db, now, bus } = app.deps;

  async function pinViews(rows: (typeof pins.$inferSelect)[], viewerId: string): Promise<PinView[]> {
    const postIds = rows.filter((r) => r.targetType === 'post').map((r) => r.targetId);
    const msgIds = rows.filter((r) => r.targetType === 'message').map((r) => r.targetId);
    const postViews = postIds.length ? await hydratePosts(db, viewerId, await db.select().from(posts).where(inArray(posts.id, postIds))) : [];
    const msgViews = msgIds.length ? await hydrateMessages(db, viewerId, await db.select().from(messages).where(inArray(messages.id, msgIds))) : [];
    return rows.map((r) => ({
      id: r.id, channelId: r.channelId, createdAt: r.createdAt.toISOString(),
      post: postViews.find((p) => p.id === r.targetId) ?? null, message: msgViews.find((m) => m.id === r.targetId) ?? null,
    })).filter((p) => !(p.post?.deleted || (p.message && p.message.status !== 'visible')));
  }

  app.get<{ Params: { slug: string } }>('/communities/:slug/pins', async (req) => {
    const me = requireUser(req);
    const a = requireCommunityRead(await getCommunityAccessBySlug(db, req.params.slug, me.id));
    const rows = await db.select().from(pins).where(eq(pins.communityId, a.community.id)).orderBy(desc(pins.id));
    return { pins: await pinViews(rows, me.id) };
  });

  app.post<{ Params: { slug: string } }>('/communities/:slug/pins', async (req, reply) => {
    const me = requireUser(req);
    const a = requireMod(requireCommunityRead(await getCommunityAccessBySlug(db, req.params.slug, me.id)));
    const body = parse(z.object({ targetType: z.enum(['post', 'message']), targetId: z.string() }), req.body);
    let channelId: string | null = null;
    if (body.targetType === 'post') {
      const [p] = await db.select().from(posts).where(eq(posts.id, body.targetId));
      if (!p || p.communityId !== a.community.id) throw errors.badRequest('WRONG_COMMUNITY', 'Only posts from this community can be pinned');
    } else {
      const [m] = await db.select({ m: messages, ch: channels }).from(messages).innerJoin(channels, eq(channels.id, messages.channelId)).where(eq(messages.id, body.targetId));
      if (!m || m.ch.communityId !== a.community.id) throw errors.badRequest('WRONG_COMMUNITY', 'Only messages from this community can be pinned');
      if (m.m.status !== 'visible') throw errors.badRequest('NOT_VISIBLE', 'Only visible messages can be pinned');
      channelId = m.ch.id;
    }
    const [row] = await db.insert(pins).values({ id: newId(), communityId: a.community.id, channelId, targetType: body.targetType, targetId: body.targetId, pinnedBy: me.id, createdAt: now() }).returning();
    bus.toRoom(`community:${a.community.id}`, 'community:update', { communityId: a.community.id });
    return reply.status(201).send({ pin: (await pinViews([row!], me.id))[0] });
  });

  app.delete<{ Params: { id: string } }>('/pins/:id', async (req, reply) => {
    const me = requireUser(req);
    const [pin] = await db.select().from(pins).where(eq(pins.id, req.params.id));
    if (!pin) throw errors.notFound('Pin');
    const a = await getCommunityAccess(db, pin.communityId, me.id);
    if (!a?.isMod) throw errors.forbidden('MODS_ONLY', 'Only moderators can unpin');
    await db.delete(pins).where(and(eq(pins.id, pin.id)));
    bus.toRoom(`community:${pin.communityId}`, 'community:update', { communityId: pin.communityId });
    return reply.status(204).send();
  });
}
