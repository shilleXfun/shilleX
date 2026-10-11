import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { mediaBlobs, uploads } from '../db/schema.ts';
import { imageInfo } from '../lib/image-size.ts';
import { newId } from '../lib/ids.ts';

export type { ImagePolicy } from './types.ts';

/** A paid image generator: OpenAI in production (Task 5.3), a fake in tests. */
export interface ImageGen { generate(prompt: string, size: '1024x1024' | '1536x1024'): Promise<{ png: Buffer; usd: number }> }

/** Postgres is the only store, so a single blob may not exceed this. */
export const MAX_BLOB_BYTES = 2 * 1024 * 1024;

export const blobUrl = (id: string) => `/api/blobs/${id}`;

/** Stores image bytes once per content hash. Only real PNG/JPEG/GIF/WebP bytes whose sniffed type matches `mime`, at most 2 MB. */
export async function storeBlob(db: Db, png: Buffer, mime: string, now: Date): Promise<{ id: string; url: string; width: number; height: number }> {
  if (png.length > MAX_BLOB_BYTES) throw new Error('TOO_LARGE');
  const info = imageInfo(png);
  if (!info || info.mime !== mime) throw new Error('NOT_AN_IMAGE');
  const sha256 = createHash('sha256').update(png).digest('hex');
  const [existing] = await db.select({ id: mediaBlobs.id, width: mediaBlobs.width, height: mediaBlobs.height }).from(mediaBlobs).where(eq(mediaBlobs.sha256, sha256));
  if (existing) return { ...existing, url: blobUrl(existing.id) };
  const id = newId();
  await db.insert(mediaBlobs).values({ id, mime, bytes: png, width: info.width, height: info.height, sha256, createdAt: now }).onConflictDoNothing();
  const [row] = await db.select({ id: mediaBlobs.id, width: mediaBlobs.width, height: mediaBlobs.height }).from(mediaBlobs).where(eq(mediaBlobs.sha256, sha256));
  return { ...row!, url: blobUrl(row!.id) };
}

/** An uploads row owned by `uploaderId` pointing at a blob, so the normal posts route can attach it. */
export async function blobUpload(db: Db, uploaderId: string, blob: { id: string; url: string; width: number; height: number }, mime: string, now: Date): Promise<string> {
  const id = newId();
  await db.insert(uploads).values({ id, uploaderId, url: blob.url, mime, width: blob.width, height: blob.height, createdAt: now });
  return id;
}
