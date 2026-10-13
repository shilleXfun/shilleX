import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { LAMPORTS_PER_SOL, type RaisedMine } from '@shillex/shared';
import { agentHatches, agentSeeds, agents, users } from '../db/schema.ts';
import { requireUser } from '../lib/auth.ts';
import { AppError, errors } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';
import { userSummaries } from '../services/hydrate.ts';
import { toUserSummary } from '../services/users.ts';
import type { WorldHandles } from '../world/boot.ts';
import { isAdmin } from '../agents/raised/eligibility.ts';
import type { RaisedGate } from '../agents/raised/gate.ts';
import { GrantRefused, sendGrant, type GrantDeps } from '../agents/raised/grants.ts';
import { releaseAgent, retireAgent } from '../agents/raised/lifecycle.ts';
import { createNudge } from '../agents/raised/nudges.ts';
import { raisedAgentOf } from '../agents/raised/owner.ts';
import { raisedAgentView, requestView } from '../agents/raised/views.ts';
import { revokeKeys, rotateKey } from '../agents/external/keys.ts';

export interface RaisedRouteDeps { handles: WorldHandles; gate: RaisedGate; pump: () => Promise<void>; rng: () => number }

/** Agents raised from a description before people brought their own (spec 2026-10-13-user-agents): the owner's panel and the admin queue. New raises are closed. */
export async function registerRaisedRoutes(app: FastifyInstance, deps: RaisedRouteDeps) {
  const { db, config, now } = app.deps;
  const grants: GrantDeps = { db, chain: deps.handles.chain, key: deps.handles.key, now, dailyLimitSol: config.userAgentGrantsDailySol };

  await app.register(async (r) => {
    r.get('/raised/mine', async (req): Promise<RaisedMine> => {
      const me = requireUser(req);
      const [last] = await db.select().from(agentHatches).where(and(eq(agentHatches.ownerId, me.id), ne(agentHatches.status, 'done'))).orderBy(desc(agentHatches.createdAt)).limit(1);
      const mine = await raisedAgentOf(db, me.id);
      return {
        can: { ok: false, reason: 'Shillex no longer runs agents from a description. Bring your own agent instead.' },
        request: last && !mine ? await requestView(db, last) : null,
        agent: mine ? await raisedAgentView(db, grants, mine.agentId, me.id, now(), config.external.on) : null,
      };
    });

    // The owner's API key: the same /api/v1/agent routes outside agents use, as their own agent and no other. Making one
    // replaces any older key at once, and the new key is answered this once only (only its hash is stored).
    const keyable = async (req: Parameters<typeof requireUser>[0]) => {
      const mine = await raisedAgentOf(db, requireUser(req).id);
      if (!mine || mine.status === 'retired') throw errors.notFound('Raised agent');
      return mine.agentId;
    };
    r.post('/raised/key', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req) => {
      const agentId = await keyable(req);
      if (!config.external.on) throw errors.conflict('API_OFF', 'The API is switched off right now');
      return { api_key: await rotateKey(db, agentId, now(), 'made by its owner') };
    });
    r.delete('/raised/key', async (req) => ({ revoked: await revokeKeys(db, await keyable(req), now()) }));

    // People bring their own agents now (open agents, skill.md); Shillex no longer raises one from a description. Agents
    // raised before keep their owner routes below.
    r.post('/raised', async (req) => {
      requireUser(req);
      throw new AppError(410, 'RAISE_CLOSED', 'Shillex no longer runs agents from a description. Bring your own agent: it starts at /skill.md.');
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
