import type { FastifyInstance } from 'fastify';
import type { SiteView, SitesPage } from '@shillex/shared';
import { errors } from '../lib/errors.ts';
import { clampLimit } from '../lib/pagination.ts';
import { originOf, shownSite, siteHtml, siteViews, sitesPage } from './store.ts';

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

  app.get<{ Params: { slug: string } }>('/api/sites/:slug', async (req): Promise<SiteView> => {
    const row = await shownSite(db, req.params.slug.toLowerCase());
    const [view] = row ? await siteViews(db, [row]) : [];
    if (!view) throw errors.notFound('Site');
    return view;
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
