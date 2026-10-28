import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { marketDeals, marketEvents, marketOffers, worldCoins, type MarketDealStatus } from '../../db/schema.ts';
import { AppError, errors } from '../../lib/errors.ts';
import { newId } from '../../lib/ids.ts';
import { hold, isSol, payOut, type EscrowDeps } from './escrow.ts';

/**
 * Deals (2026-10-28 brief §6). A buyer proposes on an offer (at the list price or another); the two counter in turn; whoever's
 * turn it is accepts, and the price moves from the buyer's wallet to the escrow, exactly once (the deal is claimed by one
 * conditional update before any money moves, and put back if the transfer fails). The seller delivers before the deadline;
 * the buyer confirms (paid out now) or disputes (held for an admin); an undisputed delivery is paid out after DISPUTE_MS. Past
 * the deadline with nothing delivered, the buyer is refunded. Negotiations idle for IDLE_MS lapse; offers lapse at expiry.
 */
export type MarketDeps = EscrowDeps;
export const CATEGORIES = ['site', 'art', 'shill', 'analysis', 'alpha', 'code', 'other'] as const;
export type MarketCategory = (typeof CATEGORIES)[number];
export const DISPUTE_MS = 24 * 3_600_000, IDLE_MS = 48 * 3_600_000;
export const LIMITS = { title: 80, description: 600, deliverables: 240, note: 280, minSol: 0.001, maxSol: 10, maxHours: 24 * 14, maxQuantity: 100 };

export type OfferRow = typeof marketOffers.$inferSelect;
export type DealRow = typeof marketDeals.$inferSelect;
export interface OfferInput { title: string; category: string; description: string; price: number; currency?: string; deliverables: string; deadlineHours: number; quantity?: number; expiresInHours?: number; images?: string[] }

const bad = (code: string, message: string) => errors.badRequest(code, message);
const clip = (s: unknown, max: number, code: string, what: string) => {
  const v = typeof s === 'string' ? s.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim() : '';
  if (!v) throw bad(code, `${what} is required`);
  return v.slice(0, max);
};

async function event(db: Db, dealId: string, actorId: string | null, kind: string, at: Date, o: { price?: number; note?: string | null; sig?: string | null } = {}) {
  await db.insert(marketEvents).values({ id: newId(), dealId, actorId, kind, priceAmount: o.price ?? null, note: o.note ?? null, sig: o.sig ?? null, at });
}
async function dealOf(db: Db, id: string): Promise<DealRow> {
  const [d] = await db.select().from(marketDeals).where(eq(marketDeals.id, id));
  if (!d) throw errors.notFound('Deal');
  return d;
}
const sideOf = (d: DealRow, actorId: string): 'buyer' | 'seller' => {
  if (actorId === d.buyerId) return 'buyer';
  if (actorId === d.sellerId) return 'seller';
  throw errors.forbidden('NOT_PARTY', 'Only the buyer or the seller can do that');
};
/** Moves a deal from one of `from` to `to` only if it is still there; null when someone else moved it first. */
async function move(db: Db, id: string, from: MarketDealStatus[], set: Partial<DealRow> & { status: MarketDealStatus }): Promise<DealRow | null> {
  const [r] = await db.update(marketDeals).set(set).where(and(eq(marketDeals.id, id), inArray(marketDeals.status, from))).returning();
  return r ?? null;
}
const stuck = (d: DealRow, what: string) => new AppError(409, 'BAD_STATE', `This deal is ${d.status}: it can't be ${what} now`);

