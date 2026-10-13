import { describe, it, expect } from 'vitest';
import { COIN_DECIMALS, LAMPORTS_PER_SOL } from '@shillex/shared';
import { sparkOf } from '../src/world/indexer.ts';
import type { ChainTxRow } from '../src/db/schema.ts';

const NOW = Date.parse('2026-10-13T12:00:00Z');
const H = 3_600_000;
let n = 0;
/** A trade of `sol` SOL for `tokens` tokens (price sol ÷ tokens), `ago` ms before NOW. Buys spend SOL and gain tokens; sells the reverse. */
const tx = (kind: ChainTxRow['kind'], ago: number, sol: number, tokens: number): ChainTxRow => ({
  id: String(++n).padStart(6, '0'), signature: `s${n}`, agentId: 'a', turnId: null, kind, mint: 'M', counterparty: null,
  lamportsDelta: Math.round((kind === 'sell' ? 1 : -1) * sol * LAMPORTS_PER_SOL),
  tokenDelta: Math.round((kind === 'sell' ? -1 : 1) * tokens * 10 ** COIN_DECIMALS), feeLamports: 0, createdAt: new Date(NOW - ago),
});

describe('sparkOf', () => {
  it('has nothing to draw before the first buy or sell; a launch is not a price', () => {
    expect(sparkOf([], NOW)).toEqual({ spark: [], change1hPct: null });
    expect(sparkOf([tx('launch', H, 0.02, 1000)], NOW)).toEqual({ spark: [], change1hPct: null });
  });
  it('draws one close per hour from the first trade, carrying it through quiet hours; one trade has no change', () => {
    const r = sparkOf([tx('buy', 3 * H, 0.01, 10_000)], NOW);
    expect(r.spark).toEqual([1e-6, 1e-6, 1e-6, 1e-6]);
    expect(r.change1hPct).toBeNull();
  });
  it('compares the latest price with the last one at least an hour old', () => {
    const r = sparkOf([tx('buy', 2 * H, 0.01, 10_000), tx('buy', 30 * 60_000, 0.02, 10_000)], NOW);
    expect(r.spark).toEqual([1e-6, 1e-6, 2e-6]);
    expect(r.change1hPct).toBe(100);
  });
  it('uses the first trade as the base for a coin younger than an hour', () => {
    expect(sparkOf([tx('buy', 40 * 60_000, 0.02, 10_000), tx('sell', 10 * 60_000, 0.01, 10_000)], NOW).change1hPct).toBe(-50);
  });
  it('carries trades older than a day into a full, flat line', () => {
    const old = sparkOf([tx('buy', 30 * H, 0.01, 10_000), tx('buy', 26 * H, 0.03, 10_000)], NOW);
    expect(old.spark).toHaveLength(24);
    expect(new Set(old.spark)).toEqual(new Set([3e-6]));
    expect(old.change1hPct).toBe(0);
  });
});
