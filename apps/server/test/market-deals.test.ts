import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDb } from './helpers.ts';
import { loadConfig } from '../src/config.ts';
import { agents, marketDeals, marketEvents, marketOffers, users, worldCoins } from '../src/db/schema.ts';
import { MemoryChain } from '../src/world/chain.ts';
import { TREASURY, createWallet, signerFor } from '../src/world/wallets.ts';
import { accept, confirm, counter, createOffer, deliver, dispute, propose, resolve, sweep, type MarketDeps } from '../src/world/market/deals.ts';
import { ESCROW_ID } from '../src/world/market/escrow.ts';

/**
 * The marketplace (2026-10-28 brief §6): offer → counteroffer → accept → escrow holds the payment → delivered → released, or
 * disputed and resolved, or refunded when nothing is delivered in time. Money moves exactly once at each step.
 */
const KEY = Buffer.alloc(32, 9);
const SOL = 1e9;
async function world() {
  const { db } = await testDb();
  const chain = new MemoryChain();
  let t = new Date('2026-10-28T12:00:00Z').getTime();
  const now = () => new Date(t);
  const d: MarketDeps = { db, chain, key: KEY, config: loadConfig({ NODE_ENV: 'test' }), now };
  chain.airdrop(await createWallet(db, TREASURY, KEY, now()), 5 * SOL);
  const mk = async (id: string, lamports: number) => {
    await db.insert(users).values({ id, username: id, displayName: id, kind: 'agent', createdAt: now() });
    await db.insert(agents).values({ userId: id, origin: 'external', status: 'active', createdAt: now() });
    const pk = await createWallet(db, id, KEY, now());
    chain.airdrop(pk, lamports);
    return pk;
  };
  const sellerPk = await mk('seller', 0.1 * SOL), buyerPk = await mk('buyer', 0.1 * SOL);
  const bal = async (pk: string) => (await chain.balances(pk)).lamports;
  return { db, chain, d, sellerPk, buyerPk, bal, advance: (ms: number) => { t += ms; } };
}
const offerIn = { title: 'A site for your coin', category: 'site', description: 'One page, built by me, live in a day.', price: 0.02, deliverables: 'a live page on Shillex', deadlineHours: 24, quantity: 1 };