/** A seller lists something: priced in SOL (0.001 to 10) or in whole tokens of a Shillex coin. */
export async function createOffer(d: MarketDeps, sellerId: string, i: OfferInput): Promise<OfferRow> {
  const category = CATEGORIES.includes(i.category as MarketCategory) ? i.category : null;
  if (!category) throw bad('BAD_CATEGORY', `category is one of ${CATEGORIES.join(', ')}`);
  const currency = !i.currency || i.currency.toUpperCase() === 'SOL' ? 'SOL' : i.currency.trim();
  let symbol = 'SOL';
  if (!isSol(currency)) {
    const [c] = await d.db.select({ symbol: worldCoins.symbol }).from(worldCoins).where(eq(worldCoins.mint, currency));
    if (!c) throw bad('UNKNOWN_MINT', 'Price it in SOL or in a coin launched on Shillex (its mint)');
    symbol = c.symbol;
  }
  const price = Number(i.price);
  if (!Number.isFinite(price) || price <= 0 || (isSol(currency) && (price < LIMITS.minSol || price > LIMITS.maxSol))) throw bad('BAD_PRICE', isSol(currency) ? `A SOL price is ${LIMITS.minSol} to ${LIMITS.maxSol}` : 'A price is a positive number of tokens');
  const hours = Math.floor(Number(i.deadlineHours));
  if (!(hours >= 1 && hours <= LIMITS.maxHours)) throw bad('BAD_DEADLINE', `deadline_hours is 1 to ${LIMITS.maxHours}`);
  const quantity = Math.floor(Number(i.quantity ?? 1));
  if (!(quantity >= 1 && quantity <= LIMITS.maxQuantity)) throw bad('BAD_QUANTITY', `quantity is 1 to ${LIMITS.maxQuantity}`);
  const expiresIn = Math.min(LIMITS.maxHours, Math.max(1, Math.floor(Number(i.expiresInHours ?? 24 * 7))));
  const [open] = await d.db.select({ n: sql<number>`count(*)::int` }).from(marketOffers).where(and(eq(marketOffers.sellerId, sellerId), eq(marketOffers.status, 'open')));
  if ((open?.n ?? 0) >= 10) throw errors.conflict('TOO_MANY_OFFERS', 'At most 10 open offers at once: close one first');
  const now = d.now();
  const [row] = await d.db.insert(marketOffers).values({
    id: newId(), sellerId, title: clip(i.title, LIMITS.title, 'BAD_TITLE', 'title'), category, description: clip(i.description, LIMITS.description, 'BAD_DESCRIPTION', 'description'),
    priceAmount: price, currency, currencySymbol: symbol, deliverables: clip(i.deliverables, LIMITS.deliverables, 'BAD_DELIVERABLES', 'deliverables'),
    deadlineHours: hours, quantity, quantityLeft: quantity, expiresAt: new Date(now.getTime() + expiresIn * 3_600_000),
    images: (i.images ?? []).filter((u) => /^\/api\/blobs\/[A-Za-z0-9]+$/.test(u)).slice(0, 4), status: 'open', createdAt: now,
  }).returning();
  return row!;
}

/** The seller closes an offer: no new deals; deals already under way go on. */
export async function closeOffer(d: MarketDeps, sellerId: string, offerId: string): Promise<OfferRow> {
  const [o] = await d.db.update(marketOffers).set({ status: 'closed' }).where(and(eq(marketOffers.id, offerId), eq(marketOffers.sellerId, sellerId))).returning();
  if (!o) throw errors.notFound('Offer');
  return o;
}

/** A buyer opens a deal: at the list price (quantity × price) unless it names its own total. The seller answers. */
export async function propose(d: MarketDeps, buyerId: string, offerId: string, i: { quantity?: number; price?: number; note?: string }): Promise<DealRow> {
  const [o] = await d.db.select().from(marketOffers).where(eq(marketOffers.id, offerId));
  if (!o) throw errors.notFound('Offer');
  const now = d.now();
  if (o.status !== 'open' || o.quantityLeft <= 0 || o.expiresAt <= now) throw errors.conflict('OFFER_CLOSED', 'This offer is closed');
  if (o.sellerId === buyerId) throw errors.badRequest('OWN_OFFER', 'You can’t buy your own offer');
  const quantity = Math.floor(Number(i.quantity ?? 1));
  if (!(quantity >= 1 && quantity <= o.quantityLeft)) throw bad('BAD_QUANTITY', `quantity is 1 to ${o.quantityLeft}`);
  const list = o.priceAmount * quantity;
  const price = i.price === undefined || i.price === null ? list : Number(i.price);
  if (!Number.isFinite(price) || price <= 0) throw bad('BAD_PRICE', 'price is the whole price you offer, a positive number');
  const [open] = await d.db.select({ n: sql<number>`count(*)::int` }).from(marketDeals).where(and(eq(marketDeals.offerId, offerId), eq(marketDeals.buyerId, buyerId), eq(marketDeals.status, 'negotiating')));
  if ((open?.n ?? 0) > 0) throw errors.conflict('DEAL_OPEN', 'You already have a deal open on this offer');
  const [row] = await d.db.insert(marketDeals).values({
    id: newId(), offerId, buyerId, sellerId: o.sellerId, quantity, priceAmount: price, currency: o.currency, currencySymbol: o.currencySymbol,
    status: 'negotiating', turnOf: 'seller', createdAt: now, updatedAt: now,
  }).returning();
  await event(d.db, row!.id, buyerId, 'proposed', now, { price, note: i.note ? clip(i.note, LIMITS.note, 'BAD_NOTE', 'note') : null });
  return row!;
}

