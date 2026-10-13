import { describe, it, expect } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { MemoryChain } from '../src/world/chain.ts';
import { mulberry32 } from '../src/seed/rng.ts';
import { loadConfig } from '../src/config.ts';
import { priceOf, quoteBuy, quoteSell, type PoolState } from '../src/ledger/curve.ts';
import { DEFAULT_RULES, rulesFromConfig } from '../src/ledger/rules.ts';

const TX_FEE = 5000; // MemoryChain's network fee, which the ledger does not charge

describe('the ledger curve is MemoryChain’s curve', () => {
  it('gives the same tokens, SOL and price over random trades', async () => {
    for (const seed of [1, 2, 3]) {
      const rng = mulberry32(seed), mem = new MemoryChain(), a = Keypair.generate();
      mem.airdrop(a.publicKey.toBase58(), 1_000 * 1e9);
      const { mint } = await mem.launch(a, { name: 'C', symbol: 'C', uri: 'u', initialBuyLamports: 0 });
      const p: PoolState = { sol: 0, sold: 0 };
      let held = 0;
      for (let i = 0; i < 300; i++) {
        if (held > 0 && rng() < 0.4) {
          const raw = Math.max(1, Math.floor(held * rng()));
          const m = await mem.sell(a, mint, raw, 0), q = quoteSell(p, raw);
          expect(m.lamportsDelta + TX_FEE).toBe(q.out);
          p.sol -= q.gross; p.sold -= raw; held -= raw;
        } else {
          const lamports = Math.floor(rng() * 50_000_000) + 1_000;
          let m;
          try { m = await mem.buy(a, mint, lamports, 0); } catch { break; } // the curve graduated
          const q = quoteBuy(p, lamports);
          expect(-m.lamportsDelta - TX_FEE).toBe(q.spent);
          expect(m.tokenDelta).toBe(q.out);
          p.sol += q.net; p.sold += q.out; held += q.out;
        }
        expect(priceOf(p)).toBe((await mem.curve(mint))!.priceLamports);
      }
    }
  });
  it('accounts for every lamport of a buy: spent = net into the pool + the 1% fee', () => {
    const q = quoteBuy({ sol: 0, sold: 0 }, 10_000_000);
    expect(q.net + q.fee).toBe(q.spent);
    expect(q.fee).toBe(q.spent - Math.floor(q.spent * 0.99));
  });
  it('accounts for every lamport of a sale: gross = out + fee', () => {
    const b = quoteBuy({ sol: 0, sold: 0 }, 20_000_000);
    const s = quoteSell({ sol: b.net, sold: b.out }, Math.floor(b.out / 2));
    expect(s.out + s.fee).toBe(s.gross);
  });
  it('takes rules from the config', () => {
    const r = rulesFromConfig(loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 's', MAINNET_HOUSE_FEE_BPS: '0', MAINNET_MAX_TRADE_SOL: '0.02' }));
    expect(r).toEqual({ ...DEFAULT_RULES, houseFeeBps: 0, maxTradeLamports: 20_000_000 });
  });
});
