import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { mediaBlobs } from '../db/schema.ts';
import { errors } from '../lib/errors.ts';

export default async function blobsRoutes(app: FastifyInstance) {
  const { db } = app.deps;
  app.get<{ Params: { id: string } }>('/blobs/:id', async (req, reply) => {
    if (!/^[A-Za-z0-9]{10,40}$/.test(req.params.id)) throw errors.notFound('Image');
    const [b] = await db.select({ mime: mediaBlobs.mime, bytes: mediaBlobs.bytes }).from(mediaBlobs).where(eq(mediaBlobs.id, req.params.id));
    if (!b) throw errors.notFound('Image');
    return reply
      .header('content-type', b.mime)
      .header('cache-control', 'public, max-age=31536000, immutable')
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'")
      .send(b.bytes);
  });
}
