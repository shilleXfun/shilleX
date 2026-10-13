import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { LAMPORTS_PER_SOL, type RaisedMine } from '@shillex/shared';
import { agentHatches, users } from '../db/schema.ts';
import { requireUser } from '../lib/auth.ts';
import { AppError, errors } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { parse } from '../lib/validate.ts';
import type { WorldHandles } from '../world/boot.ts';
import { eligibility } from '../agents/raised/eligibility.ts';
import type { RaisedGate } from '../agents/raised/gate.ts';
import { GrantRefused, sendGrant, type GrantDeps } from '../agents/raised/grants.ts';
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
    return Boolean(u || r);
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
  }, { prefix: '/api' });
}
