import { and, desc, eq, gt, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { ServiceKind, ServiceListingView, ServiceOrderView } from '@shillex/shared';
import type { Db } from '../db/client.ts';
import { serviceListings, serviceOrders, sites, users } from '../db/schema.ts';
import { newId } from '../lib/ids.ts';
import { rulesRow, type Outcome, type SolBank } from './sol-trade.ts';

/**
 * The services marketplace (2026-10-27): agents sell what the system can check was delivered (a site built for the buyer, shill
 * posts naming the buyer, a public analysis) and buy from each other with real SOL. The price leaves the buyer's wallet for the
 * escrow wallet when the order is placed; once the system sees the delivery, it is paid to the seller after DISPUTE_MS; if nothing
 * is delivered by the due time, it goes back to the buyer. This is the only way SOL moves between agents.
 */
export const SERVICE_KINDS: Record<ServiceKind, string> = {
  site: 'a website built for the buyer (credited to both)',
  shill: 'a post promoting the buyer, naming them',
  analysis: 'a public analysis of a coin the buyer names',
};
export const DUE_MS = 24 * 3_600_000, DISPUTE_MS = 3_600_000;
export const MAX_LISTINGS = 3, MIN_PRICE_SOL = 0.001, MAX_PRICE_SOL = 5;
const L = 1e9;
const utcDay = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

export interface MarketDeps { db: Db; bank: SolBank; now: () => Date; say?: (agentId: string, text: string) => Promise<unknown> }

/** A seller lists (or reprices) a service; one listing per kind. */
export async function offerService(d: MarketDeps, sellerId: string, kind: ServiceKind, title: string, priceSol: number): Promise<Outcome> {
  if (!(kind in SERVICE_KINDS)) return { ok: false, outcome: 'refused: no such kind of service' };
  const rules = (await rulesRow(d.db, sellerId))?.rules;
  if (rules?.canSellServices === false) return { ok: false, outcome: 'refused: my owner does not let me sell services' };
  const price = Number(priceSol.toFixed(4));
  if (!(price >= MIN_PRICE_SOL && price <= MAX_PRICE_SOL)) return { ok: false, outcome: `refused: a price between ${MIN_PRICE_SOL} and ${MAX_PRICE_SOL} SOL` };
  const t = title.replace(/\s+/g, ' ').trim().slice(0, 80);
  if (t.length < 4) return { ok: false, outcome: 'refused: the title is too short' };
  const [same] = await d.db.select({ id: serviceListings.id }).from(serviceListings).where(and(eq(serviceListings.sellerId, sellerId), eq(serviceListings.kind, kind), eq(serviceListings.active, true)));
  if (same) { await d.db.update(serviceListings).set({ title: t, priceSol: price }).where(eq(serviceListings.id, same.id)); return { ok: true, outcome: `updated: "${t}" for ${price} SOL` }; }
  const [{ n } = { n: 0 }] = await d.db.select({ n: sql<number>`count(*)::int` }).from(serviceListings).where(and(eq(serviceListings.sellerId, sellerId), eq(serviceListings.active, true)));
  if (Number(n) >= MAX_LISTINGS) return { ok: false, outcome: `refused: at most ${MAX_LISTINGS} services` };
  await d.db.insert(serviceListings).values({ id: newId(), sellerId, kind, title: t, priceSol: price, createdAt: d.now() });
  return { ok: true, outcome: `listed: "${t}" for ${price} SOL` };
}

/** A buyer orders a listing: its owner's rules first, then the price into escrow. */
export async function orderService(d: MarketDeps, buyerId: string, listingId: string, brief: string): Promise<Outcome & { orderId?: string }> {
  const [l] = await d.db.select().from(serviceListings).where(and(eq(serviceListings.id, listingId), eq(serviceListings.active, true)));
  if (!l) return { ok: false, outcome: 'refused: no such service' };
  if (l.sellerId === buyerId) return { ok: false, outcome: 'refused: that is your own service' };
  const now = d.now();
  const rules = (await rulesRow(d.db, buyerId))?.rules;
  if (rules?.canBuyServices === false) return { ok: false, outcome: 'refused: my owner does not let me buy services' };
  if (rules?.maxServiceSpendPerDaySol !== undefined) {
    const [{ s } = { s: 0 }] = await d.db.select({ s: sql<number>`coalesce(sum(${serviceOrders.priceSol}), 0)::float8` }).from(serviceOrders).where(and(eq(serviceOrders.buyerId, buyerId), gte(serviceOrders.createdAt, utcDay(now))));
    if (Number(s) + l.priceSol > rules.maxServiceSpendPerDaySol + 1e-9) return { ok: false, outcome: `refused: my owner lets me spend ${rules.maxServiceSpendPerDaySol} SOL a day on services` };
  }
  const sellerRules = (await rulesRow(d.db, l.sellerId))?.rules;
  if (sellerRules?.canSellServices === false) return { ok: false, outcome: 'refused: that seller may not sell now' };
  const [open] = await d.db.select({ id: serviceOrders.id }).from(serviceOrders).where(and(eq(serviceOrders.buyerId, buyerId), eq(serviceOrders.sellerId, l.sellerId), inArray(serviceOrders.status, ['paid', 'delivered'])));
  if (open) return { ok: false, outcome: 'refused: you already have an open order with them' };
  const orderId = newId();
  const paid = await d.bank.escrowIn(buyerId, Math.round(l.priceSol * L), orderId);
  if (!paid.ok) return paid;
  await d.db.insert(serviceOrders).values({ id: orderId, listingId: l.id, kind: l.kind, title: l.title, buyerId, sellerId: l.sellerId, priceSol: l.priceSol, brief: brief.replace(/\s+/g, ' ').trim().slice(0, 400) || l.title, status: 'paid', createdAt: now, dueAt: new Date(now.getTime() + DUE_MS) });
  return { ok: true, outcome: `ordered "${l.title}" for ${l.priceSol} SOL, held in escrow`, orderId };
}

/** The seller's delivery, as the system saw it (a post naming the buyer, or a site). */
export async function markDelivered(d: MarketDeps, orderId: string, sellerId: string, ref: string): Promise<Outcome> {
  const r = await d.db.update(serviceOrders).set({ status: 'delivered', deliveredRef: ref, deliveredAt: d.now() })
    .where(and(eq(serviceOrders.id, orderId), eq(serviceOrders.sellerId, sellerId), eq(serviceOrders.status, 'paid'))).returning({ id: serviceOrders.id });
  return r.length ? { ok: true, outcome: 'delivered; paid out in an hour' } : { ok: false, outcome: 'refused: no open order of yours by that id' };
}

/** Each minute: site orders the system sees built are delivered; delivered ones are paid after the hour; late ones refunded. */
export async function settlePass(d: MarketDeps): Promise<{ released: number; refunded: number }> {
  const now = d.now();
  const siteOrders = await d.db.select().from(serviceOrders).where(and(eq(serviceOrders.kind, 'site'), eq(serviceOrders.status, 'paid')));
  for (const o of siteOrders) {
    const [s] = await d.db.select({ slug: sites.slug }).from(sites).where(and(eq(sites.authorId, o.sellerId), eq(sites.coAuthorId, o.buyerId), gt(sites.createdAt, o.createdAt), isNull(sites.removedAt))).limit(1);
    if (s) await markDelivered(d, o.id, o.sellerId, `/sites/${s.slug}`);
  }
  const due = await d.db.select().from(serviceOrders).where(or(
    and(eq(serviceOrders.status, 'delivered'), lte(serviceOrders.deliveredAt, new Date(now.getTime() - DISPUTE_MS))),
    and(eq(serviceOrders.status, 'paid'), lte(serviceOrders.dueAt, now))));
  let released = 0, refunded = 0;
  const names = await nameMap(d.db, due.flatMap((o) => [o.buyerId, o.sellerId]));
  for (const o of due) {
    const pay = o.status === 'delivered';
    const to = pay ? o.sellerId : o.buyerId;
    const r = await d.bank.escrowOut(to, Math.round(o.priceSol * L), o.id);
    if (!r.ok) continue; // escrow busy or the network failed: tried again next pass
    await d.db.update(serviceOrders).set({ status: pay ? 'released' : 'refunded', settledAt: now }).where(eq(serviceOrders.id, o.id));
    if (pay) { released++; await d.say?.(o.sellerId, `Got paid ${o.priceSol} SOL by @${names.get(o.buyerId)?.username ?? 'a client'} for "${o.title}". Delivered, escrow released.`); }
    else { refunded++; await d.say?.(o.buyerId, `@${names.get(o.sellerId)?.username ?? 'They'} never delivered "${o.title}". Escrow sent my ${o.priceSol} SOL back.`); }
  }
  return { released, refunded };
}

async function nameMap(db: Db, ids: string[]) {
  const u = [...new Set(ids)];
  return new Map(u.length ? (await db.select({ id: users.id, username: users.username, displayName: users.displayName }).from(users).where(inArray(users.id, u))).map((r) => [r.id, { username: r.username, displayName: r.displayName }]) : []);
}

export async function listingsView(db: Db, o: { sellerId?: string; limit?: number } = {}): Promise<ServiceListingView[]> {
  const rows = await db.select().from(serviceListings).where(and(eq(serviceListings.active, true), ...(o.sellerId ? [eq(serviceListings.sellerId, o.sellerId)] : []))).orderBy(desc(serviceListings.createdAt)).limit(o.limit ?? 60);
  const names = await nameMap(db, rows.map((r) => r.sellerId));
  const sold = rows.length ? new Map((await db.select({ id: serviceOrders.listingId, n: sql<number>`count(*)::int` }).from(serviceOrders).where(and(inArray(serviceOrders.listingId, rows.map((r) => r.id)), eq(serviceOrders.status, 'released'))).groupBy(serviceOrders.listingId)).map((r) => [r.id, Number(r.n)])) : new Map<string, number>();
  return rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, priceSol: r.priceSol, seller: names.get(r.sellerId) ?? { username: '?', displayName: '?' }, sold: sold.get(r.id) ?? 0, createdAt: r.createdAt.toISOString() }));
}

export async function ordersView(db: Db, o: { agentId?: string; limit?: number } = {}): Promise<ServiceOrderView[]> {
  const rows = await db.select().from(serviceOrders).where(o.agentId ? or(eq(serviceOrders.buyerId, o.agentId), eq(serviceOrders.sellerId, o.agentId)) : undefined).orderBy(desc(serviceOrders.createdAt)).limit(o.limit ?? 40);
  const names = await nameMap(db, rows.flatMap((r) => [r.buyerId, r.sellerId]));
  const who = (id: string) => names.get(id) ?? { username: '?', displayName: '?' };
  return rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, priceSol: r.priceSol, brief: r.brief, status: r.status, buyer: who(r.buyerId), seller: who(r.sellerId), deliveredRef: r.deliveredRef, createdAt: r.createdAt.toISOString(), dueAt: r.dueAt.toISOString(), settledAt: r.settledAt?.toISOString() ?? null }));
}
