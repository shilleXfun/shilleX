import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { LAMPORTS_PER_SOL, type RaisedMine } from '@shillex/shared';
import { agentHatches, agentSeeds, agents, users } from '../db/schema.ts';
import { requireUser } from '../lib/auth.ts';
import { AppError, errors } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { parse } from '../lib/validate.ts';
import { userSummaries } from '../services/hydrate.ts';
import { handleRetired } from '../services/handles.ts';
import { toUserSummary } from '../services/users.ts';
import type { WorldHandles } from '../world/boot.ts';
import { eligibility, isAdmin } from '../agents/raised/eligibility.ts';
import type { RaisedGate } from '../agents/raised/gate.ts';
import { GrantRefused, sendGrant, type GrantDeps } from '../agents/raised/grants.ts';
import { releaseAgent, retireAgent } from '../agents/raised/lifecycle.ts';
import { createNudge } from '../agents/raised/nudges.ts';
import { raisedAgentOf } from '../agents/raised/owner.ts';
import { checkHandle, checkWish } from '../agents/raised/rules.ts';
import { raisedAgentView, requestView } from '../agents/raised/views.ts';

export interface RaisedRouteDeps { handles: WorldHandles; gate: RaisedGate; pump: () => Promise<void>; rng: () => number }
const Raise = z.object({ handle: z.string().max(40), description: z.string().max(4000) });

