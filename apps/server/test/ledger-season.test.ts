import { describe, it, expect, afterEach } from 'vitest';
import { eq, ne } from 'drizzle-orm';
import { ledgerCtx } from './ledger-helpers.ts';
import { worldTestCtx } from './world-helpers.ts';
import { chainTxs, ledgerDeposits, ledgerPools, ledgerReconciliations, wallets, worldCoins } from '../src/db/schema.ts';
import { devnetNetWorth, fundOpening, startSeason } from '../src/ledger/season.ts';
import { HOUSE, currentSeason } from '../src/ledger/accounts.ts';
import { books } from '../src/ledger/books.ts';
import { runTool } from '../src/world/tools.ts';
import { Indexer } from '../src/world/indexer.ts';
import { perceive } from '../src/agents/perceive.ts';
import { TREASURY } from '../src/world/wallets.ts';

const SOL = 1e9;
let close: (() => Promise<void>) | null = null;
afterEach(async () => { await close?.(); close = null; });

describe('seasons', () => {
  it('values each agent at its devnet net worth', async () => {
    const w = await worldTestCtx(); close = () => w.t.close();
    await w.t.db.update(wallets).set({ fundedAt: w.t.clock.now() });
    await runTool(await w.ctxFor(w.agents[0]!), 'launch_coin', { name: 'Moth', symbol: 'MOTH', description: '', emoji: '🦋', initial_buy_sol: 0.02 });
    const worth = await devnetNetWorth(w.t.db);
    expect(worth.get(w.agents[1]!.id)).toBe(100_000_000);
    expect(worth.get(w.agents[0]!.id)).toBeGreaterThan(0.05 * SOL);
    expect(worth.get(w.agents[0]!.id)).toBeLessThan(0.1 * SOL);
    expect(worth.has(TREASURY)).toBe(false);
  });

  it('starts a season: archives coins, clears the books, waits for the openings', async () => {
    const c = await ledgerCtx(); close = () => c.t.close();
    await c.fund(0, 0.1);
    const ctx = { ...(await c.ctxFor(c.agents[0]!)), chain: c.chain };
    const l = await runTool(ctx, 'launch_coin', { name: 'Moth', symbol: 'MOTH', description: '', emoji: '🦋', initial_buy_sol: 0 });
    const mint = (l.result as { mint: string }).mint;
    await c.t.db.insert(ledgerDeposits).values({ id: 'd1', season: 'dev', agentId: c.agents[0]!.id, userId: 'u', sender: 's', lamports: 1, reference: 'r', status: 'pending', signature: null, createdAt: c.t.clock.now(), expiresAt: c.t.clock.now(), settledAt: null });
    await expect(startSeason(c.t.db, 'rehearsal', new Map(), c.t.clock.now())).rejects.toThrow(/Settle every pending/);
    await c.t.db.update(ledgerDeposits).set({ status: 'expired' });
    const plan = new Map(c.agents.slice(0, 3).map((a) => [a.id, 0.05 * SOL]));
    expect(await startSeason(c.t.db, 'rehearsal', plan, c.t.clock.now())).toMatchObject({ previous: 'dev', archivedCoins: 1, plan: 0.15 * SOL });
    expect(await currentSeason(c.t.db)).toBe('rehearsal');
    expect(await c.t.db.select().from(ledgerPools)).toEqual([]);
    expect(await books(c.t.db)).toMatchObject({ ok: true, ledgerTotal: 0 });
    expect((await c.t.db.select().from(worldCoins).where(eq(worldCoins.mint, mint)))[0]!.archivedAt).not.toBeNull();
    expect((await c.t.db.select().from(wallets).where(ne(wallets.ownerId, TREASURY))).every((x) => x.fundedAt === null)).toBe(true);
    const indexer = new Indexer(c.t.db, c.chain, c.t.clock.now, { viewTtlMs: 0 });
    expect(await indexer.coins()).toEqual([]);
    expect((await indexer.coin(mint))!.archived).toBe(true);
    expect((await perceive(c.d, c.agents[0]!.id)).coins.find((x) => x.mint === mint)).toBeUndefined();
  });

  it('funds the openings from the house, once', async () => {
    const c = await ledgerCtx(); close = () => c.t.close();
    const plan = new Map(c.agents.slice(0, 3).map((a) => [a.id, 0.05 * SOL]));
    await startSeason(c.t.db, 'season1', plan, c.t.clock.now());
    await expect(fundOpening(c.t.db, c.t.clock.now())).rejects.toThrow(/house holds 0 SOL/);
    await c.chain.credit(HOUSE, 0.2 * SOL, 'house_stake', 'cold-sig-1');
    expect(await fundOpening(c.t.db, c.t.clock.now())).toMatchObject({ funded: 3, lamports: 0.15 * SOL });
    expect(await fundOpening(c.t.db, c.t.clock.now())).toMatchObject({ funded: 0, lamports: 0 });
    for (let i = 0; i < 3; i++) expect((await c.chain.balances(await c.pk(i))).lamports).toBe(0.05 * SOL);
    expect((await c.t.db.select().from(chainTxs).where(eq(chainTxs.kind, 'opening'))).length).toBe(3);
    expect((await c.t.db.select().from(wallets).where(ne(wallets.ownerId, TREASURY))).every((x) => x.fundedAt !== null)).toBe(true);
    expect((await books(c.t.db)).ok).toBe(true);
  });

  it('never wipes a season that ran with MAINNET=on, whatever its name (C1)', async () => {
    const c = await ledgerCtx(); close = () => c.t.close();
    await startSeason(c.t.db, 'rehearsal', new Map(), c.t.clock.now());
    await c.t.db.insert(ledgerReconciliations).values({ id: 'r-on', season: 'rehearsal', mode: 'on', at: c.t.clock.now(), ok: true, ledgerTotal: 0, onchainTotal: 0, details: { mismatches: [], shortBy: 0, error: null } });
    await expect(startSeason(c.t.db, 'season1', new Map(), c.t.clock.now())).rejects.toThrow(/real SOL/);
    expect(await currentSeason(c.t.db)).toBe('rehearsal');
  });

  it('never wipes a mainnet season’s books: they hold real SOL', async () => {
    const c = await ledgerCtx(); close = () => c.t.close();
    await startSeason(c.t.db, 'season1', new Map(), c.t.clock.now());
    await c.fund(0, 0.1);
    await expect(startSeason(c.t.db, 'rehearsal', new Map(), c.t.clock.now())).rejects.toThrow(/real SOL/);
    expect((await c.chain.balances(await c.pk(0))).lamports).toBe(0.1 * SOL);
    expect(await currentSeason(c.t.db)).toBe('season1');
  });
});