/** The side whose turn it is names another price; the turn passes. */
export async function counter(d: MarketDeps, actorId: string, dealId: string, i: { price: number; note?: string }): Promise<DealRow> {
  const deal = await dealOf(d.db, dealId), side = sideOf(deal, actorId);
  if (deal.status !== 'negotiating') throw stuck(deal, 'countered');
  if (deal.turnOf !== side) throw errors.conflict('NOT_YOUR_TURN', 'Wait for the other side to answer');
  const price = Number(i.price);
  if (!Number.isFinite(price) || price <= 0) throw bad('BAD_PRICE', 'price is the whole price, a positive number');
  const now = d.now();
  const r = await d.db.update(marketDeals).set({ priceAmount: price, turnOf: side === 'buyer' ? 'seller' : 'buyer', updatedAt: now })
    .where(and(eq(marketDeals.id, dealId), eq(marketDeals.status, 'negotiating'), eq(marketDeals.turnOf, side))).returning();
  if (!r[0]) throw errors.conflict('NOT_YOUR_TURN', 'The deal moved meanwhile: read it again');
  await event(d.db, dealId, actorId, 'countered', now, { price, note: i.note ? clip(i.note, LIMITS.note, 'BAD_NOTE', 'note') : null });
  return r[0];
}

/**
 * The side whose turn it is accepts the price on the table: the deal is claimed, the price moves into escrow, the offer's
 * quantity goes down, the deadline starts. A failed transfer puts the deal back as it was.
 */
export async function accept(d: MarketDeps, actorId: string, dealId: string): Promise<DealRow> {
  const deal = await dealOf(d.db, dealId), side = sideOf(deal, actorId);
  if (deal.status !== 'negotiating') throw stuck(deal, 'accepted');
  if (deal.turnOf !== side) throw errors.conflict('NOT_YOUR_TURN', 'Wait for the other side to answer');
  const now = d.now();
  const claimed = await d.db.update(marketDeals).set({ status: 'escrowing', updatedAt: now })
    .where(and(eq(marketDeals.id, dealId), eq(marketDeals.status, 'negotiating'), eq(marketDeals.turnOf, side))).returning();
  if (!claimed[0]) throw errors.conflict('NOT_YOUR_TURN', 'The deal moved meanwhile: read it again');
  // The offer's stock is taken first, under its own condition, so two deals can't both take the last one.
  const took = await d.db.update(marketOffers).set({ quantityLeft: sql`${marketOffers.quantityLeft} - ${deal.quantity}` })
    .where(and(eq(marketOffers.id, deal.offerId), sql`${marketOffers.quantityLeft} >= ${deal.quantity}`)).returning({ left: marketOffers.quantityLeft });
  if (!took[0]) {
    await d.db.update(marketDeals).set({ status: 'cancelled', turnOf: null, updatedAt: now }).where(eq(marketDeals.id, dealId));
    await event(d.db, dealId, null, 'cancelled', now, { note: 'sold out' });
    throw errors.conflict('OFFER_CLOSED', 'This offer sold out');
  }
  let sig: string;
  try {
    sig = await hold(d, deal.buyerId, { currency: deal.currency, amount: deal.priceAmount });
  } catch (e) {
    await d.db.update(marketOffers).set({ quantityLeft: sql`${marketOffers.quantityLeft} + ${deal.quantity}` }).where(eq(marketOffers.id, deal.offerId));
    await d.db.update(marketDeals).set({ status: 'negotiating', updatedAt: d.now() }).where(eq(marketDeals.id, dealId));
    throw e;
  }
  if (took[0].left <= 0) await d.db.update(marketOffers).set({ status: 'closed' }).where(eq(marketOffers.id, deal.offerId));
  const [o] = await d.db.select({ hours: marketOffers.deadlineHours }).from(marketOffers).where(eq(marketOffers.id, deal.offerId));
  const [r] = await d.db.update(marketDeals).set({ status: 'escrowed', turnOf: null, escrowSig: sig, dueAt: new Date(now.getTime() + (o?.hours ?? 24) * 3_600_000), updatedAt: d.now() })
    .where(eq(marketDeals.id, dealId)).returning();
  await event(d.db, dealId, actorId, 'accepted', now, { price: deal.priceAmount, sig });
  return r!;
}

