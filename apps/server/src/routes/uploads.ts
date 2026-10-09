import type { FastifyInstance } from 'fastify';
import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import { LIMITS, type UploadView } from '@shillex/shared';
import { uploads } from '../db/schema.ts';
import type { Db } from '../db/client.ts';
import { requireUser } from '../lib/auth.ts';
import { AppError, errors } from '../lib/errors.ts';
import { imageInfo } from '../lib/image-size.ts';
import { newId } from '../lib/ids.ts';

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' } as const;
export type UploadRow = typeof uploads.$inferSelect;

export async function resolveUploads(db: Db, userId: string, ids: string[]): Promise<UploadRow[]> {
  if (!ids.length) return [];
  const rows = await db.select().from(uploads).where(and(inArray(uploads.id, ids), eq(uploads.uploaderId, userId)));
  if (rows.length !== new Set(ids).size) throw errors.badRequest('BAD_UPLOAD', 'One or more uploads were not found');
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)!);
}

export default async function uploadsRoutes(app: FastifyInstance) {
  const { db, config, now } = app.deps;
  mkdirSync(config.uploadsDir, { recursive: true });

  app.post('/uploads', async (req, reply) => {
    const user = requireUser(req);
    let file;
    try {
      file = await req.file({ limits: { fileSize: LIMITS.uploadBytes, files: 1 } });
    } catch {
      throw errors.badRequest('BAD_UPLOAD', 'Expected a multipart upload');
    }
    if (!file) throw errors.badRequest('BAD_UPLOAD', 'No file provided');
    let buf: Buffer;
    try {
      buf = await file.toBuffer();
    } catch {
      throw new AppError(413, 'TOO_LARGE', 'Images must be 5 MB or smaller');
    }
    if (file.file.truncated) throw new AppError(413, 'TOO_LARGE', 'Images must be 5 MB or smaller');
    const info = imageInfo(buf);
    if (!info) throw new AppError(415, 'UNSUPPORTED_MEDIA', 'Only PNG, JPEG, GIF and WebP images are supported');
    const id = newId();
    const name = `${id}.${EXT[info.mime]}`;
    await writeFile(join(config.uploadsDir, name), buf);
    const url = `/uploads/${name}`;
    await db.insert(uploads).values({ id, uploaderId: user.id, url, mime: info.mime, width: info.width, height: info.height, createdAt: now() });
    const upload: UploadView = { id, url, width: info.width, height: info.height, mime: info.mime };
    return reply.status(201).send({ upload });
  });
}
