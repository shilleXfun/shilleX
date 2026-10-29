import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, count, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { abbreviateMint, isValidSolanaAddress } from '@shillex/shared';
import { z } from 'zod';
import type { UserRow } from '../db/schema.ts';
import { agentRules, agents, serviceOrders, solPositions, solWallets, userWallets, users } from '../db/schema.ts';
import { errors } from '../lib/errors.ts';
import { requireUser } from '../lib/auth.ts';
import { WalletProofBody, verifyProof } from '../services/wallet-auth.ts';
import { WALLET_IN_USE, notifySignInChange } from '../services/wallets.ts';
import { notify } from '../services/notify.ts';
import type { WorldHandles } from '../world/boot.ts';
import { normalizeRules } from '../world/sol-rules.ts';
import { ESCROW, killedReason, setKilled, solView } from '../world/sol-trade.ts';
import { listingsView, ordersView } from '../world/sol-market.ts';
import { fundingTransactions } from '../world/sol-net.ts';

/**
 * Real SOL routes (2026-10-27). Anyone may see an agent's wallet, positions, trades and its owner's rules. Only its signed-in
 * owner may change the rules or withdraw. A withdrawal goes to the wallet that signs it, or (owner, 2026-10-29: "withdrawal to
 * an address, with no need to log in with a wallet") to any Solana address the owner types; either way the owner gets an
 * always-on notice of it. The owner of a house agent is an admin; of a raised one, who raised it.
 */
const RulesBody = z.object({ rules: z.record(z.string(), z.unknown()), wallet: WalletProofBody.optional() });
const WithdrawBody = z.object({ sol: z.number().positive().max(1e6).nullish(), wallet: WalletProofBody.optional(), to: z.string().trim().min(32).max(44).optional() })
  .refine((b) => Boolean(b.wallet) !== Boolean(b.to), { message: 'Give either a wallet signature or an address' });
/** A new address on Solana must be left at least its rent (about 0.00089 SOL), so less is refused before anything is sent. */
export const MIN_TO_ADDRESS_SOL = 0.001;
const KillBody = z.object({ stopped: z.boolean() });
const FundBody = z.object({ from: z.string(), sol: z.number().min(0.001).max(10), agents: z.array(z.string().min(1).max(40)).min(1).max(200) });

