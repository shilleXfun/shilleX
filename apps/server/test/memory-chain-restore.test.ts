import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { makeTestApp } from './helpers.ts';
import { worldTestCtx } from './world-helpers.ts';
import { loadConfig } from '../src/config.ts';
import { chainTxs, wallets } from '../src/db/schema.ts';
import { bootAgents, restoreMemoryChain } from '../src/world/boot.ts';
import { MemoryChain, RAW_PER_TOKEN } from '../src/world/chain.ts';
import { START_LAMPORTS, fundAgents } from '../src/world/ledger.ts';
import { seedWorld } from '../src/world/seed.ts';
import { runTool } from '../src/world/tools.ts';
import { TREASURY, walletOf } from '../src/world/wallets.ts';

let w: Awaited<ReturnType<typeof worldTestCtx>>;
let mint = '';
let priceBefore = 0;
const pk = async (i: number) => (await walletOf(w.t.db, w.agents[i]!.id))!.publicKey;
/** Acts as agent `i` through the real tools, on `chain` (the restored one in these tests); a failed tool call fails the test. */
const act = async (chain: MemoryChain, i: number, tool: string, input: Record<string, unknown>) => {
  const out = await runTool({ ...(await w.ctxFor(w.agents[i]!)), chain }, tool, input);
  if (!out.ok) throw new Error(`${tool} failed: ${JSON.stringify(out.result)}`);
  return out;
};
const restored = async () => { const chain = new MemoryChain(); await restoreMemoryChain(w.t.db, chain); return chain; };

// One coin, three traders: a launch with an initial buy, a buy, and a buy followed by a full sell.
beforeEach(async () => {
  w = await worldTestCtx();
  mint = ((await act(w.chain, 0, 'launch_coin', { name: 'Lamp', symbol: 'LAMP', description: '', emoji: '💡', initial_buy_sol: 0.03 })).result as { mint: string }).mint;
  await act(w.chain, 1, 'buy', { mint, sol: 0.02, slippage_pct: null });
  await act(w.chain, 2, 'buy', { mint, sol: 0.01, slippage_pct: null });
  await act(w.chain, 2, 'sell', { mint, tokens: null, all: true, slippage_pct: 50 });
  priceBefore = (await w.chain.curve(mint))!.priceLamports;
});
afterEach(() => w.t.close());

