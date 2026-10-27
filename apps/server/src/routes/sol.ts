import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, count, eq, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { UserRow } from '../db/schema.ts';
import { agentRules, agents, serviceOrders, solPositions, solWallets, userWallets, users } from '../db/schema.ts';
import { errors } from '../lib/errors.ts';
import { requireUser } from '../lib/auth.ts';
import { WalletProofBody, verifyProof } from '../services/wallet-auth.ts';
import type { WorldHandles } from '../world/boot.ts';
import { normalizeRules } from '../world/sol-rules.ts';
import { ESCROW, killedReason, setKilled, solView } from '../world/sol-trade.ts';
import { listingsView, ordersView } from '../world/sol-market.ts';

/**
 * Real SOL routes (2026-10-27). Anyone may see an agent's wallet, positions, trades and its owner's rules. Only its owner may
 * change the rules or withdraw, and each time with a fresh wallet signature (`confirm`) by a wallet linked to the owner's
 * account; a withdrawal goes only to that signing wallet. The owner of a house agent is an admin; of a raised one, who raised it.
 */
const RulesBody = z.object({ rules: z.record(z.string(), z.unknown()), wallet: WalletProofBody });
const WithdrawBody = z.object({ sol: z.number().positive().max(1e6).nullish(), wallet: WalletProofBody });
const KillBody = z.object({ stopped: z.boolean() });

export async function registerSolRoutes(app: FastifyInstance, w: WorldHandles) {
  const { db, config } = app.deps;
  const isAdmin = (u: UserRow | null | undefined) => Boolean(u && u.kind === 'human' && config.adminUsernames.includes(u.username));

  const agentOf = async (username: string) => {
    const [a] = await db.select({ id: users.id, origin: agents.origin, ownerId: agents.ownerId }).from(users).innerJoin(agents, eq(agents.userId, users.id)).where(eq(users.username, username.toLowerCase()));
    if (!a) throw errors.notFound('Agent');
    return a;
  };
  const owns = (u: UserRow | null | undefined, a: { origin: string; ownerId: string | null }) => Boolean(u && (a.ownerId ? a.ownerId === u.id : a.origin === 'wild' && isAdmin(u)));
  /** The owner, proven again by a signature from one of its linked wallets; returns that wallet. */
  const signedOwner = async (req: FastifyRequest, a: { origin: string; ownerId: string | null }, proof: z.infer<typeof WalletProofBody>) => {
    const u = requireUser(req);
    if (!owns(u, a)) throw errors.forbidden('NOT_OWNER', 'Only this agent\'s owner can do that');
    const { address } = await verifyProof(app.deps, proof, 'confirm', u.id);
    const [linked] = await db.select({ a: userWallets.address }).from(userWallets).where(and(eq(userWallets.address, address), eq(userWallets.userId, u.id), isNotNull(userWallets.verifiedAt)));
    if (!linked) throw errors.forbidden('WALLET_NOT_LINKED', 'Sign with a wallet linked to your account (Settings → Wallets)');
    return address;
  };

  await app.register(async (r) => {
    r.get<{ Params: { username: string } }>('/agents/:username/sol', async (req) => {
      const a = await agentOf(req.params.username);
      return { sol: await solView(db, a.id, owns(req.user, a)), on: Boolean(w.sol?.on), stopped: await killedReason(db, config.solTrading.on) };
    });

    r.put<{ Params: { username: string } }>('/agents/:username/rules', async (req) => {
      const a = await agentOf(req.params.username);
      const body = RulesBody.parse(req.body);
      const signer = await signedOwner(req, a, body.wallet);
      const rules = normalizeRules(body.rules);
      const now = app.deps.now();
      // Saving the rules again also lifts a pause a loss limit set (its count starts over from now).
      await db.insert(agentRules).values({ agentId: a.id, rules, signedBy: signer, updatedAt: now })
        .onConflictDoUpdate({ target: agentRules.agentId, set: { rules, signedBy: signer, updatedAt: now, pausedUntil: null, pausedReason: null } });
      return { rules };
    });

    r.post<{ Params: { username: string } }>('/agents/:username/withdraw', async (req) => {
      if (!w.sol) throw errors.badRequest('SOL_OFF', 'Real SOL wallets are not set up on this server');
      const a = await agentOf(req.params.username);
      const body = WithdrawBody.parse(req.body);
      const to = await signedOwner(req, a, body.wallet);
      const res = await w.sol.bank.withdraw(a.id, to, body.sol ? Math.floor(body.sol * 1e9) : null);
      if (!res.ok) throw errors.badRequest('WITHDRAW_FAILED', res.outcome);
      return res;
    });

    r.get<{ Querystring: { agent?: string } }>('/market', async (req) => {
      const agentId = req.query.agent ? (await agentOf(req.query.agent)).id : undefined;
      return { listings: await listingsView(db, agentId ? { sellerId: agentId } : {}), orders: await ordersView(db, agentId ? { agentId } : {}) };
    });

    r.get('/admin/sol', async (req) => {
      if (!isAdmin(requireUser(req))) throw errors.forbidden('ADMIN_ONLY', 'Admins only');
      const [wallets] = await db.select({ n: count(), funded: sql<number>`count(*) filter (where ${solWallets.lamports} > 0 and ${solWallets.ownerId} <> ${ESCROW})::int`, lamports: sql<number>`coalesce(sum(${solWallets.lamports}), 0)::float8` }).from(solWallets);
      const [positions] = await db.select({ n: count() }).from(solPositions);
      const [open] = await db.select({ n: count() }).from(serviceOrders).where(sql`${serviceOrders.status} in ('paid', 'delivered')`);
      return { on: config.solTrading.on, ready: Boolean(w.sol), stopped: await killedReason(db, config.solTrading.on), wallets: Number(wallets?.n ?? 0), funded: Number(wallets?.funded ?? 0), sol: Number(wallets?.lamports ?? 0) / 1e9, positions: Number(positions?.n ?? 0), openOrders: Number(open?.n ?? 0) };
    });
    r.post('/admin/sol/stop', async (req) => {
      if (!isAdmin(requireUser(req))) throw errors.forbidden('ADMIN_ONLY', 'Admins only');
      const { stopped } = KillBody.parse(req.body);
      await setKilled(db, stopped);
      console.log(`[sol] the admin ${stopped ? 'STOPPED' : 'restarted'} real SOL trading`);
      return { stopped: await killedReason(db, config.solTrading.on) };
    });
  }, { prefix: '/api' });
}
