import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDb } from './helpers.ts';
import { loadConfig } from '../src/config.ts';
import { agents, marketDeals, solTrades, users } from '../src/db/schema.ts';
import { newId } from '../src/lib/ids.ts';
import { MemoryChain } from '../src/world/chain.ts';
import { accept, confirm, createOffer, deliver, propose, sweep, type MarketDeps } from '../src/world/market/deals.ts';
import type { SolBank } from '../src/world/sol-trade.ts';

/**
 * The marketplace on mainnet (owner, 2026-10-29): the price is real SOL, held by the vault's escrow wallet through the real-SOL
 * bank, paid out once; a deal held in devnet test SOL before mainnet is never paid from real SOL.
 */
function fakeBank(db: MarketDeps['db'], now: () => Date) {
  const calls: string[] = [];
  const log = (agentId: string, kind: 'escrow_in' | 'escrow_out', lamports: number, orderId: string) =>
    db.insert(solTrades).values({ id: newId(), agentId, kind, sol: lamports / 1e9, by: 'market', orderId, sig: `sig-${kind}-${calls.length}`, ok: true, at: now() });
  const bank = {
    async escrowIn(agentId: string, lamports: number, orderId: string) { calls.push(`in ${agentId} ${lamports}`); await log(agentId, 'escrow_in', lamports, orderId); return { ok: true, outcome: 'paid into escrow', sig: `sig-in-${orderId}` }; },
    async escrowOut(agentId: string, lamports: number, orderId: string) { calls.push(`out ${agentId} ${lamports}`); await log(agentId, 'escrow_out', lamports, orderId); return { ok: true, outcome: 'paid out of escrow', sig: `sig-out-${orderId}` }; },
  } as unknown as SolBank;
  return { bank, calls };
}

async function setup() {
  const { db } = await testDb();
  let t = new Date('2026-10-29T12:00:00Z');
  const now = () => t;
  for (const [id, username] of [['s1', 'seller'], ['b1', 'buyer']] as const) {
    await db.insert(users).values({ id, username, displayName: username, kind: 'agent', createdAt: t });
    await db.insert(agents).values({ userId: id, origin: 'wild', status: 'active', createdAt: t });
  }
  const config = { ...loadConfig({ NODE_ENV: 'test' }), solanaNetwork: 'mainnet' as const };
  const { bank, calls } = fakeBank(db, now);
  const d: MarketDeps = { db, chain: new MemoryChain(), key: Buffer.alloc(32, 1), config, now, bank };
  return { d, db, calls, later: (ms: number) => { t = new Date(t.getTime() + ms); } };
}

describe('the marketplace on mainnet', () => {
  it('holds real SOL from the buyer and pays the seller once, on confirm', async () => {
    const { d, db, calls } = await setup();
    await expect(createOffer(d, 's1', { title: 'A coin read', category: 'analysis', description: 'One page on a coin you name.', deliverables: 'a post', price: 5, currency: 'So1anaCoinMint11111111111111111111111111111', deadlineHours: 24 })).rejects.toMatchObject({ code: 'SOL_ONLY' });
    const o = await createOffer(d, 's1', { title: 'A coin read', category: 'analysis', description: 'One page on a coin you name.', deliverables: 'a post', price: 0.05, deadlineHours: 24 });
    const deal = await propose(d, 'b1', o.id, {});
    expect((await accept(d, 's1', deal.id)).status).toBe('escrowed');
    expect(calls).toEqual(['in b1 50000000']);
    await deliver(d, 's1', deal.id, { note: 'Done: the read is up.' });
    expect((await confirm(d, 'b1', deal.id)).status).toBe('released');
    expect(calls).toEqual(['in b1 50000000', 'out s1 50000000']);
  });

  it('never pays a deal held in devnet test SOL from real SOL: the deal just ends', async () => {
    const { d, db, calls, later } = await setup();
    const o = await createOffer(d, 's1', { title: 'Old', category: 'other', description: 'From the devnet days.', deliverables: 'a post', price: 0.5, deadlineHours: 1 });
    // Escrowed on devnet before the switch: no real escrow_in exists for it.
    const [old] = await db.insert(marketDeals).values({ id: newId(), offerId: o.id, buyerId: 'b1', sellerId: 's1', quantity: 1, priceAmount: 0.5, currency: 'SOL', currencySymbol: 'SOL', status: 'escrowed', dueAt: d.now(), createdAt: d.now(), updatedAt: d.now() }).returning();
    later(60_000);
    await sweep(d);
    expect(calls).toEqual([]);
    expect((await db.select().from(marketDeals).where(eq(marketDeals.id, old!.id)))[0]!.status).toBe('cancelled');
  });
});
