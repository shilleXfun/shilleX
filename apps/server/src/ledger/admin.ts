import type { FastifyInstance, FastifyRequest } from 'fastify';
import { verify } from '@node-rs/argon2';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { MainnetAdminView } from '@shillex/shared';
import { ledgerAccounts, ledgerChainSeen, ledgerReconciliations, users } from '../db/schema.ts';
import { requireUser } from '../lib/auth.ts';
import { errors } from '../lib/errors.ts';
import { setSetting } from '../world/launchpad.ts';
import { HOUSE, currentSeason, lamportsOf, move } from './accounts.ts';
import { audit } from './audit.ts';
import { books } from './books.ts';
import { currentNotice, publishNotice } from './consent.ts';
import { CAPS_KEY, type MainnetCaps } from './custody.ts';
import { toHttp } from './errors.ts';
import { LEGAL_CONFIRMATION, legalReview, recordLegalReview } from './gate.ts';
import { reconcile } from './reconcile.ts';
import type { MainnetHandles } from './routes.ts';
import type { Db } from '../db/client.ts';

const SOL = 1e9;
const lamports = (sol: number) => Math.round(sol * SOL);
const CAP_FIELDS = { agentCapSol: 'agentLifetime', agentDailyCapSol: 'agentDaily', userMonthlyCapSol: 'userMonthly', worldCapSol: 'world', hotMaxSol: 'hotMax', outflowDailyMaxSol: 'outflowDaily' } as const;