describe('restoreMemoryChain', () => {
  it('gives every wallet its SOL and tokens back, to the lamport', async () => {
    const fresh = new MemoryChain();
    expect(await restoreMemoryChain(w.t.db, fresh)).toEqual({ pools: 1, accounts: 51 });
    for (const i of [0, 1, 2, 3]) expect(await fresh.balances(await pk(i))).toEqual(await w.chain.balances(await pk(i)));
    expect((await fresh.balances(await pk(1))).tokens).toEqual([{ mint, raw: expect.any(Number) }]);
    expect((await fresh.balances(await pk(1))).tokens[0]!.raw).toBeGreaterThan(0);
    expect((await fresh.balances(await pk(2))).tokens).toEqual([]);
  });

  it('puts the pool back at the same price', async () => {
    const after = (await (await restored()).curve(mint))!;
    expect(Math.abs(after.priceLamports - priceBefore) / priceBefore).toBeLessThan(1e-9);
    expect(after.graduated).toBe(false);
  });

  it('lets agents keep buying a coin that was launched before the restart', async () => {
    const fresh = await restored();
    const before = await fresh.balances(await pk(3));
    const out = await act(fresh, 3, 'buy', { mint, sol: 0.01, slippage_pct: null });
    expect(out.result).toMatchObject({ symbol: 'LAMP' });
    const after = await fresh.balances(await pk(3));
    expect(after.tokens).toEqual([{ mint, raw: expect.any(Number) }]);
    expect(after.lamports).toBeLessThan(before.lamports);
  });

  it('lets a holder sell a bag it bought before the restart', async () => {
    const fresh = await restored();
    const out = await act(fresh, 1, 'sell', { mint, tokens: null, all: true, slippage_pct: 50 });
    expect((out.result as { tokens: number }).tokens).toBeLessThan(0);
    expect((await fresh.balances(await pk(1))).tokens).toEqual([]);
  });

  it('never repeats a mint or a signature from before the restart', async () => {
    const fresh = await restored();
    const used = new Set((await w.t.db.select({ s: chainTxs.signature }).from(chainTxs)).map((r) => r.s));
    // The same ticker again: only the signature counter keeps the new mint apart from the first coin's.
    const launched = (await act(fresh, 3, 'launch_coin', { name: 'Lamp', symbol: 'LAMP', description: '', emoji: '💡', initial_buy_sol: 0.01 })).result as { mint: string; signature: string };
    expect(launched.mint).not.toBe(mint);
    expect(used.has(launched.signature)).toBe(false);
  });

  it('keeps a graduated coin graduated, with a full curve', async () => {
    const fresh = new MemoryChain();
    fresh.restore({ pools: [{ mint: 'MG', pool: 'PG', sold: 793_100_000 * RAW_PER_TOKEN, graduated: true }], accounts: [], signatures: 5 });
    expect((await fresh.curve('MG'))!).toMatchObject({ graduated: true, curveProgress: 1 });
    await expect(fresh.buy({ publicKey: { toBase58: () => 'x' } } as never, 'MG', 1000, 0)).rejects.toMatchObject({ code: 'GRADUATED' });
  });

  it('does not count the funding rows twice when the treasury funded the wallets over the chain', async () => {
    const t = await makeTestApp();
    const key = randomBytes(32);
    await seedWorld(t.db, { now: t.clock.now(), worldKey: key });
    const live = new MemoryChain();
    live.airdrop((await walletOf(t.db, TREASURY))!.publicKey, 10_000_000_000);
    await fundAgents(t.db, live, key, t.clock.now);
    const [funding] = await t.db.select().from(chainTxs).limit(1);
    const [agent] = await t.db.select().from(wallets).where(eq(wallets.ownerId, funding!.agentId!));
    expect((await live.balances(agent!.publicKey)).lamports).toBe(START_LAMPORTS);
    const fresh = new MemoryChain();
    await restoreMemoryChain(t.db, fresh);
    expect((await fresh.balances(agent!.publicKey)).lamports).toBe(START_LAMPORTS);
    await t.close();
  });

  it('leaves a chain with no history alone, so a first boot can airdrop as before', async () => {
    const t = await makeTestApp();
    const fresh = new MemoryChain();
    expect(await restoreMemoryChain(t.db, fresh)).toBeNull();
    expect(await fresh.curve(mint)).toBeNull();
    await t.close();
  });
});

describe('bootAgents with a memory chain', () => {
  const worldConfig = () => loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 's', WORLD_CHAIN: 'memory', WORLD_KEY: w.key.toString('base64') });

  it('restores the chain from the database when the database already has chain history', async () => {
    const t = await makeTestApp({ config: worldConfig(), db: w.t.db });
    const chain = new MemoryChain();
    const world = await bootAgents(t.app, { chain });
    for (const i of [0, 1, 2]) expect(await chain.balances(await pk(i))).toEqual(await w.chain.balances(await pk(i)));
    expect((await chain.curve(mint))!.priceLamports).toBeCloseTo(priceBefore, 3);
    expect((await w.t.db.select().from(wallets).where(eq(wallets.ownerId, w.agents[1]!.id)))[0]!.fundedAt).not.toBeNull();
    await world.stop();
    await t.close();
  });

  it('still airdrops the starting SOL to every wallet on a fresh database', async () => {
    const t = await makeTestApp({ config: worldConfig() });
    const chain = new MemoryChain();
    const world = await bootAgents(t.app, { chain });
    const all = await t.db.select().from(wallets);
    expect(all).toHaveLength(51);
    for (const x of all) expect((await chain.balances(x.publicKey)).lamports).toBe(x.ownerId === TREASURY ? 10_000_000_000 : START_LAMPORTS);
    expect(await chain.curve(mint)).toBeNull();
    await world.stop();
    await t.close();
  });
});
