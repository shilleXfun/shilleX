import { describe, it, expect } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { testDb } from './helpers.ts';
import { realMarket, realPositions, users } from '../src/db/schema.ts';
import { MAJORS, crudeName, refreshRealMarket } from '../src/world/real-market.ts';

const addr = () => Keypair.generate().publicKey.toBase58();
const pair = (address: string, symbol: string, name = symbol) => ({
  chainId: 'solana', baseToken: { address, symbol, name }, pairAddress: addr(), dexId: 'raydium', url: 'https://dexscreener.com/x', priceUsd: '1.5',
  liquidity: { usd: 200_000 }, volume: { h1: 10_000, h24: 90_000 }, priceChange: { m5: 0, h1: 2, h24: 10 }, txns: { h1: { buys: 30, sells: 20 } },
});

describe('the real coins the agents talk about', () => {
  it('knows a crude name without catching ordinary ones', () => {
    expect(crudeName('ONLYTITTY', 'Only Titty')).toBe(true);
    expect(crudeName('XYZ', 'Fuck It Coin')).toBe(true);
    expect(crudeName('GRAPE', 'Grape Protocol')).toBe(false);
    expect(crudeName('PASS', 'Assets of Sussex')).toBe(false);
  });

  it('lists neither copycats of other chains\' coins nor crude names, sweeps old ones, and keeps a held one priced', async () => {
    const h = await testDb();
    const db = h.db;
    const now = new Date('2026-10-25T19:00:00Z');
    const good = addr(), btc = addr(), crude = addr(), heldBtc = addr(), oldCrude = addr();
    await db.insert(users).values({ id: 'a1', username: 'a1', displayName: 'A1', kind: 'agent', createdAt: now });
    await db.insert(realPositions).values({ agentId: 'a1', address: heldBtc, symbol: 'BTC', qty: 1, costUsd: 1, openedAt: now, updatedAt: now });
    // Stored before the rule existed, and no longer trending.
    await db.insert(realMarket).values({ address: oldCrude, symbol: 'ONLYTITTY', name: 'Only Titty', pairAddress: 'p', dexId: 'r', url: 'u', priceUsd: 1, liquidityUsd: 1, fdvUsd: null, volumeH1: 1, volumeH24: 1, changeM5: 0, changeH1: 0, changeH24: 0, buysH1: 1, sellsH1: 1, pairCreatedAt: null, source: 'trending', imageUrl: null, refreshedAt: now });
    const fetchImpl = (async (url: string) => {
      const body = url.includes('token-boosts') ? [good, btc, crude].map((tokenAddress) => ({ chainId: 'solana', tokenAddress }))
        : [pair(MAJORS[0]!, 'BONK'), pair(good, 'GOOD', 'Good Coin'), pair(btc, 'BTC', 'Bitcoin'), pair(crude, 'BOOBS', 'Boobs'), pair(heldBtc, 'BTC', 'Bitcoin')];
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    await refreshRealMarket(db, now, fetchImpl);
    const listed = new Set((await db.select({ a: realMarket.address }).from(realMarket)).map((r) => r.a));
    expect(listed.has(good)).toBe(true);
    expect(listed.has(MAJORS[0]!)).toBe(true);
    expect(listed.has(heldBtc)).toBe(true);
    expect(listed.has(btc)).toBe(false);
    expect(listed.has(crude)).toBe(false);
    expect(listed.has(oldCrude)).toBe(false);
    await h.close();
  });
});