/** Money actions on /admin (spec §7): admins only, the admin password again on every POST, one audit row each. */
export async function registerMainnetAdminRoutes(app: FastifyInstance, h: MainnetHandles) {
  const { db, config, now } = app.deps;
  const requireAdmin = (req: FastifyRequest) => {
    const u = requireUser(req);
    if (u.kind !== 'human' || !config.adminUsernames.includes(u.username)) throw errors.forbidden('ADMIN_ONLY', 'Admins only');
    return u;
  };
  const confirm = async (req: FastifyRequest) => {
    const u = requireAdmin(req);
    const { password } = z.object({ password: z.string().min(1).max(200) }).parse(req.body);
    const [row] = await db.select({ h: users.passwordHash }).from(users).where(eq(users.id, u.id));
    if (!row?.h || !(await verify(row.h, password))) throw errors.forbidden('BAD_PASSWORD', 'Wrong password');
    return u;
  };
  const custody = () => { if (!h.custody) throw errors.conflict('NO_CUSTODY', 'Custody runs only with MAINNET=rehearsal or on'); return h.custody; };
  const money = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  await app.register(async (r) => {
    r.get('/admin/mainnet/status', async (req): Promise<MainnetAdminView> => {
      requireAdmin(req);
      const b = await books(db), c = h.custody, caps = c ? await c.caps() : null;
      const bal = async (a: string | null) => (a && c ? await c.d.rpc.balance(a).catch(() => null) : null);
      const hot = c ? await c.hot() : null, hotSol = await bal(hot), coldSol = await bal(c?.cold ?? null);
      const [last] = await db.select().from(ledgerReconciliations).orderBy(desc(ledgerReconciliations.at)).limit(1);
      const seen = await db.select().from(ledgerChainSeen).where(inArray(ledgerChainSeen.outcome, ['from_cold', 'refund_failed'])).orderBy(desc(ledgerChainSeen.createdAt)).limit(50);
      const top10 = (await db.select({ l: ledgerAccounts.lamports }).from(ledgerAccounts).orderBy(desc(ledgerAccounts.lamports)).limit(10)).reduce((n, x) => n + x.l, 0);
      const n = await currentNotice(db), lr = await legalReview(db);
      const { gateStatus } = await import('./gate.ts');
      return {
        mode: h.mode, season: b.season, frozen: h.chain.frozen,
        hot: hot ? { address: hot, sol: hotSol === null ? null : hotSol / SOL } : null,
        cold: c?.cold ? { address: c.cold, sol: coldSol === null ? null : coldSol / SOL } : null,
        books: { ledgerTotalSol: b.ledgerTotal / SOL, houseSol: (await lamportsOf(db, HOUSE)) / SOL, ok: b.ok, mismatches: b.mismatches },
        lastReconciliation: last ? { at: last.at.toISOString(), ok: last.ok, details: last.details } : null,
        withdrawals: c ? await c.withdrawals({ open: true }) : [],
        fromCold: seen.filter((s) => s.outcome === 'from_cold').map((s) => ({ signature: s.signature, sol: s.lamports / SOL, at: s.createdAt.toISOString() })),
        refundFailures: seen.filter((s) => s.outcome === 'refund_failed').map((s) => ({ signature: s.signature, sol: s.lamports / SOL, from: s.fromAddress, reason: s.reason })),
        caps: caps
          ? { agentCapSol: caps.agentLifetime / SOL, agentDailyCapSol: caps.agentDaily / SOL, userMonthlyCapSol: caps.userMonthly / SOL, worldCapSol: caps.world / SOL, hotMaxSol: caps.hotMax / SOL, outflowDailyMaxSol: caps.outflowDaily / SOL }
          : { ...config.mainnetLimits },
        excessSol: caps && hotSol !== null ? Math.max(0, hotSol - caps.hotMax) / SOL : 0,
        hotCoversTop10: hotSol !== null && hotSol >= top10,
        notice: n, legalReview: lr ? { reviewer: lr.reviewer, date: lr.date, note: lr.note, confirmedBy: lr.confirmedBy } : null,
        gate: h.mode === 'off' ? ['MAINNET is off'] : await gateStatus({ db, config, rpc: c?.d.rpc ?? null, custody: c, now }),
      };
    });

    r.post('/admin/mainnet/stake', money, async (req, reply) => {
      const u = await confirm(req);
      // Any length: the signature must name an unrecorded transfer from the cold address the poller saw, nothing else is accepted.
      const { signature } = z.object({ signature: z.string().min(1).max(120) }).parse(req.body);
      const at = now();
      await db.transaction(async (x) => {
        const tx = x as unknown as Db;
        const done = await tx.update(ledgerChainSeen).set({ outcome: 'stake' }).where(and(eq(ledgerChainSeen.signature, signature), eq(ledgerChainSeen.outcome, 'from_cold'))).returning();
        if (!done.length) throw errors.conflict('NOT_A_COLD_TRANSFER', 'That signature is not an unrecorded transfer from the cold address');
        await move(tx, { from: 'external', to: HOUSE, lamports: done[0]!.lamports, kind: 'house_stake', ref: signature, season: await currentSeason(tx), at });
      });
      await audit(db, u.id, 'stake', { signature }, at);
      return reply.status(204).send();
    });

    r.post('/admin/mainnet/house-withdraw', money, async (req) => {
      const u = await confirm(req);
      const { sol } = z.object({ sol: z.number().positive().max(10_000) }).parse(req.body);
      const c = custody();
      if (!c.cold) throw errors.conflict('NO_COLD', 'Set MAINNET_COLD_ADDRESS first');
      try {
        const w = await c.enqueue({ agentId: null, userId: null, to: c.cold, lamports: lamports(sol), approvedBy: u.id });
        await audit(db, u.id, 'house_withdraw', { sol, id: w.id }, now());
        void c.processWithdrawals().catch((e) => console.error('[mainnet] withdrawals', e));
        return w;
      } catch (e) { throw toHttp(e); }
    });

    r.post('/admin/mainnet/to-cold', money, async (req) => {
      const u = await confirm(req);
      const { sol } = z.object({ sol: z.number().positive().max(10_000) }).parse(req.body);
      const c = custody();
      if (!c.cold) throw errors.conflict('NO_COLD', 'Set MAINNET_COLD_ADDRESS first');
      // Hot to cold moves reserves only: the books are unchanged, except the house paying the network fee.
      const s = await c.moveToCold(lamports(sol));
      await audit(db, u.id, 'to_cold', { sol, signature: s }, now());
      return { signature: s };
    });

    r.post<{ Params: { id: string } }>('/admin/mainnet/withdrawals/:id/approve', money, async (req, reply) => {
      const u = await confirm(req);
      try { await custody().approve(req.params.id, u.id); } catch (e) { throw toHttp(e); }
      await audit(db, u.id, 'approve_withdrawal', { id: req.params.id }, now());
      void custody().processWithdrawals().catch((e) => console.error('[mainnet] withdrawals', e));
      return reply.status(204).send();
    });

    r.post<{ Params: { id: string } }>('/admin/mainnet/withdrawals/:id/resolve', money, async (req, reply) => {
      const u = await confirm(req);
      const b = z.object({ outcome: z.enum(['sent', 'return']), signature: z.string().max(120).optional() }).parse(req.body);
      try { await custody().resolveStuck(req.params.id, b.outcome, b.signature); } catch (e) { throw toHttp(e); }
      await audit(db, u.id, 'resolve_withdrawal', { id: req.params.id, ...b }, now());
      return reply.status(204).send();
    });

    r.post('/admin/mainnet/unfreeze', money, async (req, reply) => {
      const u = await confirm(req);
      const check = await reconcile({ db, chain: h.chain, custody: h.custody, mode: h.mode, now });
      if (check.ok !== true) throw errors.conflict('STILL_FAILING', 'The books still do not reconcile; fix that first');
      await h.chain.unfreeze();
      await audit(db, u.id, 'unfreeze', { reconciliation: check.id }, now());
      return reply.status(204).send();
    });

    r.post('/admin/mainnet/caps', money, async (req, reply) => {
      const u = await confirm(req);
      const { caps } = z.object({ caps: z.partialRecord(z.enum(Object.keys(CAP_FIELDS) as [keyof typeof CAP_FIELDS]), z.number().nonnegative()) }).parse(req.body);
      const override: Partial<MainnetCaps> = {};
      for (const [k, v] of Object.entries(caps) as [keyof typeof CAP_FIELDS, number][]) {
        if (v > config.mainnetLimits[k]) throw errors.badRequest('CAPS_ONLY_LOWER', `${k} can only go below the configured ${config.mainnetLimits[k]} SOL; raising it needs a config change`);
        override[CAP_FIELDS[k]] = lamports(v);
      }
      await setSetting(db, CAPS_KEY, JSON.stringify(override));
      await audit(db, u.id, 'caps', { caps }, now());
      return reply.status(204).send();
    });

    r.post('/admin/mainnet/notice', money, async (req) => {
      const u = await confirm(req);
      const { legalPosition } = z.object({ legalPosition: z.string().trim().min(10).max(2000) }).parse(req.body);
      const n = await publishNotice(db, legalPosition, now());
      await audit(db, u.id, 'notice', { version: n.version, legalPosition }, now());
      return n;
    });

    r.post('/admin/mainnet/legal-review', money, async (req, reply) => {
      const u = await confirm(req);
      const b = z.object({ reviewer: z.string().trim().min(2).max(120), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), note: z.string().trim().min(5).max(2000), confirm: z.string() }).parse(req.body);
      if (b.confirm !== LEGAL_CONFIRMATION) throw errors.badRequest('CONFIRMATION_MISMATCH', `Type exactly: ${LEGAL_CONFIRMATION}`);
      await recordLegalReview(db, u.id, { reviewer: b.reviewer, date: b.date, note: b.note, confirmedBy: u.username }, now());
      return reply.status(204).send();
    });
  }, { prefix: '/api' });
}
