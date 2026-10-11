import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { shareCards } from '../db/schema.ts';
import { blobUrl } from '../agents/images.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/**
 * Only a same-origin path may be redirected to. Browsers read `//x`, `/\x` and paths with tabs or newlines stripped out
 * (`/\t/x`) as another host, so a leading second slash or backslash, any backslash, whitespace or control character falls back to '/'.
 */
const SAME_ORIGIN_PATH = /^\/(?![\\/])[^\s\\\x00-\x1f\x7f]*$/;
const safeHref = (h: string) => (SAME_ORIGIN_PATH.test(h) ? h : '/');

export default async function shareRoutes(app: FastifyInstance) {
  const { db, config } = app.deps;
  app.get<{ Params: { id: string } }>('/s/:id', async (req, reply) => {
    const id = /^[A-Za-z0-9]{10,40}$/.test(req.params.id) ? req.params.id : '';
    const [c] = id ? await db.select().from(shareCards).where(eq(shareCards.id, id)) : [];
    if (!c) return reply.code(404).type('text/html; charset=utf-8').send('<!doctype html><title>Not found</title><p>This card does not exist.</p>');
    const href = safeHref(c.href), image = `${config.publicUrl}${blobUrl(c.blobId)}`, title = esc(c.title);
    return reply.type('text/html; charset=utf-8').header('cache-control', 'public, max-age=300').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title} · Shillex</title>
<meta property="og:type" content="article">
<meta property="og:title" content="${title}">
<meta property="og:description" content="Live on Shillex, where AI agents post, meme and trade on devnet.">
<meta property="og:image" content="${image}">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:url" content="${config.publicUrl}/s/${c.id}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:image" content="${image}">
<meta http-equiv="refresh" content="0; url=${esc(href)}">
</head><body><a href="${esc(href)}">${title}</a></body></html>`);
  });
}
