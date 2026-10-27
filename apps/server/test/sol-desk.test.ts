import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { Keypair, LAMPORTS_PER_SOL as L, type PublicKey } from '@solana/web3.js';
import { eq } from 'drizzle-orm';
import { testDb } from './helpers.ts';
import { agents, realMarket, realPositions, solPositions, solTrades, solWallets, users } from '../src/db/schema.ts';
import { HOUSE, fundPass, mirror, returnPass, solWallet, trade, type SolDeps, type SolNet } from '../src/world/sol-desk.ts';
import { setSetting } from '../src/world/launchpad.ts';

const key = randomBytes(32);
const config = { mode: 'on' as const, rpcUrl: 'x', agents: 2, perAgentSol: 0.05, maxTradeSol: 0.01, tradesPerDay: 10, returnTo: null };

/** A pretend chain: balances by address; each trade moves `move` lamports (negative = spent), the simulation says `simMove`. */
function fakeNet(o: { move?: number; simMove?: number } = {}) {
  const bal = new Map<string, number>();
  const calls: { body?: Record<string, unknown>; sent: number } = { sent: 0 };
  let last: string | null = null;
  const net: SolNet = {
    async balance(pk: PublicKey) { return bal.get(pk.toBase58()) ?? 0; },
    async quote(body) { calls.body = body; last = String(body.publicKey); return {} as never; },
    async simulate(_tx, pk) { return (bal.get(pk.toBase58()) ?? 0) + (o.simMove ?? o.move ?? 0); },
    async send(tx) {
      calls.sent++;
      if (last && !('instructions' in (tx as object))) bal.set(last, (bal.get(last) ?? 0) + (o.move ?? 0));
      else for (const ix of (tx as { instructions: { keys: { pubkey: PublicKey }[]; data: Buffer }[] }).instructions) {
        const lamports = Number(ix.data.readBigUInt64LE(4));
        const [from, to] = ix.keys.map((k) => k.pubkey.toBase58());
        bal.set(from!, (bal.get(from!) ?? 0) - lamports); bal.set(to!, (bal.get(to!) ?? 0) + lamports);
      }
      return `sig${calls.sent}`;
    },
    async confirm() { return true; },
  };
  return { net, bal, calls, o };
}

async function world(net: SolNet) {
  const h = await testDb();
  const now = new Date('2026-10-27T15:00:00Z');
  for (const id of ['a', 'b']) {
    await h.db.insert(users).values({ id, username: id, displayName: id, kind: 'agent', createdAt: now });
    await h.db.insert(agents).values({ userId: id, status: 'active', origin: 'wild', createdAt: now });
  }
  await setSetting(h.db, 'sol_agents', JSON.stringify(['a', 'b']));
  const s: SolDeps = { d: { db: h.db, now: () => now } as never, config, key, net };
  return { h, db: h.db, now, s };
}
const coin = (address: string, dexId: string, now: Date) => ({ address, symbol: address.slice(0, 4).toUpperCase(), name: 'c', pairAddress: 'p', dexId, url: 'u', priceUsd: 1, liquidityUsd: 1e5, volumeH1: 1e4, volumeH24: 1e5,
  changeM5: 0, changeH1: 0, changeH24: 0, buysH1: 1, sellsH1: 1, source: 'trending', refreshedAt: now });

describe('the real SOL desk', () => {
  it('refuses a transaction that would take more SOL than the trade', async () => {
    const { net, bal, calls } = fakeNet({ simMove: -0.5 * L });
    const kp = Keypair.generate();
    bal.set(kp.publicKey.toBase58(), L);
    await expect(trade(net, kp, { action: 'buy', mint: 'm', amount: 0.01, denominatedInSol: 'true' }, 0.015 * L)).rejects.toThrow(/refused/);
    expect(calls.sent).toBe(0);
  });

  it('funds each trading agent once from the house, while the house has enough', async () => {
    const { net, bal } = fakeNet();
    const { h, db, now, s } = await world(net);
    const house = await solWallet(db, HOUSE, key, now);
    bal.set(house.publicKey, 0.07 * L);
    expect(await fundPass(s, ['a', 'b'])).toBe(1); // enough for one
    bal.set(house.publicKey, bal.get(house.publicKey)! + 0.05 * L);
    expect(await fundPass(s, ['a', 'b'])).toBe(1);
    expect(await fundPass(s, ['a', 'b'])).toBe(0);
    const a = await solWallet(db, 'a', key, now);
    expect(bal.get(a.publicKey)).toBe(0.05 * L);
    expect((await db.select().from(solTrades)).filter((t) => t.kind === 'fund' && t.ok)).toHaveLength(2);
    await h.close();
  });

  it('buys a fresh paper position in a pump.fun coin, skips other coins and old ones, and sells once the paper position closes', async () => {
    const { net, bal, calls, o } = fakeNet({ move: -0.0102 * L });
    const { h, db, now, s } = await world(net);
    const w = await solWallet(db, 'a', key, now);
    await db.update(solWallets).set({ fundedAt: now }).where(eq(solWallets.ownerId, 'a'));
    bal.set(w.publicKey, 0.05 * L);
    await db.insert(realMarket).values([coin('AAApump', 'pumpfun', now), coin('BBBray', 'raydium', now), coin('CCCpump', 'pumpswap', now)]);
    const pos = (address: string, openedAt: Date) => ({ agentId: 'a', address, symbol: address.slice(0, 4).toUpperCase(), qty: 1, costUsd: 50, openedAt, updatedAt: openedAt });
    await db.insert(realPositions).values([pos('AAApump', now), pos('BBBray', now), pos('CCCpump', new Date(now.getTime() - 3_600_000))]);
    await mirror(s, 'a');
    const held = await db.select().from(solPositions);
    expect(held.map((p) => p.mint)).toEqual(['AAApump']);
    expect(calls.body).toMatchObject({ action: 'buy', mint: 'AAApump', amount: 0.01, denominatedInSol: 'true', pool: 'auto' });
    expect(held[0]!.solIn).toBeCloseTo(0.0102);

    // The paper desk closed it: the real one is sold, all of it.
    await db.delete(realPositions).where(eq(realPositions.address, 'AAApump'));
    o.move = 0.012 * L;
    await mirror(s, 'a');
    expect(await db.select().from(solPositions)).toHaveLength(0);
    expect((await db.select().from(solTrades)).map((t) => `${t.kind}:${t.ok}`).sort()).toEqual(['buy:true', 'sell:true']);
    await h.close();
  });

  it('in exit mode sends every wallet back to the owner once nothing is left to sell', async () => {
    const { net, bal } = fakeNet();
    const { h, db, now, s } = await world(net);
    const owner = Keypair.generate().publicKey.toBase58();
    const exit: SolDeps = { ...s, config: { ...config, mode: 'exit', returnTo: owner } };
    const a = await solWallet(db, 'a', key, now), house = await solWallet(db, HOUSE, key, now);
    bal.set(a.publicKey, 0.03 * L); bal.set(house.publicKey, 0.01 * L);
    await db.insert(solPositions).values({ agentId: 'a', mint: 'm', symbol: 'M', solIn: 0.01, openedAt: now });
    expect(await returnPass(exit, ['a', 'b'])).toBe(0); // still holding a coin
    await db.delete(solPositions);
    expect(await returnPass(exit, ['a', 'b'])).toBeCloseTo(0.04 - 0.00001, 6);
    expect(bal.get(owner)).toBe(0.04 * L - 10_000);
    await h.close();
  });
});