describe('market deals', () => {
  it('negotiates, then escrows the agreed price exactly once, then pays the seller on confirm', async () => {
    const w = await world();
    const offer = await createOffer(w.d, 'seller', offerIn);
    const deal = await propose(w.d, 'buyer', offer.id, { price: 0.015, note: 'can you do 0.015?' });
    expect(deal).toMatchObject({ status: 'negotiating', turnOf: 'seller', priceAmount: 0.015 });
    await expect(accept(w.d, 'buyer', deal.id)).rejects.toMatchObject({ code: 'NOT_YOUR_TURN' });
    const c = await counter(w.d, 'seller', deal.id, { price: 0.018 });
    expect(c).toMatchObject({ turnOf: 'buyer', priceAmount: 0.018 });
    const before = await w.bal(w.buyerPk);
    const results = await Promise.allSettled([accept(w.d, 'buyer', deal.id), accept(w.d, 'buyer', deal.id)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(before - (await w.bal(w.buyerPk))).toBeGreaterThanOrEqual(0.018 * SOL);
    expect(before - (await w.bal(w.buyerPk))).toBeLessThan(0.0181 * SOL);
    const [o] = await w.db.select().from(marketOffers).where(eq(marketOffers.id, offer.id));
    expect(o).toMatchObject({ quantityLeft: 0, status: 'closed' });
    await expect(propose(w.d, 'buyer', offer.id, {})).rejects.toMatchObject({ code: 'OFFER_CLOSED' });
    const sellerBefore = await w.bal(w.sellerPk);
    await deliver(w.d, 'seller', deal.id, { note: 'built it', ref: 'site:coin-page' });
    const done = await confirm(w.d, 'buyer', deal.id);
    expect(done.status).toBe('released');
    expect((await w.bal(w.sellerPk)) - sellerBefore).toBe(0.018 * SOL);
    const kinds = (await w.db.select().from(marketEvents).where(eq(marketEvents.dealId, deal.id))).map((e) => e.kind);
    expect(kinds).toEqual(['proposed', 'countered', 'accepted', 'delivered', 'released']);
  });

  it('refunds the buyer when nothing is delivered in time, and refuses a late delivery', async () => {
    const w = await world();
    const offer = await createOffer(w.d, 'seller', { ...offerIn, deadlineHours: 1 });
    const deal = await propose(w.d, 'buyer', offer.id, {});
    await accept(w.d, 'seller', deal.id);
    const held = await w.bal(w.buyerPk);
    w.advance(61 * 60_000);
    await expect(deliver(w.d, 'seller', deal.id, { note: 'sorry, late' })).rejects.toMatchObject({ code: 'LATE' });
    expect((await sweep(w.d)).refunded).toBe(1);
    expect((await w.bal(w.buyerPk)) - held).toBe(0.02 * SOL);
    const [row] = await w.db.select().from(marketDeals).where(eq(marketDeals.id, deal.id));
    expect(row!.status).toBe('refunded');
    expect((await sweep(w.d)).refunded).toBe(0);
  });

  it('holds a disputed payment until an admin resolves it, and releases an undisputed delivery after a day', async () => {
    const w = await world();
    const o1 = await createOffer(w.d, 'seller', { ...offerIn, quantity: 2 });
    const a = await propose(w.d, 'buyer', o1.id, {});
    await accept(w.d, 'seller', a.id);
    await deliver(w.d, 'seller', a.id, { note: 'here it is' });
    await dispute(w.d, 'buyer', a.id, 'the page is empty');
    const b = await propose(w.d, 'buyer', o1.id, {});
    await accept(w.d, 'seller', b.id);
    await deliver(w.d, 'seller', b.id, { note: 'second one' });
    w.advance(25 * 3_600_000);
    const s = await sweep(w.d);
    expect(s.released).toBe(1);
    const [disputed] = await w.db.select().from(marketDeals).where(eq(marketDeals.id, a.id));
    expect(disputed!.status).toBe('disputed');
    const held = await w.bal(w.buyerPk);
    expect((await resolve(w.d, 'admin', a.id, 'buyer')).status).toBe('refunded');
    expect((await w.bal(w.buyerPk)) - held).toBe(0.02 * SOL);
  });

  it('can be priced in a Shillex coin: the tokens go through escrow too', async () => {
    const w = await world();
    const seller = await signerFor(w.db, 'seller', KEY), buyer = await signerFor(w.db, 'buyer', KEY);
    const { mint, pool, signature } = await w.chain.launch(seller, { name: 'Tide', symbol: 'TIDE', uri: '', initialBuyLamports: 0 });
    await w.db.insert(worldCoins).values({ mint, pool, creatorId: 'seller', name: 'Tide', symbol: 'TIDE', launchSignature: signature, launchedAt: new Date('2026-10-28T12:00:00Z') });
    await w.chain.buy(buyer, mint, 0.01 * SOL, 500);
    const tokensOf = async (pk: string) => (await w.chain.balances(pk)).tokens.find((t) => t.mint === mint)?.raw ?? 0;
    const have = await tokensOf(w.buyerPk);
    const offer = await createOffer(w.d, 'seller', { ...offerIn, price: 1000, currency: mint });
    const deal = await propose(w.d, 'buyer', offer.id, {});
    await accept(w.d, 'seller', deal.id);
    expect(have - (await tokensOf(w.buyerPk))).toBe(1000 * 1e6);
    await deliver(w.d, 'seller', deal.id, { note: 'done' });
    await confirm(w.d, 'buyer', deal.id);
    expect(await tokensOf(w.sellerPk)).toBe(1000 * 1e6);
  });

  it('refuses a buyer with too little SOL and leaves the deal open', async () => {
    const w = await world();
    const offer = await createOffer(w.d, 'seller', { ...offerIn, price: 5 });
    const deal = await propose(w.d, 'buyer', offer.id, {});
    await expect(accept(w.d, 'seller', deal.id)).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
    const [row] = await w.db.select().from(marketDeals).where(eq(marketDeals.id, deal.id));
    expect(row).toMatchObject({ status: 'negotiating', turnOf: 'seller' });
    expect(ESCROW_ID).toBe('market_escrow');
  });
});
