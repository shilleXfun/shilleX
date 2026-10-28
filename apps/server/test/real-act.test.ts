import { describe, it, expect } from 'vitest';
import { testDb } from './helpers.ts';
import { loadConfig } from '../src/config.ts';
import { agents, realMarket, users } from '../src/db/schema.ts';
import { realAct, realCoins } from '../src/agents/external/real-act.ts';

/**
 * Mainnet (2026-10-28): an outside agent's API buy and sell are real trades from its own vault wallet, on the real coins Shillex
 * follows, inside its owner's limits; launching is not open on mainnet. Nothing touches devnet coins.
 */
const config = loadConfig({ NODE_ENV: 'test', SOLANA_NETWORK: 'mainnet', SOLANA_MAINNET_RPC_URL: 'https://mainnet.helius-rpc.com/?api-key=x', SOL_TRADING: 'off' });
const MINT = 'So1anaMemeMint11111111111111111111111111111';

async function world() {
  const { db } = await testDb();
  const now = new Date('2026-10-28T17:00:00Z');
  await db.insert(users).values({ id: 'a1', username: 'realbot', displayName: 'Real', kind: 'agent', createdAt: now });
  await db.insert(agents).values({ userId: 'a1', origin: 'external', status: 'active', createdAt: now });
  await db.insert(realMarket).values({ address: MINT, symbol: 'MEME', name: 'Meme', pairAddress: 'pair', dexId: 'pumpswap', url: 'https://dexscreener.com/solana/pair', priceUsd: 0.001, liquidityUsd: 50_000, volumeH1: 9000, volumeH24: 90_000, changeM5: 1, changeH1: 5, changeH24: 20, buysH1: 40, sellsH1: 30, source: 'dexscreener', refreshedAt: now } as never);
  const calls: unknown[][] = [];
  const bank = {
    buy: async (...a: unknown[]) => { calls.push(['buy', ...a]); return { ok: true, outcome: 'bought $MEME with 0.01 SOL' }; },
    sell: async (...a: unknown[]) => { calls.push(['sell', ...a]); return { ok: true, outcome: 'sold half of $MEME' }; },
  };
  return { d: { db, config, now: () => now, bank }, calls };
}

describe('real trades through the API on mainnet', () => {
  it('buys a real coin from the vault wallet', async () => {
    const { d, calls } = await world();
    const r = await realAct(d, 'a1', 'buy', { mint: MINT, sol: 0.01 });
    expect(r).toMatchObject({ ok: true });
    expect(calls[0]![0]).toBe('buy');
    expect(calls[0]![2]).toMatchObject({ address: MINT, symbol: 'MEME', dexId: 'pumpswap' });
    expect(calls[0]![3]).toBe(0.01);
  });
  it('refuses a buy over the mainnet default of 0.1 SOL, an unknown coin, and any launch', async () => {
    const { d, calls } = await world();
    await expect(realAct(d, 'a1', 'buy', { mint: MINT, sol: 0.2 })).rejects.toMatchObject({ code: 'OVER_TRADE_LIMIT' });
    await expect(realAct(d, 'a1', 'buy', { mint: 'nope', sol: 0.01 })).rejects.toMatchObject({ code: 'UNKNOWN_MINT' });
    await expect(realAct(d, 'a1', 'launch', { name: 'X', symbol: 'X' })).rejects.toMatchObject({ code: 'LAUNCH_UNAVAILABLE' });
    expect(calls).toHaveLength(0);
  });
  it('sells a share of a holding', async () => {
    const { d, calls } = await world();
    await realAct(d, 'a1', 'sell', { mint: MINT, pct: 50 });
    expect(calls[0]).toEqual(['sell', 'a1', MINT, 0.5, 'agent']);
  });
  it('lists the real coins it can buy', async () => {
    const { d } = await world();
    expect((await realCoins(d.db))[0]).toMatchObject({ mint: MINT, symbol: 'MEME', price_usd: 0.001 });
  });
});
