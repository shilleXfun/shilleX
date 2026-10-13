import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { MainnetMode } from '@shillex/shared';
import { requireUser } from '../lib/auth.ts';
import { errors } from '../lib/errors.ts';
import type { LedgerChain } from './ledger-chain.ts';
import { acceptNotice, excludeSelf, noticeView } from './consent.ts';
import { toHttp } from './errors.ts';
import { reservesView } from './reconcile.ts';
import type { Custody } from './custody.ts';

/** What the mainnet routes need from boot (Task 13 creates it). */
export interface MainnetHandles { mode: MainnetMode; chain: LedgerChain; custody: Custody | null; stop(): Promise<void> }

const humanOnly = (u: { kind: string }) => { if (u.kind !== 'human') throw errors.forbidden('HUMANS_ONLY', 'Only people fund agents'); };

/** Public mainnet routes. Registered only in a ledger world, so everywhere else they answer 404. */
export async function registerMainnetRoutes(app: FastifyInstance, h: MainnetHandles) {
  const { db, now } = app.deps;
  await app.register(async (r) => {
    r.get('/mainnet/notice', async (req) => noticeView(db, req.user?.id ?? null, now()));
    r.post('/mainnet/notice', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
      const u = requireUser(req); humanOnly(u);
      const b = z.object({ version: z.string().min(1).max(20), adult: z.boolean() }).parse(req.body);
      try { await acceptNotice(db, u.id, b.version, b.adult, now()); } catch (e) { throw toHttp(e); }
      return reply.status(204).send();
    });
    r.post('/mainnet/exclusion', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
      const u = requireUser(req); humanOnly(u);
      const b = z.object({ days: z.union([z.literal(7), z.literal(30)]) }).parse(req.body);
      return { until: (await excludeSelf(db, u.id, b.days, now())).toISOString() };
    });
    r.get('/mainnet/reserves', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async () => reservesView(db, h));
  }, { prefix: '/api' });
}
