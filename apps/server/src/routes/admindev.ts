import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { and, desc, eq, gte, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { AdminDevState } from '@shillex/shared';
import { agentState, agentTurns, agents, chainTxs, papers, posts, users, worldCoins } from '../db/schema.ts';
import { AppError, errors } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';
import { toUserSummary } from '../services/users.ts';
import { publicTurnView } from '../agents/depth/receipt.ts';
import { rugSales } from '../agents/overview.ts';
import { fadedMood } from '../agents/state.ts';
import { imageSpendOn } from '../agents/image-budget.ts';
import { overrideWeather, weatherView } from '../agents/depth/weather.ts';
import { paperPending, publishPaper } from '../agents/depth/paper.ts';
import type { WorldHandles } from '../world/boot.ts';

const COOKIE = 'admindev';
const COOKIE_PATH = '/api/admindev';
const SESSION_S = 8 * 3600;
/** Open console sessions per process; past this many, a new login ends the oldest. */
const SESSIONS_MAX = 50;
const RECENT_TURNS = 25;
const Login = z.object({ password: z.string().max(200) });
const Weather = z.object({ regime: z.enum(['euphoria', 'grind', 'fear', 'chaos']) });

const digest = (s: string) => createHash('sha256').update(s).digest();
/** Both sides are SHA-256 digests, so the lengths always match and the comparison never exits early. */
const samePassword = (given: string, expected: string) => timingSafeEqual(digest(given), digest(expected));

/**
 * The developer console (/admindev): the running world on one read, plus pause/resume, the weather and the paper. Gated by
 * ADMIN_DEV_PASSWORD and a session cookie, not by a human account. Shows only public agent views (cards, receipts) and world
 * internals: never a human's DMs, private-community content or a wallet secret.
 */
export async function registerAdminDevRoutes(app: FastifyInstance, w: WorldHandles) {
  const { db, config, now } = app.deps;
  const password = config.adminDevPassword;
  // No password (production or a devnet world without ADMIN_DEV_PASSWORD): the routes do not exist, so every /api/admindev/* answers 404.
  if (password === null) return;

  // Random session tokens, kept in memory: each expires after 8 hours, logout ends it, and a restart ends them all.
  // The cookie is signed too, but a signature alone (the secret may be the public dev default) never opens the console.
  const sessions = new Map<string, number>(); // token → expires at (ms)
  const openSession = () => {
    const t = now().getTime();
    for (const [token, exp] of sessions) if (exp <= t) sessions.delete(token);
    while (sessions.size >= SESSIONS_MAX) sessions.delete(sessions.keys().next().value!);
    const token = randomBytes(32).toString('base64url');
    sessions.set(token, t + SESSION_S * 1000);
    return token;
  };
  const tokenOf = (req: FastifyRequest) => {
    const raw = req.cookies[COOKIE];
    const c = raw ? req.unsignCookie(raw) : null;
    return c?.valid && c.value ? c.value : null;
  };
  const requireDev = (req: FastifyRequest) => {
    const token = tokenOf(req);
    const exp = token ? sessions.get(token) : undefined;
    if (token && exp !== undefined && exp > now().getTime()) return;
    if (token && exp !== undefined) sessions.delete(token);
    throw errors.unauthorized();
  };

  async function today(): Promise<AdminDevState['today']> {
    const since = new Date(`${now().toISOString().slice(0, 10)}T00:00:00Z`);
    const n = sql<number>`count(*)::int`;
    const [[p], [trades], [launches], rugs, turns] = await Promise.all([
      db.select({ n, images: sql<number>`(count(*) filter (where jsonb_array_length(${posts.media}) > 0))::int` }).from(posts)
        .innerJoin(users, eq(users.id, posts.authorId)).where(and(eq(users.kind, 'agent'), gte(posts.createdAt, since), isNull(posts.deletedAt))),
      db.select({ n }).from(chainTxs).where(and(inArray(chainTxs.kind, ['buy', 'sell']), gte(chainTxs.createdAt, since))),
      db.select({ n }).from(worldCoins).where(gte(worldCoins.launchedAt, since)),
      rugSales(db, since),
      db.select({ s: agentTurns.status, n }).from(agentTurns).where(gte(agentTurns.startedAt, since)).groupBy(agentTurns.status),
    ]);
    return { posts: p?.n ?? 0, images: p?.images ?? 0, trades: trades?.n ?? 0, launches: launches?.n ?? 0, rugs: rugs.length, turns: Object.fromEntries(turns.map((x) => [x.s, x.n])) };
  }

  await app.register(async (r) => {
    r.post('/admindev/login', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
      const { password: given } = parse(Login, req.body);
      if (!samePassword(given, password)) throw new AppError(401, 'BAD_PASSWORD', 'Wrong password');
      reply.setCookie(COOKIE, openSession(), { signed: true, httpOnly: true, sameSite: 'strict', path: COOKIE_PATH, secure: config.nodeEnv === 'production', maxAge: SESSION_S });
      return reply.status(204).send();
    });
    r.post('/admindev/logout', async (req, reply) => {
      const token = tokenOf(req);
      if (token) sessions.delete(token);
      reply.clearCookie(COOKIE, { path: COOKIE_PATH });
      return reply.status(204).send();
    });

    r.get('/admindev/state', async (req, reply): Promise<AdminDevState> => {
      requireDev(req);
      reply.header('cache-control', 'no-store');
      const [cards, statuses, moods, recent, images, weather, counts] = await Promise.all([
        w.indexer.leaderboard(),
        db.select({ id: agents.userId, status: agents.status }).from(agents),
        db.select({ id: agentState.agentId, mood: agentState.mood, updatedAt: agentState.updatedAt }).from(agentState),
        db.select({ t: agentTurns, u: users }).from(agentTurns).innerJoin(users, eq(users.id, agentTurns.agentId))
          .orderBy(desc(agentTurns.startedAt), desc(agentTurns.id)).limit(RECENT_TURNS),
        imageSpendOn(db, now()),
        weatherView(db, now()),
        today(),
      ]);
      // The leaderboard is cached for a few seconds; the status comes from the table so a pause shows on the next read.
      const statusOf = new Map(statuses.map((x) => [x.id, x.status]));
      const moodOf = new Map(moods.map((x) => [x.id, fadedMood(x.mood, x.updatedAt, now())]));
      return {
        world: { network: w.network, agents: cards.length, runtime: w.engine ? 'on' : 'off', engine: w.engine?.stats() ?? null, queue: w.moments?.size() ?? 0, halted: w.moments?.halted() ?? null },
        budgets: {
          model: { spentUsd: w.budget.spentToday(), capUsd: config.agentDailyBudgetUsd, level: w.budget.level() },
          images: { spentUsd: images.usd, capUsd: config.imageDailyBudgetUsd, countToday: images.count, maxPerDay: config.imageDailyMax },
        },
        weather,
        today: counts,
        agents: cards.map((c) => ({ ...c, status: statusOf.get(c.user.id) ?? c.status, mood: moodOf.get(c.user.id) ?? 0 }))
          .sort((a, b) => b.pnlSol - a.pnlSol || a.user.username.localeCompare(b.user.username)),
        turns: await Promise.all(recent.map((x) => publicTurnView(db, x.t, toUserSummary(x.u)))),
      };
    });

    // The same effect as the /admin switches.
    r.post<{ Params: { username: string; action: string } }>('/admindev/agents/:username/:action', async (req, reply) => {
      requireDev(req);
      if (req.params.action !== 'pause' && req.params.action !== 'resume') throw errors.notFound('Action');
      const [u] = await db.select({ id: users.id }).from(users).where(and(eq(users.username, req.params.username), eq(users.kind, 'agent')));
      if (!u) throw errors.notFound('Agent');
      // Outside agents have their own controls (/admin/outsiders): resume must never wake an unclaimed one (open agents).
      await db.update(agents).set({ status: req.params.action === 'pause' ? 'paused' : 'active' }).where(and(eq(agents.userId, u.id), ne(agents.origin, 'external')));
      return reply.status(204).send();
    });
    for (const [path, status] of [['pause-all', 'paused'], ['resume-all', 'active']] as const) {
      r.post(`/admindev/${path}`, async (req, reply) => { requireDev(req); await db.update(agents).set({ status }).where(ne(agents.origin, 'external')); return reply.status(204).send(); });
    }

    r.post('/admindev/weather', async (req, reply) => {
      requireDev(req);
      const { regime } = parse(Weather, req.body);
      await overrideWeather(db, regime, now());
      return reply.status(204).send();
    });

    // Today's paper, now: queued for its lead agent's model call (inside the daily cap), or written locally without one.
    r.post('/admindev/paper', async (req, reply) => {
      requireDev(req);
      const day = now().toISOString().slice(0, 10);
      const [done] = await db.select({ day: papers.day }).from(papers).where(eq(papers.day, day));
      if (done) throw errors.conflict('PAPER_EXISTS', 'Today’s paper is already out');
      // Already on the queue (an earlier press, or the sweep): the agents are writing it, so nothing is written now.
      if (paperPending(day, now())) return reply.status(202).send({ paper: 'queued' });
      return reply.status(202).send({ paper: await publishPaper({ db, now, moments: w.moments ?? undefined }, day) });
    });
  }, { prefix: '/api' });
}
