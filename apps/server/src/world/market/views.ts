import { and, asc, desc, eq, gt, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { MarketCategory, MarketDealView, MarketOfferView, SellerReputation } from '@shillex/shared';
import type { Db } from '../../db/client.ts';
import { marketDeals, marketEvents, marketOffers, users } from '../../db/schema.ts';
import { userSummaries } from '../../services/hydrate.ts';
import type { DealRow, OfferRow } from './deals.ts';

/** What the marketplace pages and the agents read (2026-10-28 brief §6): offers with their seller's record, deals with their history. */
export async function reputations(db: Db, sellerIds: string[]): Promise<Map<string, SellerReputation>> {
  const ids = [...new Set(sellerIds)];
  if (!ids.length) return new Map();
  const rows = await db.select({
    id: marketDeals.sellerId,
    completed: sql<number>`count(*) filter (where ${marketDeals.status} = 'released')::int`,
    disputed: sql<number>`count(*) filter (where exists (select 1 from ${marketEvents} e where e.deal_id = ${marketDeals.id} and e.kind = 'disputed'))::int`,
    refunded: sql<number>`count(*) filter (where ${marketDeals.status} = 'refunded')::int`,
    volume: sql<number>`coalesce(sum(${marketDeals.priceAmount}) filter (where ${marketDeals.status} = 'released' and ${marketDeals.currency} = 'SOL'), 0)::float8`,
    hours: sql<number | null>`avg(extract(epoch from (${marketDeals.deliveredAt} - ${marketDeals.createdAt})) / 3600) filter (where ${marketDeals.deliveredAt} is not null)`,
  }).from(marketDeals).where(inArray(marketDeals.sellerId, ids)).groupBy(marketDeals.sellerId);
  const offers = await db.select({ id: marketOffers.sellerId, n: sql<number>`count(*)::int` }).from(marketOffers).where(and(inArray(marketOffers.sellerId, ids), eq(marketOffers.status, 'open'))).groupBy(marketOffers.sellerId);
  const open = new Map(offers.map((o) => [o.id, o.n]));
  const by = new Map(rows.map((r) => [r.id, r]));
  return new Map(ids.map((id) => {
    const r = by.get(id);
    return [id, { completed: r?.completed ?? 0, disputed: r?.disputed ?? 0, refunded: r?.refunded ?? 0, volumeSol: Number(r?.volume ?? 0), openOffers: open.get(id) ?? 0, avgDeliveryHours: r?.hours == null ? null : Math.round(Number(r.hours) * 10) / 10 }];
  }));
}

export async function offerViews(db: Db, rows: OfferRow[]): Promise<MarketOfferView[]> {
  if (!rows.length) return [];
  const people = await userSummaries(db, rows.map((r) => r.sellerId));
  const reps = await reputations(db, rows.map((r) => r.sellerId));
  const counts = await db.select({ id: marketDeals.offerId, open: sql<number>`count(*) filter (where ${marketDeals.status} in ('negotiating', 'escrowing', 'escrowed', 'delivered', 'disputed'))::int`, done: sql<number>`count(*) filter (where ${marketDeals.status} = 'released')::int` })
    .from(marketDeals).where(inArray(marketDeals.offerId, rows.map((r) => r.id))).groupBy(marketDeals.offerId);
  const c = new Map(counts.map((x) => [x.id, x]));
  return rows.flatMap((o) => {
    const seller = people.get(o.sellerId);
    if (!seller) return [];
    return [{
      id: o.id, seller, reputation: reps.get(o.sellerId)!, title: o.title, category: o.category as MarketCategory, description: o.description, price: o.priceAmount, currency: o.currency,
      currencySymbol: o.currencySymbol, deliverables: o.deliverables, deadlineHours: o.deadlineHours, quantity: o.quantity, quantityLeft: o.quantityLeft, expiresAt: o.expiresAt.toISOString(),
      images: o.images, status: o.status, createdAt: o.createdAt.toISOString(), deals: { open: c.get(o.id)?.open ?? 0, done: c.get(o.id)?.done ?? 0 },
    }];
  });
}

export async function dealViews(db: Db, rows: DealRow[]): Promise<MarketDealView[]> {
  if (!rows.length) return [];
  const evs = await db.select().from(marketEvents).where(inArray(marketEvents.dealId, rows.map((r) => r.id))).orderBy(asc(marketEvents.at));
  const titles = new Map((await db.select({ id: marketOffers.id, t: marketOffers.title }).from(marketOffers).where(inArray(marketOffers.id, [...new Set(rows.map((r) => r.offerId))]))).map((o) => [o.id, o.t]));
  const people = await userSummaries(db, [...rows.flatMap((r) => [r.buyerId, r.sellerId]), ...evs.flatMap((e) => (e.actorId ? [e.actorId] : []))]);
  return rows.flatMap((d) => {
    const buyer = people.get(d.buyerId), seller = people.get(d.sellerId);
    if (!buyer || !seller) return [];
    return [{
      id: d.id, offerId: d.offerId, offerTitle: titles.get(d.offerId) ?? '', buyer, seller, quantity: d.quantity, price: d.priceAmount, currency: d.currency, currencySymbol: d.currencySymbol,
      status: d.status, turnOf: d.turnOf, dueAt: d.dueAt?.toISOString() ?? null, deliveredAt: d.deliveredAt?.toISOString() ?? null, deliveryNote: d.deliveryNote, deliveryRef: d.deliveryRef,
      disputeReason: d.disputeReason, createdAt: d.createdAt.toISOString(), updatedAt: d.updatedAt.toISOString(), settledAt: d.settledAt?.toISOString() ?? null,
      events: evs.filter((e) => e.dealId === d.id).map((e) => ({ kind: e.kind, actor: e.actorId ? people.get(e.actorId) ?? null : null, price: e.priceAmount, note: e.note, sig: e.sig, at: e.at.toISOString() })),
    }];
  });
}

export interface OfferQuery { q?: string; category?: string; currency?: string; sort?: string; seller?: string; status?: string; limit?: number }

/** Offers for the browse page and the agents: search, category, SOL or coin prices, sorted; open ones unless asked otherwise. */
export async function listOffers(db: Db, q: OfferQuery, now: Date): Promise<MarketOfferView[]> {
  const where: SQL[] = [];
  if (q.status !== 'all') where.push(eq(marketOffers.status, 'open'), gt(marketOffers.expiresAt, now));
  if (q.category) where.push(eq(marketOffers.category, q.category));
  if (q.currency === 'SOL') where.push(eq(marketOffers.currency, 'SOL'));
  else if (q.currency === 'coin') where.push(sql`${marketOffers.currency} <> 'SOL'`);
  if (q.seller) {
    const [u] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.username}) = ${q.seller.replace(/^@/, '').toLowerCase()}`);
    if (!u) return [];
    where.push(eq(marketOffers.sellerId, u.id));
  }
  const term = q.q?.trim().slice(0, 80);
  if (term) where.push(or(ilike(marketOffers.title, `%${term.replace(/[%_\\]/g, '')}%`), ilike(marketOffers.description, `%${term.replace(/[%_\\]/g, '')}%`))!);
  const popular = sql`(select count(*) from ${marketDeals} d where d.offer_id = ${marketOffers.id})`;
  const order = q.sort === 'price_asc' ? [asc(marketOffers.priceAmount)] : q.sort === 'price_desc' ? [desc(marketOffers.priceAmount)] : q.sort === 'popular' ? [desc(popular), desc(marketOffers.createdAt)] : [desc(marketOffers.createdAt)];
  const rows = await db.select().from(marketOffers).where(where.length ? and(...where) : undefined).orderBy(...order).limit(Math.min(100, Math.max(1, q.limit ?? 60)));
  return offerViews(db, rows);
}
