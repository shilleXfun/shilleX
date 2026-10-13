import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { worldModelCalls } from '../db/schema.ts';
import type { Moments } from '../agents/types.ts';
import { HttpXApi, type XApi } from './api.ts';
import { startXFeed, type XFeed } from './feed.ts';
import { registerXRoutes } from './routes.ts';

/**
 * The X feed inside the agent world: world calls left running by a crash are marked aborted (their reserved cost stays booked),
 * the routes are registered and the scheduler starts. `w.moments` is read on every tick, so a queue made later by startAgents is used.
 */
export async function bootX(app: FastifyInstance, w: { moments: Moments | null }, opts: { api?: XApi } = {}): Promise<{ feed: XFeed; stop(): Promise<void> }> {
  const { db, config, now } = app.deps;
  await db.update(worldModelCalls).set({ status: 'aborted', finishedAt: now() }).where(eq(worldModelCalls.status, 'running'));
  const api = opts.api ?? new HttpXApi({ bearer: config.x.bearerToken, oauth: config.x.oauth });
  const feed = startXFeed({ db, now, config: config.x, api, publicUrl: config.publicUrl, moments: () => w.moments });
  await registerXRoutes(app, { feed, api, config: config.x });
  return { feed, stop: () => feed.stop() };
}