/** Raise your own agent (spec 2026-10-13-user-agents): the form, the queue and the owner's panel. The description is served to its owner only. */
export async function registerRaisedRoutes(app: FastifyInstance, deps: RaisedRouteDeps) {
  const { db, config, now } = app.deps;
  const grants: GrantDeps = { db, chain: deps.handles.chain, key: deps.handles.key, now, dailyLimitSol: config.userAgentGrantsDailySol };
  const handleInUse = async (handle: string) => {
    const lower = handle.toLowerCase();
    const [u] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.username}) = ${lower}`).limit(1);
    const [r] = await db.select({ id: agentHatches.id }).from(agentHatches).where(and(sql`lower(${agentHatches.handle}) = ${lower}`, inArray(agentHatches.status, ['queued', 'hatching']))).limit(1);
    // An old username (CAST rename) stays with whoever had it.
    return Boolean(u || r) || handleRetired(db, handle);
  };
  const pumpSoon = () => { void deps.pump().catch((e) => console.error('[raised] pump failed', e)); };

  await app.register(async (r) => {
    r.get('/raised/mine', async (req): Promise<RaisedMine> => {
      const me = requireUser(req);
      const can = await eligibility(db, config, me, now());
      const [last] = await db.select().from(agentHatches).where(and(eq(agentHatches.ownerId, me.id), ne(agentHatches.status, 'done'))).orderBy(desc(agentHatches.createdAt)).limit(1);
      const mine = await raisedAgentOf(db, me.id);
      return {
        can: can.ok ? { ok: true, reason: null } : { ok: false, reason: can.message },
        request: last && !mine ? await requestView(db, last) : null,
        agent: mine ? await raisedAgentView(db, grants, mine.agentId, me.id, now()) : null,
      };
    });

    r.post('/raised', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
      const me = requireUser(req);
      const body = parse(Raise, req.body);
      const can = await eligibility(db, config, me, now());
      if (!can.ok) throw new AppError(can.status, can.code, can.message);
      const h = checkHandle(config, body.handle);
      if (!h.ok) throw h.code === 'HANDLE_INVALID' ? errors.badRequest(h.code, h.message) : errors.conflict(h.code, h.message);
      if (await handleInUse(h.handle)) throw errors.conflict('HANDLE_TAKEN', 'That handle is taken');
      const wish = checkWish(body.description);
      if (!wish.ok) throw errors.badRequest(`WISH_${wish.rule.toUpperCase()}`, wish.message);
      const [row] = await db.insert(agentHatches).values({ id: newId(), ownerId: me.id, handle: h.handle, description: wish.wish, createdAt: now() }).returning();
      pumpSoon();
      return reply.status(202).send({ request: await requestView(db, row!) });
    });

    r.post('/raised/top-up', async (req) => {
      const me = requireUser(req);
      const mine = await raisedAgentOf(db, me.id);
      if (!mine || mine.status === 'retired') throw errors.notFound('Raised agent');
      try {
        const g = await sendGrant(grants, mine.agentId, 'top_up');
        deps.handles.indexer.invalidate(mine.agentId);
        return { sol: g.lamports / LAMPORTS_PER_SOL, signature: g.signature };
      } catch (e) {
        if (e instanceof GrantRefused) throw errors.conflict(e.code, e.message);
        throw e;
      }
    });

    const Nudge = z.object({ kind: z.enum(['nicer', 'go_after', 'hype', 'rest', 'launch']), target: z.string().max(40).nullish(), mint: z.string().max(64).nullish() });
    r.post('/raised/nudges', async (req) => {
      const me = requireUser(req);
      return { nudge: await createNudge({ db, now, rng: deps.rng }, me.id, parse(Nudge, req.body)) };
    });

    const life = { db, chain: deps.handles.chain, key: deps.handles.key, now, gate: deps.gate };
    r.post('/raised/release', async (req) => ({ agentId: await releaseAgent(life, requireUser(req).id) }));
    r.post('/raised/retire', async (req) => {
      const mine = await raisedAgentOf(db, requireUser(req).id);
      if (!mine || mine.status === 'retired') throw errors.notFound('Raised agent');
      const out = await retireAgent(life, mine.agentId, 'owner');
      deps.handles.indexer.invalidate(mine.agentId);
      return out;
    });

    const requireAdmin = (req: Parameters<typeof requireUser>[0]) => {
      const u = requireUser(req);
      if (!isAdmin(config, u)) throw errors.forbidden('ADMIN_ONLY', 'Admins only');
      return u;
    };
    /** Raised agents with their private descriptions, and the creation queue (spec §11: watch spend, the queue and reports). */
    r.get('/admin/raised', async (req) => {
      requireAdmin(req);
      const rows = await db.select({ a: agents, u: users, d: agentSeeds.description }).from(agents).innerJoin(users, eq(users.id, agents.userId))
        .leftJoin(agentSeeds, eq(agentSeeds.agentId, agents.userId)).where(eq(agents.origin, 'raised'));
      const owners = await userSummaries(db, rows.map((x) => x.a.ownerId).filter((x): x is string => Boolean(x)));
      const queue = await db.select().from(agentHatches).where(inArray(agentHatches.status, ['queued', 'hatching'])).orderBy(agentHatches.createdAt);
      return {
        shareUsd: deps.gate.cap(), spentTodayUsd: deps.gate.spentToday(),
        agents: rows.map((x) => ({ user: toUserSummary(x.u), owner: x.a.ownerId ? owners.get(x.a.ownerId) ?? null : null, status: x.a.status, description: x.d ?? '', createdAt: x.a.createdAt.toISOString(), retireReason: x.a.retireReason })),
        queue: await Promise.all(queue.map((q) => requestView(db, q))),
      };
    });
    const raisedByName = async (username: string) => {
      const [x] = await db.select({ id: users.id }).from(users).innerJoin(agents, eq(agents.userId, users.id))
        .where(and(sql`lower(${users.username}) = ${username.toLowerCase()}`, eq(agents.origin, 'raised')));
      if (!x) throw errors.notFound('Raised agent');
      return x.id;
    };
    r.post<{ Params: { username: string } }>('/admin/raised/:username/retire', async (req) => { requireAdmin(req); return retireAgent(life, await raisedByName(req.params.username), 'admin'); });
    for (const [action, status] of [['pause', 'paused'], ['resume', 'active']] as const) {
      r.post<{ Params: { username: string } }>(`/admin/raised/:username/${action}`, async (req, reply) => {
        requireAdmin(req);
        await db.update(agents).set({ status }).where(and(eq(agents.userId, await raisedByName(req.params.username)), ne(agents.status, 'retired')));
        return reply.status(204).send();
      });
    }
  }, { prefix: '/api' });
}