/** The seller says it is delivered, before the deadline, with a note and what it points to (a post id, a site, a coin). */
export async function deliver(d: MarketDeps, sellerId: string, dealId: string, i: { note: string; ref?: string }): Promise<DealRow> {
  const deal = await dealOf(d.db, dealId);
  if (sideOf(deal, sellerId) !== 'seller') throw errors.forbidden('NOT_SELLER', 'Only the seller delivers');
  if (deal.status !== 'escrowed') throw stuck(deal, 'delivered');
  const now = d.now();
  if (deal.dueAt && deal.dueAt <= now) throw errors.conflict('LATE', 'The deadline passed: the buyer is being refunded');
  const note = clip(i.note, LIMITS.note, 'BAD_NOTE', 'note');
  const r = await move(d.db, dealId, ['escrowed'], { status: 'delivered', deliveredAt: now, deliveryNote: note, deliveryRef: typeof i.ref === 'string' ? i.ref.slice(0, 120) : null, updatedAt: now });
  if (!r) throw stuck(await dealOf(d.db, dealId), 'delivered');
  await event(d.db, dealId, sellerId, 'delivered', now, { note });
  return r;
}

async function settle(d: MarketDeps, deal: DealRow, to: 'seller' | 'buyer', from: MarketDealStatus[], actorId: string | null, kind: string, note?: string): Promise<DealRow | null> {
  const now = d.now();
  // Claimed first: only one settlement ever pays.
  const claimed = await move(d.db, deal.id, from, { status: 'escrowing', updatedAt: now });
  if (!claimed) return null;
  let sig: string;
  try { sig = await payOut(d, to === 'seller' ? deal.sellerId : deal.buyerId, { currency: deal.currency, amount: deal.priceAmount }); }
  catch (e) { await d.db.update(marketDeals).set({ status: deal.status, updatedAt: d.now() }).where(eq(marketDeals.id, deal.id)); throw e; }
  const status: MarketDealStatus = to === 'seller' ? 'released' : 'refunded';
  const [r] = await d.db.update(marketDeals).set({ status, payoutSig: sig, settledAt: now, updatedAt: now }).where(eq(marketDeals.id, deal.id)).returning();
  await event(d.db, deal.id, actorId, kind, now, { price: deal.priceAmount, note: note ?? null, sig });
  return r!;
}

/** The buyer is happy: the seller is paid now. */
export async function confirm(d: MarketDeps, buyerId: string, dealId: string): Promise<DealRow> {
  const deal = await dealOf(d.db, dealId);
  if (sideOf(deal, buyerId) !== 'buyer') throw errors.forbidden('NOT_BUYER', 'Only the buyer confirms');
  if (deal.status !== 'delivered') throw stuck(deal, 'confirmed');
  const r = await settle(d, deal, 'seller', ['delivered'], buyerId, 'released', 'confirmed by the buyer');
  if (!r) throw stuck(await dealOf(d.db, dealId), 'confirmed');
  return r;
}

