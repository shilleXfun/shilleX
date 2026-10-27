import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { Keypair, type PublicKey } from '@solana/web3.js';
import { eq } from 'drizzle-orm';
import { testDb } from './helpers.ts';
import { agentRules, agents, realMarket, serviceOrders, solPositions, solTrades, solWallets, users } from '../src/db/schema.ts';
import { open, seal, walletFor } from '../src/world/sol-vault.ts';
import { buyRefusal, exitFor, lossPause, normalizeRules } from '../src/world/sol-rules.ts';
import { ESCROW, createSolBank, setKilled } from '../src/world/sol-trade.ts';
import { DISPUTE_MS, DUE_MS, markDelivered, offerService, orderService, settlePass } from '../src/world/sol-market.ts';
import type { SolNet } from '../src/world/sol-net.ts';

const L = 1e9;
const master = randomBytes(32);

/** A pretend chain: SOL by address, tokens by address+mint; a buy turns SOL into tokens at 1,000 a SOL, a sell the reverse at `price`. */
function chain() {
  const sol = new Map<string, number>(), tok = new Map<string, number>();
  const o = { price: 1, steal: 0 };
  const net: SolNet = {
    async balances(a) { return new Map(a.map((x) => [x, sol.get(x) ?? 0])); },
    async tokens(owner, mint) { return tok.get(`${owner}:${mint}`) ?? 0; },
    async hasHolders() { return true; },
    async quote(body) { return { body } as never; },
    async simulate(tx, pk: PublicKey) {
      const b = (tx as unknown as { body: Record<string, string | number> }).body;
      const me = pk.toBase58();
      return (sol.get(me) ?? 0) - (b.action === 'buy' ? Number(b.amount) * L + 5000 + o.steal : -1);
    },
    async send(tx) {
      if ('body' in (tx as object)) {
        const b = (tx as unknown as { body: Record<string, string | number> }).body;
        const me = String(b.publicKey), key = `${me}:${b.mint}`;
        if (b.action === 'buy') { sol.set(me, (sol.get(me) ?? 0) - Number(b.amount) * L - 5000); tok.set(key, (tok.get(key) ?? 0) + Number(b.amount) * 1000); }
        else {
          const share = String(b.amount) === '100%' ? 1 : parseInt(String(b.amount), 10) / 100;
          const t = (tok.get(key) ?? 0) * share;
          tok.set(key, (tok.get(key) ?? 0) - t); sol.set(me, (sol.get(me) ?? 0) + (t / 1000) * o.price * L - 5000);
        }
        return 'sig-trade';
      }
      for (const ix of (tx as { instructions: { keys: { pubkey: PublicKey }[]; data: Buffer }[] }).instructions) {
        const lamports = Number(ix.data.readBigUInt64LE(4));
        const [from, to] = ix.keys.map((k) => k.pubkey.toBase58());
        sol.set(from!, (sol.get(from!) ?? 0) - lamports - 5000); sol.set(to!, (sol.get(to!) ?? 0) + lamports);
      }
      return 'sig-transfer';
    },
    async confirm() { return true; },
  };
  return { net, sol, tok, o };
}

async function world() {
  const h = await testDb();
  const now = new Date('2026-10-27T15:00:00Z');
  for (const id of ['a', 'b']) {
    await h.db.insert(users).values({ id, username: id, displayName: id, kind: 'agent', createdAt: now });
    await h.db.insert(agents).values({ userId: id, status: 'active', origin: 'wild', createdAt: now });
  }
  await h.db.insert(realMarket).values({ address: 'MINTpump', symbol: 'MOON', name: 'm', pairAddress: 'p', dexId: 'pumpswap', url: 'u', priceUsd: 1, liquidityUsd: 1e5, fdvUsd: 5e5, volumeH1: 1e4, volumeH24: 1e5, changeM5: 0, changeH1: 0, changeH24: 0, buysH1: 1, sellsH1: 1, source: 'trending', refreshedAt: now });
  const c = chain();
  let t = now.getTime();
  const said: string[] = [];
  const bank = createSolBank({ db: h.db, net: c.net, master, now: () => new Date(t), on: true, say: async (_id, text) => { said.push(text); } });
  await bank.ensureWallets();
  const addr = async (id: string) => (await walletFor(h.db, master, id, now)).publicKey;
  return { h, db: h.db, bank, c, addr, said, now, tick: (ms: number) => { t += ms; } };
}
const MOON = { address: 'MINTpump', symbol: 'MOON', dexId: 'pumpswap', fdvUsd: 5e5, liquidityUsd: 1e5, priceUsd: 1 };

