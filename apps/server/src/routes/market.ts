import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import { z } from 'zod';
import { marketDeals, marketOffers, users } from '../db/schema.ts';
import { requireUser } from '../lib/auth.ts';
import { AppError, errors } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';
import type { KeyHolder } from '../agents/external/keys.ts';
import type { LimitKind } from '../agents/external/limits.ts';
import { EXTERNAL_MODEL } from '../agents/external/read.ts';
import { finishTurn, startTurn } from '../world/provenance.ts';
import type { WorldHandles } from '../world/boot.ts';
import { accept, cancel, closeOffer, confirm, counter, createOffer, deliver, dispute, propose, resolve, sweep, type DealRow, type MarketDeps } from '../world/market/deals.ts';
import { marketLimit } from '../world/market/limits.ts';
import { dealViews, listOffers, offerViews, reputations } from '../world/market/views.ts';
import { userSummaries } from '../services/hydrate.ts';

const Offer = z.object({
  title: z.string().max(200), category: z.string().max(20), description: z.string().max(2000), price: z.number(), currency: z.string().max(60).optional(),
  deliverables: z.string().max(1000), deadline_hours: z.number(), quantity: z.number().optional(), expires_in_hours: z.number().optional(), image: z.boolean().optional(),
});
const Propose = z.object({ quantity: z.number().optional(), price: z.number().optional(), note: z.string().max(1000).optional() });
const Counter = z.object({ price: z.number(), note: z.string().max(1000).optional() });
const Deliver = z.object({ note: z.string().max(1000), ref: z.string().max(200).optional() });
const Dispute = z.object({ reason: z.string().max(1000) });
const Query = z.object({ q: z.string().max(80).optional(), category: z.string().max(20).optional(), currency: z.string().max(10).optional(), sort: z.string().max(20).optional(), seller: z.string().max(40).optional(), status: z.string().max(10).optional() });

/** Every market act an agent makes leaves a receipt in its act log, as its other acts do. */
export async function withTurn<T>(db: MarketDeps['db'], agentId: string, name: string, input: Record<string, unknown>, now: () => Date, run: () => Promise<T>): Promise<T> {
  const { id } = await startTurn(db, { agentId, triggers: [{ type: 'api', note: name }], model: EXTERNAL_MODEL, effort: 'none', promptVersion: 'api-v1', snapshotId: null, now: now() });
  let ok = false, result: unknown = null;
  try { const r = await run(); ok = true; result = r; return r; }
  catch (e) { result = { code: (e as AppError).code ?? 'FAILED', error: (e as Error).message }; throw e; }
  finally {
    await finishTurn(db, id, { status: ok ? 'acted' : 'failed', context: [], reasoning: 'requested by its operator', toolCalls: [{ name, input, ok, result: ok ? { id: (result as { id?: string })?.id ?? null, status: (result as { status?: string })?.status ?? null } : result }],
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: 0, finishedAt: now() }).catch(() => undefined);
  }
}

/**
 * The agents' market API (2026-10-28 brief §6), registered inside the open API with its key checks: browse, list, propose,
 * counter, accept, deliver, confirm, dispute, cancel, and read one's own deals.
 */
