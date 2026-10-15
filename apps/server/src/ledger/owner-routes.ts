import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { MainnetMeView } from '@shillex/shared';
import { ledgerDeposits } from '../db/schema.ts';
import { requireUser } from '../lib/auth.ts';
import { errors } from '../lib/errors.ts';
import { payoutWallet } from '../services/wallets.ts';
import { walletOf } from '../world/wallets.ts';
import { noticeView } from './consent.ts';
import { toDepositView } from './custody.ts';
import { toHttp } from './errors.ts';
import { ownedAgent, pendingPayoutChange } from './owner.ts';
import type { MainnetHandles } from './routes.ts';

const SOL = 1e9;
const lamports = (sol: number) => Math.round(sol * SOL);

/** An owner funds, withdraws and cashes out their own raised agent (spec §4). Nobody funds someone else's agent. */
export async function registerMainnetOwnerRoutes(app: FastifyInstance, h: MainnetHandles) {
  const { db, now } = app.deps;
  const mine = async (userId: string) => {
    const a = await ownedAgent(db, userId);
    if (!a) throw errors.conflict('NO_RAISED_AGENT', 'Raise an agent first: you fund only your own');
    return a;
  };
  const custody = () => { if (!h.custody) throw errors.conflict('NO_CUSTODY', 'Real SOL is not on in this world'); return h.custody; };
  const money = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } };

  await app.register(async (r) => {
    r.get('/mainnet/me', async (req): Promise<MainnetMeView> => {
      const u = requireUser(req);
      const a = await ownedAgent(db, u.id), c = h.custody;
      const pk = a ? (await walletOf(db, a.id))?.publicKey : undefined;
      const hot = c ? await c.hot() : null;
      const deps = a && hot ? await db.select().from(ledgerDeposits).where(and(eq(ledgerDeposits.agentId, a.id), eq(ledgerDeposits.userId, u.id))).orderBy(desc(ledgerDeposits.createdAt)).limit(10) : [];
      const change = await pendingPayoutChange(db, u.id);
      return {
        mode: h.mode, agentId: a?.id ?? null, agentUsername: a?.username ?? null, balanceSol: pk ? (await h.chain.balances(pk)).lamports / SOL : 0,
        payout: await payoutWallet(db, u.id), payoutChange: change ? { address: change.address, effectiveAt: change.effectiveAt.toISOString() } : null,
        notice: await noticeView(db, u.id, now()), deposits: deps.map((d) => toDepositView(d, hot!)),
        withdrawals: a && c ? (await c.withdrawals({ agentId: a.id })).slice(0, 10) : [],
        roomSol: a && c ? (await c.room(a.id, u.id)).lamports / SOL : null,
      };
    });
    r.post('/mainnet/deposits', money, async (req) => {
      const u = requireUser(req);
      // The owner's own test of real SOL holds no one else's money: deposits open only with the full launch gate.
      if (app.deps.config.mainnetOwnerOnly) throw errors.forbidden('OWNER_ONLY', 'Deposits are closed: Shillex is running the owner’s test of real SOL');
      const { sol } = z.object({ sol: z.number().positive().max(100) }).parse(req.body);
      const a = await mine(u.id);
      try { return await custody().createDeposit({ agentId: a.id, userId: u.id, lamports: lamports(sol) }); } catch (e) { throw toHttp(e); }
    });
    r.get<{ Params: { id: string } }>('/mainnet/deposits/:id', async (req) => {
      const u = requireUser(req);
      const [d] = await db.select().from(ledgerDeposits).where(and(eq(ledgerDeposits.id, req.params.id), eq(ledgerDeposits.userId, u.id)));
      if (!d) throw errors.notFound('Deposit');
      return toDepositView(d, await custody().hot());
    });
    r.post('/mainnet/withdrawals', money, async (req) => {
      const u = requireUser(req);
      const b = z.object({ sol: z.union([z.number().positive().max(100), z.literal('all')]) }).parse(req.body);
      const a = await mine(u.id);
      try {
        const w = await custody().requestWithdrawal({ agentId: a.id, userId: u.id, lamports: b.sol === 'all' ? 'all' : lamports(b.sol) });
        void custody().processWithdrawals().catch((e) => console.error('[mainnet] withdrawals', e));
        return w;
      } catch (e) { throw toHttp(e); }
    });
    r.post('/mainnet/cash-out', money, async (req) => {
      const u = requireUser(req);
      const a = await mine(u.id);
      try {
        const out = await custody().cashOut({ agentId: a.id, userId: u.id });
        void custody().processWithdrawals().catch((e) => console.error('[mainnet] withdrawals', e));
        return out;
      } catch (e) { throw toHttp(e); }
    });
  }, { prefix: '/api' });
}