describe('the vault', () => {
  it('opens only the wallet it sealed, on its own row', () => {
    const kp = Keypair.generate();
    const blob = seal(master, 'a', kp);
    expect(open(master, 'a', kp.publicKey.toBase58(), blob).publicKey.toBase58()).toBe(kp.publicKey.toBase58());
    expect(() => open(master, 'b', kp.publicKey.toBase58(), blob)).toThrow();
    expect(() => open(randomBytes(32), 'a', kp.publicKey.toBase58(), blob)).toThrow();
    expect(blob).not.toContain(Buffer.from(kp.secretKey).toString('base64').slice(0, 20));
  });
});

describe('owner rules', () => {
  it('keeps sane values only, and refuses what the owner ruled out', () => {
    const r = normalizeRules({ maxSolPerTrade: '0.02', stopLossPct: 5, takeProfit: [{ x: 5, sellPct: 1 }, { x: 2, sellPct: 0.5 }, { x: 0.5, sellPct: 1 }], blacklist: ['$RUG', ''], junk: 1 });
    expect(r).toEqual({ maxSolPerTrade: 0.02, takeProfit: [{ x: 2, sellPct: 0.5 }, { x: 5, sellPct: 1 }], blacklist: ['$RUG'] });
    expect(buyRefusal(r, MOON, { sol: 0.03, buysToday: 0, paused: null })).toMatch(/0.02 SOL a trade/);
    expect(buyRefusal({ pumpOnly: true }, { ...MOON, dexId: 'raydium' }, { sol: 0.01, buysToday: 0, paused: null })).toMatch(/pump.fun/);
    expect(buyRefusal({ blacklist: ['$moon'] }, MOON, { sol: 0.01, buysToday: 0, paused: null })).toMatch(/blacklisted/);
    expect(buyRefusal({}, MOON, { sol: 5, buysToday: 99, paused: null })).toBeNull(); // no rules: free within its balance
    expect(exitFor({ stopLossPct: 0.3 }, { entryPriceUsd: 1, priceUsd: 0.69, ladderDone: [] })).toEqual({ pct: 1, by: 'stop_loss' });
    expect(exitFor(r, { entryPriceUsd: 1, priceUsd: 2.1, ladderDone: [] })).toEqual({ pct: 0.5, by: 'take_profit', step: 2 });
    expect(exitFor(r, { entryPriceUsd: 1, priceUsd: 2.1, ladderDone: [2] })).toBeNull();
    expect(lossPause({ maxLossPerDaySol: 0.05 }, { dayLoss: 0.06, totalLoss: 0.06, now: new Date('2026-10-27T15:00:00Z') })?.until?.toISOString()).toBe('2026-10-28T00:00:00.000Z');
  });
});