/** The buyer disputes a delivery within a day of it (or an escrowed deal past its deadline): the money waits for an admin. */
export async function dispute(d: MarketDeps, buyerId: string, dealId: string, reason: string): Promise<DealRow> {
  const deal = await dealOf(d.db, dealId);
  if (sideOf(deal, buyerId) !== 'buyer') throw errors.forbidden('NOT_BUYER', 'Only the buyer disputes');
  if (deal.status !== 'delivered') throw stuck(deal, 'disputed');
  const now = d.now();
  if (deal.deliveredAt && now.getTime() - deal.deliveredAt.getTime() > DISPUTE_MS) throw errors.conflict('TOO_LATE_TO_DISPUTE', 'Disputes are open for a day after delivery');
  const why = clip(reason, LIMITS.note, 'BAD_REASON', 'reason');
  const r = await move(d.db, dealId, ['delivered'], { status: 'disputed', disputeReason: why, updatedAt: now });
  if (!r) throw stuck(await dealOf(d.db, dealId), 'disputed');
  await event(d.db, dealId, buyerId, 'disputed', now, { note: why });
  return r;
}

/** Either side walks away while negotiating; the seller may also refund an escrowed deal it can't deliver. */
export async function cancel(d: MarketDeps, actorId: string, dealId: string): Promise<DealRow> {
  const deal = await dealOf(d.db, dealId), side = sideOf(deal, actorId), now = d.now();
  if (deal.status === 'negotiating') {
    const r = await move(d.db, dealId, ['negotiating'], { status: 'cancelled', turnOf: null, updatedAt: now });
    if (!r) throw stuck(await dealOf(d.db, dealId), 'cancelled');
    await event(d.db, dealId, actorId, 'cancelled', now);
    return r;
  }
  if (deal.status === 'escrowed' && side === 'seller') {
    const r = await settle(d, deal, 'buyer', ['escrowed'], actorId, 'refunded', 'the seller cancelled');
    if (!r) throw stuck(await dealOf(d.db, dealId), 'cancelled');
    await d.db.update(marketOffers).set({ quantityLeft: sql`${marketOffers.quantityLeft} + ${deal.quantity}` }).where(eq(marketOffers.id, deal.offerId));
    return r;
  }
  throw stuck(deal, 'cancelled');
}

/** An admin settles a dispute: paid to the seller, or back to the buyer. */
export async function resolve(d: MarketDeps, adminId: string, dealId: string, to: 'seller' | 'buyer'): Promise<DealRow> {
  const deal = await dealOf(d.db, dealId);
  if (deal.status !== 'disputed') throw stuck(deal, 'resolved');
  const r = await settle(d, deal, to, ['disputed'], adminId, to === 'seller' ? 'released' : 'refunded', 'resolved by an admin');
  if (!r) throw stuck(await dealOf(d.db, dealId), 'resolved');
  return r;
}

/** Every minute: refunds past their deadline, pays out undisputed deliveries after a day, lapses idle talks and old offers. */
export async function sweep(d: MarketDeps): Promise<{ refunded: number; released: number; expired: number }> {
  const now = d.now(), out = { refunded: 0, released: 0, expired: 0 };
  const late = await d.db.select().from(marketDeals).where(and(eq(marketDeals.status, 'escrowed'), lt(marketDeals.dueAt, now)));
  for (const deal of late) {
    try { if (await settle(d, deal, 'buyer', ['escrowed'], null, 'refunded', 'not delivered by the deadline')) out.refunded++; }
    catch (e) { console.warn('[market] a refund failed; the next sweep tries again', deal.id, (e as Error)?.message); }
  }
  const due = await d.db.select().from(marketDeals).where(and(eq(marketDeals.status, 'delivered'), lt(marketDeals.deliveredAt, new Date(now.getTime() - DISPUTE_MS))));
  for (const deal of due) {
    try { if (await settle(d, deal, 'seller', ['delivered'], null, 'released', 'no dispute within a day')) out.released++; }
    catch (e) { console.warn('[market] a payout failed; the next sweep tries again', deal.id, (e as Error)?.message); }
  }
  const idle = await d.db.update(marketDeals).set({ status: 'cancelled', turnOf: null, updatedAt: now })
    .where(and(eq(marketDeals.status, 'negotiating'), lt(marketDeals.updatedAt, new Date(now.getTime() - IDLE_MS)))).returning({ id: marketDeals.id });
  for (const r of idle) await event(d.db, r.id, null, 'expired', now, { note: 'no answer for two days' });
  const old = await d.db.update(marketOffers).set({ status: 'expired' }).where(and(eq(marketOffers.status, 'open'), lt(marketOffers.expiresAt, now))).returning({ id: marketOffers.id });
  out.expired = idle.length + old.length;
  return out;
}
