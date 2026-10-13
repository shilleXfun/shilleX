import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { and, asc, desc, eq, gt, inArray } from 'drizzle-orm';
import type { XAdminView } from '@shillex/shared';
import { xHighlights, xSources, xTopics } from '../db/schema.ts';
import { requireUser } from '../lib/auth.ts';
import { errors } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';
import { blobUrl } from '../agents/images.ts';
import { XApiError, type XApi } from './api.ts';
import type { XConfig } from './config.ts';
import type { XFeed } from './feed.ts';
import { SourceError, addSource } from './sources.ts';
import { xSpendToday } from './spend.ts';

const AddSource = z.object({ kind: z.enum(['account', 'query']), value: z.string().min(1).max(300) });
const Toggle = z.object({ enabled: z.boolean() });
const iso = (d: Date | null) => d?.toISOString() ?? null;

/** The X feed's admin routes (x-feed §2, §6, §9). Admins are the human accounts listed in ADMIN_USERNAMES, as for /admin/world. */
export async function registerXRoutes(app: FastifyInstance, x: { feed: XFeed; api: XApi; config: XConfig }) {
  const { db, config, now } = app.deps;
  const requireAdmin = (req: FastifyRequest) => {
    const u = requireUser(req);
    if (u.kind !== 'human' || !config.adminUsernames.includes(u.username)) throw errors.forbidden('ADMIN_ONLY', 'Admins only');
    return u;
  };
  await app.register(async (r) => {
    r.get('/admin/x', async (req): Promise<XAdminView> => {
      requireAdmin(req);
      const at = now();
      const [sources, topics, highlights, spend] = await Promise.all([
        db.select().from(xSources).orderBy(asc(xSources.kind), asc(xSources.createdAt)),
        db.select().from(xTopics).where(gt(xTopics.expiresAt, at)).orderBy(desc(xTopics.heat)).limit(10),
        db.select().from(xHighlights).orderBy(desc(xHighlights.createdAt)).limit(20),
        xSpendToday(db, at),
      ]);
      return {
        status: x.feed.status(),
        limits: { dailyMaxPostReads: x.config.dailyMaxPostReads, dailyBudgetUsd: x.config.dailyBudgetUsd, highlightsPerDay: x.config.highlightsPerDay, linkedPostsPerDay: x.config.linkedPostsPerDay },
        spendToday: { postReads: spend.postReads, userReads: spend.userReads, postsCreated: spend.postsCreated, linkedPosts: spend.linkedPosts, mediaUploads: spend.mediaUploads, usd: spend.usd },
        sources: sources.map((s) => ({ id: s.id, kind: s.kind, value: s.value, enabled: s.enabled, lastPolledAt: iso(s.lastPolledAt), backoffUntil: iso(s.backoffUntil) })),
        topics: topics.map((t) => ({ id: t.id, label: t.label, heat: t.heat, sentiment: t.sentiment, expiresAt: t.expiresAt.toISOString() })),
        highlights: highlights.map((h) => ({ id: h.id, kind: h.kind, body: h.body, link: h.link, imageUrl: h.blobId ? blobUrl(h.blobId) : null, status: h.status, error: h.error, createdAt: h.createdAt.toISOString(), postedAt: iso(h.postedAt) })),
      };
    });
    r.post('/admin/x/sources', async (req, reply) => {
      requireAdmin(req);
      const b = parse(AddSource, req.body);
      try {
        const s = await addSource({ db, api: x.api, config: x.config, now: now() }, b.kind, b.value);
        return reply.status(201).send({ source: { id: s.id, kind: s.kind, value: s.value, enabled: s.enabled, lastPolledAt: null, backoffUntil: null } });
      } catch (e) {
        if (e instanceof SourceError) {
          if (e.code === 'NO_SUCH_ACCOUNT') throw errors.notFound('X account');
          if (e.code === 'BAD_HANDLE' || e.code === 'BAD_QUERY') throw errors.badRequest(e.code, e.message);
          throw errors.conflict(e.code, e.message);
        }
        if (e instanceof XApiError) throw errors.conflict('X_ERROR', e.message);
        throw e;
      }
    });
    r.patch<{ Params: { id: string } }>('/admin/x/sources/:id', async (req, reply) => {
      requireAdmin(req);
      const b = parse(Toggle, req.body);
      const done = await db.update(xSources).set({ enabled: b.enabled }).where(eq(xSources.id, req.params.id)).returning({ id: xSources.id });
      if (!done.length) throw errors.notFound('Source');
      return reply.status(204).send();
    });
    r.delete<{ Params: { id: string } }>('/admin/x/sources/:id', async (req, reply) => {
      requireAdmin(req);
      await db.delete(xSources).where(eq(xSources.id, req.params.id));
      return reply.status(204).send();
    });
    r.post<{ Params: { id: string; action: string } }>('/admin/x/highlights/:id/:action', async (req, reply) => {
      requireAdmin(req);
      const { id, action } = req.params;
      if (action !== 'approve' && action !== 'skip') throw errors.notFound('Action');
      const from: ('draft' | 'approved')[] = action === 'approve' ? ['draft'] : ['draft', 'approved'];
      const done = await db.update(xHighlights).set({ status: action === 'approve' ? 'approved' : 'skipped' })
        .where(and(eq(xHighlights.id, id), inArray(xHighlights.status, from))).returning({ id: xHighlights.id });
      if (!done.length) throw errors.conflict('NOT_A_DRAFT', action === 'approve' ? 'Only a draft can be approved' : 'Only a draft or an approved highlight can be skipped');
      return reply.status(204).send();
    });
    r.post('/admin/x/resume', async (req, reply) => {
      requireAdmin(req);
      x.feed.resume();
      return reply.status(204).send();
    });
  }, { prefix: '/api' });
}
