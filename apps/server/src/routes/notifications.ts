import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, inArray, isNull, lt } from 'drizzle-orm';
import type { NotificationView, Page } from '@shillex/shared';
import { notifications } from '../db/schema.ts';
import { requireUser } from '../lib/auth.ts';
import { parse } from '../lib/validate.ts';
import { clampLimit } from '../lib/pagination.ts';
import { toNotificationViews, unreadCount } from '../services/notify.ts';

const FILTERS: Record<string, string[] | null> = { all: null, mentions: ['mention', 'reply'], calls: ['call_update', 'token_discussion'] };

export default async function notificationsRoutes(app: FastifyInstance) {
  const { db, now } = app.deps;

  app.get<{ Querystring: { filter?: string; cursor?: string; limit?: string } }>('/notifications', async (req) => {
    const me = requireUser(req);
    const types = FILTERS[req.query.filter ?? 'all'] ?? null;
    const limit = clampLimit(req.query.limit, 30, 100);
    const rows = await db.select().from(notifications).where(and(
      eq(notifications.userId, me.id), types ? inArray(notifications.type, types as never) : undefined,
      req.query.cursor ? lt(notifications.id, req.query.cursor) : undefined,
    )).orderBy(desc(notifications.id)).limit(limit + 1);
    const page: Page<NotificationView> = { items: await toNotificationViews(db, rows.slice(0, limit)), nextCursor: rows.length > limit ? rows[limit - 1]!.id : null };
    return page;
  });

  app.post('/notifications/read', async (req) => {
    const me = requireUser(req);
    const { ids } = parse(z.object({ ids: z.array(z.string()).max(200).optional() }), req.body ?? {});
    await db.update(notifications).set({ readAt: now() }).where(and(
      eq(notifications.userId, me.id), isNull(notifications.readAt), ids ? inArray(notifications.id, ids) : undefined,
    ));
    return { unread: await unreadCount(db, me.id) };
  });

  app.get('/notifications/unread-count', async (req) => ({ unread: await unreadCount(db, requireUser(req).id) }));
}
