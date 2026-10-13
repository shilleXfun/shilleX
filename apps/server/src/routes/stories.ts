import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { HomeView, SceneView, StoryDetailView, StoryView } from '@shillex/shared';
import { scenes, stories } from '../db/schema.ts';
import { errors } from '../lib/errors.ts';
import { scenePage, sceneViews } from '../agents/scenes/views.ts';
import { buildHome } from '../agents/stories/home.ts';
import { storyDetail, storyViews } from '../agents/stories/views.ts';
import type { Indexer } from '../world/indexer.ts';

/** How long every viewer shares one answer. */
const TTL_MS = 12_000;
const KEEP = 300;

/** GET /api/stories: hottest first. */
export interface StoryList { items: StoryView[]; nextCursor: null }
/** GET /api/scenes: newest first; pass nextCursor back as ?cursor= for the next page. */
export interface SceneList { items: SceneView[]; nextCursor: string | null }

/**
 * The home page's storylines, scenes and characters. Public, and public content only: scene lines are public posts outside
 * communities, story beats are built from public facts (trades, events, factions, scenes). Each answer is shared for 12 s.
 */
export async function registerStoryRoutes(app: FastifyInstance, h: { indexer: Indexer }) {
  const { db, now } = app.deps;
  const cache = new Map<string, { at: number; body: Promise<unknown> }>();
  function cached<T>(key: string, make: () => Promise<T>): Promise<T> {
    const t = Date.now();
    const hit = cache.get(key);
    if (hit && t - hit.at < TTL_MS) return hit.body as Promise<T>;
    const body = make();
    body.catch(() => { if (cache.get(key)?.body === body) cache.delete(key); }); // a failed answer is not shared
    cache.delete(key);
    cache.set(key, { at: t, body });
    if (cache.size > KEEP) cache.delete(cache.keys().next().value!);
    return body;
  }

  await app.register(async (r) => {
    r.get('/world/home', async (): Promise<HomeView> => cached('home', () => buildHome({ db, indexer: h.indexer, now })));

    r.get('/stories', async (): Promise<StoryList> => cached('stories', async () => {
      const rows = await db.select().from(stories).where(and(gte(stories.updatedAt, new Date(now().getTime() - 7 * 86_400_000)), sql`${stories.headline} <> ''`))
        .orderBy(desc(stories.heat), desc(stories.updatedAt)).limit(30);
      return { items: await storyViews(db, h.indexer, rows), nextCursor: null };
    }));

    r.get<{ Params: { id: string } }>('/stories/:id', async (req): Promise<StoryDetailView> => cached(`story:${req.params.id}`, async () => {
      const [row] = await db.select().from(stories).where(eq(stories.id, req.params.id));
      if (!row || !row.headline) throw errors.notFound('Story');
      return storyDetail(db, h.indexer, row);
    }));

    r.get<{ Querystring: { cursor?: string; limit?: string } }>('/scenes', async (req): Promise<SceneList> => {
      const cursor = typeof req.query.cursor === 'string' && /^[0-9A-Z]{26}$/.test(req.query.cursor) ? req.query.cursor : null;
      const limit = Math.max(1, Math.min(Number(req.query.limit ?? 20) || 20, 50));
      return cached(`scenes:${cursor ?? ''}:${limit}`, () => scenePage(db, cursor, limit));
    });

    r.get<{ Params: { id: string } }>('/scenes/:id', async (req): Promise<SceneView> => cached(`scene:${req.params.id}`, async () => {
      const [row] = await db.select().from(scenes).where(eq(scenes.id, req.params.id));
      const [view] = row ? await sceneViews(db, [row]) : [];
      if (!view || !view.messages.length) throw errors.notFound('Scene');
      return view;
    }));
  }, { prefix: '/api' });
}
