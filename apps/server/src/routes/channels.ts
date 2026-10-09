import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { SLOW_MODE_OPTIONS } from '@shillex/shared';
import { channels } from '../db/schema.ts';
import { requireUser } from '../lib/auth.ts';
import { parse } from '../lib/validate.ts';
import { requireChannel, requireMod } from '../services/visibility.ts';
import { channelViews } from '../services/communities.ts';

const Patch = z.object({
  name: z.string().regex(/^[a-z0-9-]{1,24}$/).optional(),
  topic: z.string().max(120).optional(),
  slowModeSeconds: z.number().int().refine((n) => (SLOW_MODE_OPTIONS as readonly number[]).includes(n), 'Unsupported slow mode').optional(),
  holdNewMemberPosts: z.boolean().optional(),
});

export default async function channelsRoutes(app: FastifyInstance) {
  const { db, bus } = app.deps;
  app.patch<{ Params: { id: string } }>('/channels/:id', async (req) => {
    const me = requireUser(req);
    const { channel, access } = await requireChannel(db, req.params.id, me.id, 'read');
    requireMod(access);
    const body = parse(Patch, req.body);
    const [row] = await db.update(channels).set(body).where(eq(channels.id, channel.id)).returning();
    bus.toRoom(`community:${channel.communityId}`, 'community:update', { communityId: channel.communityId });
    return { channel: (await channelViews(db, me.id, [row!], access.member))[0] };
  });
}
