import { describe, expect, it } from 'vitest';
import { NETWORK_FEE_SOL, SWAP_FEE, paperBuyFill, paperSellFill } from '../src/world/paper-bank.ts';

const pool = { priceUsd: 0.001, liquidityUsd: 200_000, dexId: 'pumpswap' };
const SOL = 200;

describe('paper fills', () => {
  it('a buy pays the swap fee, a network fee, and a price pushed up by its size', () => {
    const f = paperBuyFill(1, pool, SOL);
    expect(f.spentSol).toBeCloseTo(1 + NETWORK_FEE_SOL, 9);
    expect(f.feeSol).toBeCloseTo(SWAP_FEE.pumpswap! + NETWORK_FEE_SOL, 9);
    // $198.4 into a $100k side: about 0.2% worse than the quoted price.
    expect(f.avgPriceUsd / pool.priceUsd - 1).toBeCloseTo((1 - SWAP_FEE.pumpswap!) * SOL / 100_000, 6);
    expect(f.tokens).toBeCloseTo(((1 - SWAP_FEE.pumpswap!) * SOL) / f.avgPriceUsd, 3);
  });

  it('a bigger order in a thinner pool fills worse', () => {
    const small = paperBuyFill(0.1, pool, SOL), big = paperBuyFill(10, { ...pool, liquidityUsd: 20_000 }, SOL);
    expect(big.avgPriceUsd).toBeGreaterThan(small.avgPriceUsd * 1.1);
  });

  it('a round trip at an unchanged price loses fees and impact, never gains', () => {
    const b = paperBuyFill(0.5, pool, SOL);
    const s = paperSellFill(b.tokens, pool, SOL);
    expect(s.outSol).toBeLessThan(0.5);
    expect(s.outSol).toBeGreaterThan(0.5 * (1 - 2 * SWAP_FEE.pumpswap!) * 0.99);
  });

  it('a sale after the price doubles makes money, less the costs', () => {
    const b = paperBuyFill(0.5, pool, SOL);
    const s = paperSellFill(b.tokens, { ...pool, priceUsd: pool.priceUsd * 2 }, SOL);
    expect(s.outSol).toBeGreaterThan(0.95);
    expect(s.outSol).toBeLessThan(1);
  });

  it('an unknown venue still charges a fee', () => {
    const f = paperBuyFill(1, { ...pool, dexId: 'orca' }, SOL);
    expect(f.feeSol).toBeGreaterThan(NETWORK_FEE_SOL);
  });
});
