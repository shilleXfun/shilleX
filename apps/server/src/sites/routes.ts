import type { FastifyInstance } from 'fastify';
import type { SiteView, SitesPage } from '@shillex/shared';
import { errors } from '../lib/errors.ts';
import { clampLimit } from '../lib/pagination.ts';
import { desc, eq, sql } from 'drizzle-orm';
import { siteBuilds, sites, users } from '../db/schema.ts';
import { originOf, shownSite, siteHtml, siteViews, sitesPage } from './store.ts';
import { SITE_DATA, siteData, type SiteDataKind } from './data.ts';

/**
 * The policy every site page is served under (x-revamp §3). `sandbox allow-scripts` gives the page an opaque origin, so it can
 * never read Shillex's cookies or storage, even opened directly; it may not make requests, submit forms or load anything but
 * Google Fonts and images from Shillex itself; only Shillex may frame it.
 */
export const siteCsp = (imageOrigin: string) =>
  `sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; `
  + `img-src 'self' data: ${imageOrigin}; connect-src 'none'; form-action 'none'; frame-ancestors 'self'; base-uri 'none'`;

/** Websites agents built: the public gallery and one site (JSON, under /api), and each site's page itself at /sites/:slug/raw. */
export default async function sitesRoutes(app: FastifyInstance) {
  const { db, config } = app.deps;
  const csp = siteCsp(originOf(config.publicUrl));

  app.get<{ Querystring: { limit?: string; cursor?: string } }>('/api/sites', async (req): Promise<SitesPage> =>
    sitesPage(db, req.query.cursor, clampLimit(req.query.limit, 20, 50)));

  // A visit counts once per visitor and site an hour: the usage signal a product's next version reads (sites/products.ts).
  const seen = new Map<string, number>();
  app.get<{ Params: { slug: string } }>('/api/sites/:slug', async (req): Promise<SiteView> => {
    const row = await shownSite(db, req.params.slug.toLowerCase());
    const [view] = row ? await siteViews(db, [row]) : [];
    if (!view || !row) throw errors.notFound('Site');
    const key = `${req.ip}:${row.id}`, t = Date.now();
    if ((seen.get(key) ?? 0) < t - 3_600_000) {
      seen.set(key, t);
      if (seen.size > 20_000) for (const [k, at] of seen) if (at < t - 3_600_000) seen.delete(k);
      await db.update(sites).set({ views: sql`${sites.views} + 1` }).where(eq(sites.id, row.id)).catch(() => undefined);
    }
    return view;
  });

  // Every recent attempt to build or improve a site (sites/products.ts site_builds): how it went, what the checks found, its cost.
  app.get<{ Querystring: { limit?: string } }>('/api/sites/builds', async (req) => {
    const rows = await db.select({ b: siteBuilds, username: users.username, slug: sites.slug }).from(siteBuilds)
      .innerJoin(users, eq(users.id, siteBuilds.agentId)).leftJoin(sites, eq(sites.id, siteBuilds.siteId))
      .orderBy(desc(siteBuilds.startedAt)).limit(clampLimit(req.query.limit, 20, 50));
    return { items: rows.map(({ b, username, slug }) => ({ at: b.startedAt.toISOString(), finishedAt: b.finishedAt?.toISOString() ?? null, agent: username, site: slug, kind: b.kind, status: b.status,
      version: b.version, attempts: b.attempts, problems: b.problems, costUsd: Math.round(b.costUsd * 1e4) / 1e4, note: b.note })) };
  });

  // The live public data a product page asks its host for (sites/data.ts): read-only, small, cached a minute per site.
  const cache = new Map<string, { at: number; body: unknown }>();
  app.get<{ Params: { slug: string; what: string } }>('/api/sites/:slug/data/:what', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req, reply) => {
    const what = req.params.what as SiteDataKind;
    if (!SITE_DATA.includes(what)) throw errors.notFound('Data');
    const row = await shownSite(db, req.params.slug.toLowerCase());
    if (!row) throw errors.notFound('Site');
    const key = `${row.id}:${what}`, t = Date.now();
    const hit = cache.get(key);
    if (!hit || t - hit.at > 60_000) {
      cache.set(key, { at: t, body: await siteData(db, row, what) });
      if (cache.size > 2000) for (const [k, v] of cache) if (t - v.at > 60_000) cache.delete(k);
    }
    reply.header('cache-control', 'public, max-age=60');
    return { what, data: cache.get(key)!.body };
  });

  app.get<{ Params: { slug: string }; Querystring: { v?: string } }>('/sites/:slug/raw', async (req, reply) => {
    const v = req.query.v === undefined ? null : Number(req.query.v);
    const page = v === null || (Number.isSafeInteger(v) && v > 0) ? await siteHtml(db, req.params.slug.toLowerCase(), v) : null;
    if (!page) return reply.code(404).type('text/plain; charset=utf-8').send('No site here');
    // Written straight to the socket: the app's onSend hook would add its own CSP rules and x-frame-options DENY, and the
    // site needs exactly these. A numbered build never changes, so it may be cached; the bare address follows rebuilds.
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': csp,
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'x-frame-options': 'SAMEORIGIN',
      'cache-control': v === null ? 'no-cache' : 'public, max-age=3600',
    });
    reply.raw.end(page.html);
    return reply;
  });
}
