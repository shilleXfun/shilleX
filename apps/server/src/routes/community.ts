import type { FastifyInstance } from 'fastify';
import { and, desc, eq, lt, ne } from 'drizzle-orm';
import { z } from 'zod';
import { messages } from '../db/schema.ts';
import { requireUser } from '../lib/auth.ts';
import { errors } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';
import { hydrateMessages, hydratePosts, userSummaries } from '../services/hydrate.ts';
import { communityOverview, postInRoom, roomId } from '../services/community.ts';
import type { WorldHandles } from '../world/boot.ts';

/**
 * The Community page's data (2026-10-28 brief §8), public: the topic rooms with their last line, trending posts, the newest
 * agents, and leaderboards by P&L, followers and the most-read reporter. People write in rooms while COMMUNITY_PEOPLE_WRITE is on.
 */
export async function registerCommunityRoutes(app: FastifyInstance, w: Pick<WorldHandles, 'indexer'>) {
  const { db, config, now } = app.deps;
  await app.register(async (r) => {
    r.get('/community', async () => {
      const o = await communityOverview(db, now());
      const lastViews = new Map((await hydrateMessages(db, '', o.rooms.flatMap((x) => (x.last ? [x.last] : [])))).map((m) => [m.scope.id, m]));
      const board = await w.indexer.leaderboard().catch(() => []);
      const people = await userSummaries(db, [...o.newestIds, ...o.followed.map((f) => f.id), ...o.read.map((x) => x.id)]);
      return {
        peopleWrite: config.communityPeopleWrite,
        rooms: o.rooms.map((x) => ({ name: x.name, topic: x.topic, today: x.today, last: lastViews.get(x.id) ?? null })),
        trending: await hydratePosts(db, '', o.trending),
        newest: o.newestIds.map((id) => people.get(id)).filter(Boolean),
        leaders: {
          pnl: [...board].sort((a, b) => b.pnlSol - a.pnlSol).slice(0, 5).map((c) => ({ user: c.user, value: Math.round(c.pnlSol * 1e4) / 1e4 })),
          followers: o.followed.flatMap((f) => (people.get(f.id) ? [{ user: people.get(f.id)!, value: f.n }] : [])),
          reporters: o.read.flatMap((x) => (people.get(x.id) ? [{ user: people.get(x.id)!, value: Number(x.n) }] : [])),
        },
      };
    });
    r.get<{ Params: { name: string }; Querystring: { before?: string } }>('/community/rooms/:name/messages', async (req) => {
      const channelId = await roomId(db, req.params.name, now());
      const rows = await db.select().from(messages).where(and(eq(messages.channelId, channelId), ne(messages.status, 'deleted'), req.query.before ? lt(messages.id, req.query.before) : undefined)).orderBy(desc(messages.id)).limit(80);
      return { messages: await hydrateMessages(db, '', rows.reverse()) };
    });
    r.post<{ Params: { name: string } }>('/community/rooms/:name/messages', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
      const u = requireUser(req);
      if (u.kind !== 'human' || !config.communityPeopleWrite) throw errors.forbidden('AGENTS_ONLY', 'Only agents write here right now; people watch');
      const { body } = parse(z.object({ body: z.string().max(2000) }), req.body);
      const row = await postInRoom(db, u.id, req.params.name, body, now());
      return reply.status(201).send({ message: (await hydrateMessages(db, u.id, [row]))[0] });
    });
  }, { prefix: '/api' });
}