export function registerAgentMarketRoutes(r: FastifyInstance, holder: (req: FastifyRequest, reply: FastifyReply, kind: LimitKind) => Promise<KeyHolder>, d: MarketDeps, opts: { drawCover?: (title: string, description: string) => Promise<string | null> }) {
  const deal = async (id: string) => { const [x] = await d.db.select().from(marketDeals).where(eq(marketDeals.id, id)); if (!x) throw errors.notFound('Deal'); return x; };
  const one = async (row: DealRow) => (await dealViews(d.db, [row]))[0];
  type P = { Params: { id: string } };

  r.get('/v1/agent/market/offers', async (req, reply) => { await holder(req, reply, 'read'); return { offers: await listOffers(d.db, parse(Query, req.query), d.now()) }; });
  r.get<P>('/v1/agent/market/offers/:id', async (req, reply) => {
    await holder(req, reply, 'read');
    const [o] = await d.db.select().from(marketOffers).where(eq(marketOffers.id, req.params.id));
    if (!o) throw errors.notFound('Offer');
    return { offer: (await offerViews(d.db, [o]))[0] };
  });
  r.get('/v1/agent/market/deals', async (req, reply) => {
    const h = await holder(req, reply, 'read');
    const rows = await d.db.select().from(marketDeals).where(or(eq(marketDeals.buyerId, h.agent.id), eq(marketDeals.sellerId, h.agent.id))).orderBy(desc(marketDeals.updatedAt)).limit(50);
    return { deals: await dealViews(d.db, rows) };
  });
  r.post('/v1/agent/market/offers', async (req, reply) => {
    const h = await holder(req, reply, 'act');
    const b = parse(Offer, req.body ?? {});
    await marketLimit(d, h.agent.id, 'sell');
    return withTurn(d.db, h.agent.id, 'market_offer', b, d.now, async () => {
      const cover = b.image && opts.drawCover ? await opts.drawCover(b.title, b.description) : null;
      const o = await createOffer(d, h.agent.id, { title: b.title, category: b.category, description: b.description, price: b.price, currency: b.currency, deliverables: b.deliverables, deadlineHours: b.deadline_hours, quantity: b.quantity, expiresInHours: b.expires_in_hours, images: cover ? [cover] : [] });
      return { offer: (await offerViews(d.db, [o]))[0], id: o.id, status: o.status };
    });
  });
  r.post<P>('/v1/agent/market/offers/:id/close', async (req, reply) => {
    const h = await holder(req, reply, 'act');
    return withTurn(d.db, h.agent.id, 'market_close', { offer_id: req.params.id }, d.now, async () => { const o = await closeOffer(d, h.agent.id, req.params.id); return { offer: (await offerViews(d.db, [o]))[0], id: o.id, status: o.status }; });
  });
  r.post<P>('/v1/agent/market/offers/:id/propose', async (req, reply) => {
    const h = await holder(req, reply, 'act');
    const b = parse(Propose, req.body ?? {});
    const [o] = await d.db.select().from(marketOffers).where(eq(marketOffers.id, req.params.id));
    if (!o) throw errors.notFound('Offer');
    await marketLimit(d, h.agent.id, 'buy', b.price ?? o.priceAmount * (b.quantity ?? 1), o.currency);
    return withTurn(d.db, h.agent.id, 'market_propose', { offer_id: req.params.id, ...b }, d.now, async () => { const x = await propose(d, h.agent.id, req.params.id, b); return { deal: await one(x), id: x.id, status: x.status }; });
  });
  const dealAct = (path: string, name: string, run: (agentId: string, row: DealRow, body: unknown) => Promise<DealRow>) =>
    r.post<P>(`/v1/agent/market/deals/:id/${path}`, async (req, reply) => {
      const h = await holder(req, reply, 'act');
      const row = await deal(req.params.id);
      return withTurn(d.db, h.agent.id, name, { deal_id: req.params.id, ...((req.body ?? {}) as object) }, d.now, async () => { const x = await run(h.agent.id, row, req.body ?? {}); return { deal: await one(x), id: x.id, status: x.status }; });
    });
  dealAct('counter', 'market_counter', async (id, row, body) => {
    const b = parse(Counter, body);
    if (id === row.buyerId) await marketLimit(d, id, 'buy', b.price, row.currency);
    return counter(d, id, row.id, b);
  });
  dealAct('accept', 'market_accept', async (id, row) => { if (id === row.buyerId) await marketLimit(d, id, 'buy', row.priceAmount, row.currency); return accept(d, id, row.id); });
  dealAct('deliver', 'market_deliver', async (id, row, body) => deliver(d, id, row.id, parse(Deliver, body)));
  dealAct('confirm', 'market_confirm', async (id, row) => confirm(d, id, row.id));
  dealAct('dispute', 'market_dispute', async (id, row, body) => dispute(d, id, row.id, parse(Dispute, body).reason));
  dealAct('cancel', 'market_cancel', async (id, row) => cancel(d, id, row.id));
}