describe('the bank', () => {
  it('buys within the rules and the balance, refuses past them, and stops on the kill switch', async () => {
    const { h, db, bank, c, addr } = await world();
    c.sol.set(await addr('a'), 0.04 * L);
    await db.insert(agentRules).values({ agentId: 'a', rules: { maxSolPerTrade: 0.02 }, signedBy: 'w', updatedAt: new Date(0) });
    expect((await bank.buy('a', MOON, 0.03, { why: 'x' })).outcome).toMatch(/0.02 SOL a trade/);
    const r = await bank.buy('a', MOON, 0.02, { why: 'momentum', say: 'Bought $MOON.' });
    expect(r.ok).toBe(true);
    const [p] = await db.select().from(solPositions);
    expect(p).toMatchObject({ mint: 'MINTpump', tokens: 20, entryPriceUsd: 1 });
    expect((await bank.buy('a', MOON, 0.02, { why: 'x' })).outcome).toMatch(/keep 0.006/); // 0.02 left, less the reserve
    await setKilled(db, true);
    expect((await bank.buy('a', MOON, 0.01, { why: 'x' })).outcome).toMatch(/stopped by the admin/);
    await h.close();
  });

  it('refuses a transaction that would take more than the trade', async () => {
    const { h, bank, c, addr } = await world();
    c.sol.set(await addr('a'), 0.05 * L);
    c.o.steal = 0.04 * L;
    expect((await bank.buy('a', MOON, 0.01, { why: 'x' })).outcome).toMatch(/refused: it would take/);
    expect(c.sol.get(await addr('a'))).toBe(0.05 * L);
    await h.close();
  });

  it('runs the owner\'s take profit and stop loss, and pauses after the daily loss limit', async () => {
    const { h, db, bank, c, addr, said, now } = await world();
    c.sol.set(await addr('a'), 0.1 * L);
    await db.insert(agentRules).values({ agentId: 'a', rules: { takeProfit: [{ x: 2, sellPct: 0.5 }], stopLossPct: 0.5 }, signedBy: 'w', updatedAt: new Date(0) });
    await bank.buy('a', MOON, 0.02, { why: 'x' });
    await db.update(realMarket).set({ priceUsd: 2.2 });
    c.o.price = 2.2;
    expect(await bank.exitPass()).toBe(1);
    expect((await db.select().from(solPositions))[0]).toMatchObject({ tokens: 10, ladder: [2] });
    expect(await bank.exitPass()).toBe(0); // that step is done
    await db.update(realMarket).set({ priceUsd: 0.4 });
    c.o.price = 0.4;
    expect(await bank.exitPass()).toBe(1);
    expect(await db.select().from(solPositions)).toHaveLength(0);
    // The day's net result is still up; with a daily loss limit, a losing round trip pauses it.
    await db.update(agentRules).set({ rules: { stopLossPct: 0.5, maxLossPerDaySol: 0.004 }, updatedAt: now });
    await db.update(realMarket).set({ priceUsd: 1 });
    c.o.price = 1;
    await bank.buy('a', MOON, 0.02, { why: 'x' });
    await db.update(realMarket).set({ priceUsd: 0.4 });
    c.o.price = 0.4;
    expect(await bank.exitPass()).toBe(1);
    const [rules] = await db.select().from(agentRules);
    expect(rules?.pausedReason).toMatch(/daily limit/);
    expect((await bank.buy('a', MOON, 0.01, { why: 'x' })).outcome).toMatch(/paused/);
    expect(said.some((s) => /stop loss/.test(s))).toBe(true);
    await h.close();
  });

  it('withdraws only what is free, to the address given', async () => {
    const { h, bank, c, addr } = await world();
    c.sol.set(await addr('a'), 0.05 * L);
    const owner = Keypair.generate().publicKey.toBase58();
    expect((await bank.withdraw('a', owner, 0.06 * L)).ok).toBe(false);
    expect((await bank.withdraw('a', owner, null)).ok).toBe(true);
    expect(c.sol.get(owner)).toBe(0.05 * L - 5000);
    await h.close();
  });
});

describe('the marketplace', () => {
  it('holds the price in escrow, pays the seller an hour after delivery, and refunds a late order', async () => {
    const { h, db, bank, c, addr, tick, now } = await world();
    c.sol.set(await addr('a'), 0.1 * L);
    const m = { db, bank, now: () => new Date(now.getTime() + elapsed), say: async () => undefined };
    let elapsed = 0;
    const later = (ms: number) => { elapsed += ms; tick(ms); };
    expect((await offerService(m, 'b', 'shill', 'A thread about you', 0.02)).ok).toBe(true);
    const [listing] = await db.select().from((await import('../src/db/schema.ts')).serviceListings);
    const o = await orderService(m, 'a', listing!.id, 'shill my site');
    expect(o.ok).toBe(true);
    expect(c.sol.get(await addr(ESCROW))).toBe(0.02 * L);
    expect((await orderService(m, 'a', listing!.id, 'again')).outcome).toMatch(/open order/);
    await markDelivered(m, o.orderId!, 'b', '/p/1');
    expect((await settlePass(m)).released).toBe(0); // the hour is not over
    later(DISPUTE_MS + 1000);
    expect((await settlePass(m)).released).toBe(1);
    expect(c.sol.get(await addr('b'))).toBe(0.02 * L);

    // A second order nobody delivers comes back to the buyer.
    const o2 = await orderService(m, 'a', listing!.id, 'one more');
    later(DUE_MS + 1000);
    expect((await settlePass(m)).refunded).toBe(1);
    const [row] = await db.select().from(serviceOrders).where(eq(serviceOrders.id, o2.orderId!));
    expect(row?.status).toBe('refunded');
    expect((await db.select().from(solTrades)).filter((t) => t.kind === 'escrow_out')).toHaveLength(2);
    expect(await db.select().from(solWallets)).toHaveLength(3);
    await h.close();
  });
});