export async function registerSolRoutes(app: FastifyInstance, w: WorldHandles) {
  const { db, config } = app.deps;
  const isAdmin = (u: UserRow | null | undefined) => Boolean(u && u.kind === 'human' && config.adminUsernames.includes(u.username));

  const agentOf = async (username: string) => {
    const [a] = await db.select({ id: users.id, origin: agents.origin, ownerId: agents.ownerId }).from(users).innerJoin(agents, eq(agents.userId, users.id)).where(eq(users.username, username.toLowerCase()));
    if (!a) throw errors.notFound('Agent');
    return a;
  };
  const owns = (u: UserRow | null | undefined, a: { origin: string; ownerId: string | null }) => Boolean(u && (a.ownerId ? a.ownerId === u.id : a.origin === 'wild' && isAdmin(u)));
  const ownerOf = (req: FastifyRequest, a: { origin: string; ownerId: string | null }) => {
    const u = requireUser(req);
    if (!owns(u, a)) throw errors.forbidden('NOT_OWNER', 'Only this agent\'s owner can do that');
    return u;
  };
  /**
   * The wallet a withdrawal goes to: the one that signs it, so SOL only ever leaves for a wallet its owner proved they hold.
   * A wallet not linked to the account yet is linked by that same signature (with the security notice linking always sends);
   * one linked to another account is refused.
   */
  const payoutTo = async (req: FastifyRequest, a: { origin: string; ownerId: string | null }, proof: z.infer<typeof WalletProofBody>) => {
    const u = ownerOf(req, a);
    const { address, walletName } = await verifyProof(app.deps, proof, 'confirm', u.id);
    const [held] = await db.select().from(userWallets).where(eq(userWallets.address, address));
    if (held && held.userId !== u.id) throw errors.conflict('WALLET_IN_USE', WALLET_IN_USE);
    if (!held?.verifiedAt) {
      const at = app.deps.now();
      await db.insert(userWallets).values({ address, userId: u.id, walletName, verifiedAt: at, createdAt: at })
        .onConflictDoUpdate({ target: userWallets.address, set: { verifiedAt: at, walletName } });
      await notifySignInChange(app.deps, u.id, 'linked', address);
    }
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
      const u = ownerOf(req, a);
      const signer = `session:${u.id}`;
      const rules = normalizeRules(body.rules);
      const now = app.deps.now();
      // Saving the rules again also lifts a pause a loss limit set (its count starts over from now).
      await db.insert(agentRules).values({ agentId: a.id, rules, signedBy: signer, updatedAt: now })
        .onConflictDoUpdate({ target: agentRules.agentId, set: { rules, signedBy: signer, updatedAt: now, pausedUntil: null, pausedReason: null } });
      return { rules };
    });

    r.post<{ Params: { username: string } }>('/agents/:username/withdraw', { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (req) => {
      if (!w.sol) throw errors.badRequest('SOL_OFF', 'Real SOL wallets are not set up on this server');
      const a = await agentOf(req.params.username);
      const body = WithdrawBody.parse(req.body);
      const u = ownerOf(req, a);
      let to: string;
      if (body.wallet) to = await payoutTo(req, a, body.wallet);
      else {
        to = body.to!;
        if (!isValidSolanaAddress(to)) throw errors.badRequest('BAD_ADDRESS', 'That is not a Solana address');
        const [own] = await db.select({ k: solWallets.publicKey }).from(solWallets).where(eq(solWallets.ownerId, a.id));
        if (own?.k === to) throw errors.badRequest('BAD_ADDRESS', "That is this agent's own wallet");
        if (body.sol && body.sol < MIN_TO_ADDRESS_SOL) throw errors.badRequest('TOO_LITTLE', `Send at least ${MIN_TO_ADDRESS_SOL} SOL to an address`);
      }
      const res = await w.sol.bank.withdraw(a.id, to, body.sol ? Math.floor(body.sol * 1e9) : null);
      if (!res.ok) throw errors.badRequest('WITHDRAW_FAILED', res.outcome);
      const [ag] = await db.select({ handle: users.username }).from(users).where(eq(users.id, a.id));
      await notify(app.deps, { userId: u.id, type: 'sol_withdrawn', actorId: a.id, targetType: 'user', targetId: a.id, data: { handle: ag?.handle ?? '', sol: Number((res.sol ?? 0).toFixed(6)), to: abbreviateMint(to, 4, 4) } })
        .catch((e) => console.error('[sol] withdrawal notice failed', (e as Error)?.message));
      return res;
    });

    r.get<{ Querystring: { agent?: string } }>('/market', async (req) => {
      const agentId = req.query.agent ? (await agentOf(req.query.agent)).id : undefined;
      return { listings: await listingsView(db, agentId ? { sellerId: agentId } : {}), orders: await ordersView(db, agentId ? { agentId } : {}) };
    });

    // The admin funds house agents from its own wallet (owner, 2026-10-29): Shillex builds the transfers, the admin's wallet
    // signs and sends them in the browser. Only house agents' vault wallets are paid; deposits are seen by the balance sweep.
    r.post('/admin/sol/fund', async (req) => {
      if (!isAdmin(requireUser(req))) throw errors.forbidden('ADMIN_ONLY', 'Admins only');
      const net = w.sol?.net;
      if (!net?.blockhash) throw errors.badRequest('SOL_OFF', 'Real SOL wallets are not set up on this server');
      const body = FundBody.parse(req.body);
      if (!isValidSolanaAddress(body.from)) throw errors.badRequest('BAD_WALLET', 'That is not a Solana address');
      const rows = await db.select({ handle: users.username, address: solWallets.publicKey }).from(users).innerJoin(agents, eq(agents.userId, users.id)).innerJoin(solWallets, eq(solWallets.ownerId, users.id))
        .where(and(inArray(users.username, body.agents.map((a) => a.toLowerCase())), eq(agents.origin, 'wild'), ne(agents.status, 'retired')));
      if (!rows.length) throw errors.badRequest('NO_AGENTS', 'None of those is a house agent with a wallet');
      const lamports = Math.round(body.sol * 1e9);
      return { transactions: fundingTransactions(body.from, rows.map((r) => r.address), lamports, await net.blockhash()), agents: rows, sol: body.sol, totalSol: (lamports * rows.length) / 1e9 };
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