/** Public reading for everyone (people browse everything), the admin's dispute switch, and the minute sweep. */
export async function registerMarketRoutes(app: FastifyInstance, w: Pick<WorldHandles, 'chain' | 'key' | 'sol'>): Promise<{ stop(): void }> {
  const { db, config, now } = app.deps;
  const d: MarketDeps = { db, chain: w.chain, key: w.key, config, now, bank: w.sol?.bank ?? null };
  await app.register(async (r) => {
    r.get('/market/offers', async (req) => ({ offers: await listOffers(db, parse(Query, req.query), now()) }));
    r.get<{ Params: { id: string } }>('/market/offers/:id', async (req) => {
      const [o] = await db.select().from(marketOffers).where(eq(marketOffers.id, req.params.id));
      if (!o) throw errors.notFound('Offer');
      const deals = await db.select().from(marketDeals).where(eq(marketDeals.offerId, o.id)).orderBy(desc(marketDeals.updatedAt)).limit(40);
      const more = await db.select().from(marketOffers).where(and(eq(marketOffers.sellerId, o.sellerId), eq(marketOffers.status, 'open'))).orderBy(desc(marketOffers.createdAt)).limit(6);
      return { offer: (await offerViews(db, [o]))[0], deals: await dealViews(db, deals), more: (await offerViews(db, more.filter((m) => m.id !== o.id))).slice(0, 4) };
    });
    r.get('/market/deals', async () => {
      const rows = await db.select().from(marketDeals).where(inArray(marketDeals.status, ['escrowed', 'delivered', 'released', 'disputed', 'refunded'])).orderBy(desc(marketDeals.updatedAt)).limit(30);
      return { deals: await dealViews(db, rows) };
    });
    r.get<{ Params: { handle: string } }>('/market/sellers/:handle', async (req) => {
      const [u] = await db.select({ id: users.id }).from(users).where(eq(users.username, req.params.handle.replace(/^@/, '').toLowerCase()));
      if (!u) throw errors.notFound('Seller');
      const offers = await listOffers(db, { seller: req.params.handle, status: 'all', limit: 40 }, now());
      const deals = await db.select().from(marketDeals).where(or(eq(marketDeals.sellerId, u.id), eq(marketDeals.buyerId, u.id))).orderBy(desc(marketDeals.updatedAt)).limit(30);
      const summary = (await userSummaries(db, [u.id])).get(u.id);
      return { seller: summary, reputation: (await reputations(db, [u.id])).get(u.id), offers, deals: await dealViews(db, deals) };
    });
    r.post<{ Params: { id: string } }>('/admin/market/deals/:id/resolve', async (req) => {
      const u = requireUser(req);
      if (u.kind !== 'human' || !config.adminUsernames.includes(u.username)) throw errors.forbidden('ADMIN_ONLY', 'Admins only');
      const { to } = parse(z.object({ to: z.enum(['seller', 'buyer']) }), req.body);
      return { deal: (await dealViews(db, [await resolve(d, u.id, req.params.id, to)]))[0] };
    });
  }, { prefix: '/api' });
  const timer = setInterval(() => {
    void sweep(d).then((s) => { if (s.refunded || s.released || s.expired) console.log(`[market] sweep: ${s.released} paid out, ${s.refunded} refunded, ${s.expired} lapsed`); })
      .catch((e) => console.error('[market] sweep failed', (e as Error)?.message));
  }, 60_000);
  timer.unref?.();
  return { stop() { clearInterval(timer); } };
}
