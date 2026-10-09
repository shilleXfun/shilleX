import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import type { ReportView } from '@shillex/shared';
import { reports, posts, messages, users } from '../db/schema.ts';
import { requireUser } from '../lib/auth.ts';
import { parse } from '../lib/validate.ts';
import { errors } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { canReadPost, getCommunityAccess, getCommunityAccessBySlug, requireMod } from '../services/visibility.ts';
import { loadMessageAccess, emitMessage } from '../services/messages.ts';
import { removeMentions } from '../services/mentions.ts';
import { userSummaries } from '../services/hydrate.ts';
import { notify } from '../services/notify.ts';

const Body = z.object({ targetType: z.enum(['post', 'message', 'user']), targetId: z.string(), reason: z.string().trim().min(1).max(500) });

export default async function reportsRoutes(app: FastifyInstance) {
  const deps = app.deps;
  const { db, now } = deps;

  app.post('/reports', async (req, reply) => {
    const me = requireUser(req);
    const body = parse(Body, req.body);
    let communityId: string | null = null;
    if (body.targetType === 'post') {
      const [p] = await db.select().from(posts).where(eq(posts.id, body.targetId));
      if (!p || !(await canReadPost(db, p, me.id))) throw errors.notFound('Post');
      communityId = p.communityId;
    } else if (body.targetType === 'message') {
      const { channel } = await loadMessageAccess(db, body.targetId, me.id);
      communityId = channel?.communityId ?? null;
    } else {
      const [u] = await db.select().from(users).where(eq(users.id, body.targetId));
      if (!u) throw errors.notFound('User');
    }
    const id = newId();
    await db.insert(reports).values({ id, reporterId: me.id, ...body, communityId, createdAt: now() });
    return reply.status(201).send({ id });
  });

  app.get<{ Params: { slug: string } }>('/communities/:slug/reports', async (req) => {
    const me = requireUser(req);
    const a = await getCommunityAccessBySlug(db, req.params.slug, me.id);
    if (!a) throw errors.notFound('Community');
    requireMod(a);
    const rows = await db.select().from(reports).where(and(eq(reports.communityId, a.community.id), eq(reports.status, 'open'))).orderBy(desc(reports.id));
    const people = await userSummaries(db, rows.map((r) => r.reporterId));
    const out: ReportView[] = [];
    for (const r of rows) {
      let preview: ReportView['preview'] = null;
      if (r.targetType === 'post') {
        const [p] = await db.select().from(posts).where(eq(posts.id, r.targetId));
        if (p) preview = { author: (await userSummaries(db, [p.authorId])).get(p.authorId) ?? null, body: p.deletedAt ? '' : p.body };
      } else if (r.targetType === 'message') {
        const [m] = await db.select().from(messages).where(eq(messages.id, r.targetId));
        if (m) preview = { author: (await userSummaries(db, [m.authorId])).get(m.authorId) ?? null, body: m.status === 'deleted' ? '' : m.body };
      }
      out.push({ id: r.id, reporter: people.get(r.reporterId)!, targetType: r.targetType, targetId: r.targetId, reason: r.reason, status: r.status, createdAt: r.createdAt.toISOString(), preview });
    }
    return { reports: out };
  });

  app.post<{ Params: { id: string } }>('/reports/:id/resolve', async (req, reply) => {
    const me = requireUser(req);
    const { action } = parse(z.object({ action: z.enum(['dismiss', 'remove_content']) }), req.body);
    const [r] = await db.select().from(reports).where(eq(reports.id, req.params.id));
    if (!r || !r.communityId) throw errors.notFound('Report');
    const a = await getCommunityAccess(db, r.communityId, me.id);
    if (!a?.isMod) throw errors.forbidden('MODS_ONLY', 'Only moderators can resolve reports');
    if (action === 'remove_content') {
      if (r.targetType === 'post') {
        await db.update(posts).set({ deletedAt: now() }).where(eq(posts.id, r.targetId));
        await removeMentions(db, 'post', r.targetId);
      } else if (r.targetType === 'message') {
        const [upd] = await db.update(messages).set({ status: 'deleted' }).where(eq(messages.id, r.targetId)).returning();
        await removeMentions(db, 'message', r.targetId);
        if (upd) await emitMessage(deps, upd, 'message:update');
      }
    }
    await db.update(reports).set({ status: action === 'dismiss' ? 'dismissed' : 'resolved', resolvedBy: me.id }).where(eq(reports.id, r.id));
    await notify(deps, { userId: r.reporterId, type: 'report_resolved', actorId: null, targetType: 'report', targetId: r.id });
    return reply.status(204).send();
  });
}
