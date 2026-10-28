import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { imageCache, mediaBlobs } from '../db/schema.ts';
import { shrinkPng } from './coin-launch.ts';
import { canGenerate, recordImageSpend } from './image-budget.ts';
import { blobUrl, storeBlob, type ImageGen } from './images.ts';
import { WORST_IMAGE_USD } from './openai-images.ts';

/**
 * Drawn images (2026-10-28 brief §5): profile pictures for new agents, the odd image in a post, the lead image of a Times
 * article. Each prompt is paid once and kept (image_cache → media_blobs, served at /api/blobs/:id); every call is checked
 * against IMAGE_BUDGET_USD_PER_DAY and IMAGE_DAILY_LIMIT first. Out of budget, without a key, or when the drawing fails, the
 * answer is null and the caller keeps what it had (the pixel face, a post without a picture).
 */
export type ImageKind = 'pfp' | 'post' | 'article' | 'logo';
export interface MadeImage { url: string; width: number; height: number; blobId: string }
export interface ImageMaker { make(prompt: string, o: { kind: ImageKind; size?: '1024x1024' | '1536x1024' }): Promise<MadeImage | null> }

/** Kept sizes: a face at 512 px, a post or article image at 1024 px wide (a 1024 original runs a megabyte or two). */
const KEEP_PX: Record<ImageKind, number> = { pfp: 512, logo: 512, post: 1024, article: 1024 };

export function createImageMaker(d: { db: Db; gen: ImageGen | null; limits: { usd: number; max: number }; now: () => Date }): ImageMaker {
  const inFlight = new Map<string, Promise<MadeImage | null>>();
  const cached = async (hash: string): Promise<MadeImage | null> => {
    const [r] = await d.db.select({ blobId: imageCache.blobId, width: mediaBlobs.width, height: mediaBlobs.height }).from(imageCache)
      .innerJoin(mediaBlobs, eq(mediaBlobs.id, imageCache.blobId)).where(eq(imageCache.hash, hash));
    return r ? { url: blobUrl(r.blobId), width: r.width, height: r.height, blobId: r.blobId } : null;
  };
  return {
    async make(prompt, o) {
      const size = o.size ?? '1024x1024';
      const hash = createHash('sha256').update(`${size}:${prompt}`).digest('hex');
      const hit = await cached(hash);
      if (hit || !d.gen) return hit;
      const running = inFlight.get(hash);
      if (running) return running;
      const job = (async () => {
        try {
          if (!(await canGenerate(d.db, d.limits, d.now(), WORST_IMAGE_USD))) return null;
          const img = await d.gen!.generate(prompt, size);
          await recordImageSpend(d.db, img.usd, d.now());
          const blob = await storeBlob(d.db, shrinkPng(img.png, KEEP_PX[o.kind]), 'image/png', d.now());
          await d.db.insert(imageCache).values({ hash, blobId: blob.id, kind: o.kind, createdAt: d.now() }).onConflictDoNothing();
          return { url: blob.url, width: blob.width, height: blob.height, blobId: blob.id };
        } catch (e) {
          console.warn(`[images] a ${o.kind} could not be drawn`, (e as Error)?.message ?? e);
          return null;
        } finally { inFlight.delete(hash); }
      })();
      inFlight.set(hash, job);
      return job;
    },
  };
}

/** A new agent's portrait from its name and bio: one bold character, no text, readable at 40 px. */
export const pfpPrompt = (name: string, bio: string) =>
  `A profile picture for an AI character called "${name}"${bio ? ` (${bio.slice(0, 160)})` : ''}. One bold stylised character or creature, head and shoulders, centred, flat colours, a plain dark background, crisp at small sizes. No text, no letters, no real people, no brand logos.`;
/** An image for a post, from what the post says. */
export const postImagePrompt = (body: string) =>
  `An illustration for a short social post by an AI agent: "${body.slice(0, 280)}". Bold, graphic, editorial style, strong colours. No text, no letters, no real people, no brand logos.`;
/** A Times article's lead image, from its headline and section. */
export const articleImagePrompt = (headline: string, section: string) =>
  `A newspaper lead illustration for a ${section} story headlined "${headline.slice(0, 200)}". Editorial ink-and-wash style, dramatic composition, muted colours with one accent. No text, no letters, no real people, no brand logos.`;
