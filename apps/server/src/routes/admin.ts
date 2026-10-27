import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, eq, gte, ne, sql } from 'drizzle-orm';
import { agentTurns, agents, users } from '../db/schema.ts';
import { errors } from '../lib/errors.ts';
import { requireUser } from '../lib/auth.ts';
import { TREASURY, walletOf } from '../world/wallets.ts';
import { setUpWorld, type WorldHandles } from '../world/boot.ts';
import { TreasuryEmpty } from '../world/ledger.ts';
import { restoreVersion } from '../sites/store.ts';

/** Kill switches and status for the agent world. Admins are human accounts listed in ADMIN_USERNAMES. */
export async function registerAdminRoutes(app: FastifyInstance, w: WorldHandles) {
  const { db, config, now } = app.deps;
  const requireAdmin = (req: FastifyRequest) => {
    const u = requireUser(req);
    if (u.kind !== 'human' || !config.adminUsernames.includes(u.username)) throw errors.forbidden('ADMIN_ONLY', 'Admins only');
    return u;
  };
  await app.register(async (r) => {
    r.get('/admin/world', async (req) => {
      requireAdmin(req);
      const day = new Date(`${now().toISOString().slice(0, 10)}T00:00:00Z`);
      const byStatus = await db.select({ s: agentTurns.status, n: sql<number>`count(*)::int` }).from(agentTurns).where(gte(agentTurns.startedAt, day)).groupBy(agentTurns.status);
      const [paused] = await db.select({ n: sql<number>`count(*)::int` }).from(agents).where(eq(agents.status, 'paused'));
      const treasury = await walletOf(db, TREASURY);
      const lamports = treasury ? (await w.chain.balances(treasury.publicKey).catch(() => null))?.lamports ?? null : null;
      return {
        spentTodayUsd: w.budget.spentToday(), budgetLevel: w.budget.level(), dailyBudgetUsd: w.budget.capUsd(),
        turnsToday: Object.fromEntries(byStatus.map((x) => [x.s, x.n])), paused: paused?.n ?? 0,
        runtime: w.engine ? { queued: w.moments?.size() ?? 0, running: 0, halted: w.moments?.halted() ?? null, engine: w.engine.stats() } : null, treasury: treasury ? { publicKey: treasury.publicKey, sol: lamports === null ? null : lamports / 1e9 } : null,
      };
    });
    r.post<{ Params: { username: string; action: string } }>('/admin/world/agents/:username/:action', async (req, reply) => {
      requireAdmin(req);
      if (req.params.action !== 'pause' && req.params.action !== 'resume') throw errors.notFound('Action');
      const [u] = await db.select({ id: users.id }).from(users).where(and(eq(users.username, req.params.username), eq(users.kind, 'agent')));
      if (!u) throw errors.notFound('Agent');
      // A retired raised agent (RAISE §9) stays retired: pause and resume never bring it back. An outside agent has its own
      // controls (/admin/outsiders): resume here must never wake an unclaimed one (open agents).
      await db.update(agents).set({ status: req.params.action === 'pause' ? 'paused' : 'active' }).where(and(eq(agents.userId, u.id), ne(agents.status, 'retired'), ne(agents.origin, 'external')));
      return reply.status(204).send();
    });
    // Put an earlier version of a site back as its newest (plan E4): a bad build, or one an agent should not have shipped.
    r.post<{ Params: { slug: string }; Body: { version?: unknown } }>('/admin/sites/:slug/restore', async (req) => {
      requireAdmin(req);
      const version = Number(req.body?.version);
      if (!Number.isInteger(version) || version < 1) throw errors.badRequest('BAD_VERSION', 'Give the version number to put back');
      const site = await restoreVersion(db, req.params.slug, version, now());
      if (!site) throw errors.notFound('Site version');
      return { slug: site.slug, version: site.version, restoredFrom: version };
    });
    for (const [path, status] of [['pause-all', 'paused'], ['resume-all', 'active']] as const) {
      r.post(`/admin/world/${path}`, async (req, reply) => { requireAdmin(req); await db.update(agents).set({ status }).where(and(ne(agents.status, 'retired'), ne(agents.origin, 'external'))); return reply.status(204).send(); });
    }
    // Set up and fund: creates the launchpad if it is missing, funds unfunded agents, then starts the agents.
    r.post('/admin/world/fund', async (req) => {
      requireAdmin(req);
      const r = await setUpWorld(db, w.chain, w.key, now).catch((e) => { throw e instanceof TreasuryEmpty ? errors.conflict('TREASURY_EMPTY', e.message) : e; });
      return { ...r, agents: w.startAgents() };
    });
  }, { prefix: '/api' });
}
