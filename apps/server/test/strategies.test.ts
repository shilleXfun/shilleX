import { describe, it, expect } from 'vitest';
import { DESK_STYLES } from '@shillex/shared';
import type { RealMarketRow } from '../src/db/schema.ts';
import { planFor } from '../src/agents/decide.ts';
import { readCoin, realSignals, sizeFactor, strategiesFor, tiltOf, type Strategy } from '../src/agents/strategies.ts';
import { seededTraits } from '../src/agents/state.ts';

const NOW = new Date('2026-10-26T12:00:00Z');
const coin = (over: Partial<RealMarketRow> = {}): RealMarketRow => ({
  address: 'A', symbol: 'SABLE', name: 'Sable', pairAddress: 'P', dexId: 'raydium', url: 'u', priceUsd: 1, liquidityUsd: 1_000_000, fdvUsd: null,
  volumeH1: 200_000, volumeH24: 2_000_000, changeM5: 0.01, changeH1: 0.12, changeH24: 0.2, buysH1: 80, sellsH1: 20, pairCreatedAt: null,
  source: 'trending', imageUrl: null, refreshedAt: NOW, ...over,
});
const read = (s: Strategy, c: RealMarketRow, x: { chatter?: number; friends?: string[]; enemies?: string[] } = {}) => {
  const { sig, words } = realSignals(c, { now: NOW, chatter: x.chatter ?? 0, friends: x.friends ?? [], enemies: x.enemies ?? [] });
  return readCoin(s, sig, words, { risk: 0.5, taste: 0 });
};

describe('nine strategies, one set of signals', () => {
  it('trades only on the signal a strategy lives on', () => {
    expect(read('sniper', coin())).toBeNull(); // no pair age: nothing to snipe
    expect(read('sniper', coin({ pairCreatedAt: new Date(NOW.getTime() - 3 * 3_600_000) }))?.d).toBeGreaterThan(0);
    expect(read('copy', coin())).toBeNull();
    expect(read('copy', coin(), { friends: ['ada', 'bo'] })?.why).toContain('@ada and @bo hold it');
    expect(read('narrative', coin())).toBeNull();
    expect(read('narrative', coin(), { chatter: 6 })?.why).toContain('6 Shillex posts on it in 2 h');
  });

  it('reads the same coin differently: momentum buys the climb, the contrarian buys the flush', () => {
    const climb = coin(), flush = coin({ changeH24: -0.45, changeH1: 0.01, buysH1: 60, sellsH1: 55 });
    expect(read('momentum', climb)!.d).toBeGreaterThan(0);
    expect(read('contrarian', climb)).toBeNull();
    expect(read('contrarian', flush)!.d).toBeGreaterThan(0);
    expect(read('contrarian', flush)!.why).toContain('-45% on the day');
  });

  it('gives its strongest two or three signals as the reason, in digits, and conviction within 0.1 to 0.9', () => {
    const r = read('momentum', coin())!;
    expect(r.why).toBe('+12% this hour, 80 buys to 20 sells this hour');
    expect(r.top).toEqual(['trend', 'flow']);
    expect(r.conviction).toBeGreaterThanOrEqual(0.1);
    expect(r.conviction).toBeLessThanOrEqual(0.9);
    expect(read('momentum', coin(), { enemies: ['x', 'y'] })!.d).toBeLessThan(r.d);
  });

  it('spreads a hundred agents over most of the nine, and a whale trades like one', () => {
    const picked = new Set(Array.from({ length: 100 }, (_, i) => strategiesFor(seededTraits(`agent${i}`), 'social', `agent${i}`)[0]));
    expect(picked.size).toBeGreaterThanOrEqual(7);
    expect(strategiesFor(seededTraits('w1'), 'whale', 'w1')[0]).toBe('whale');
    expect(DESK_STYLES).toHaveLength(9);
  });

  it('a gambler sizes up on a losing streak; diamond hands give a trade more room and time than a sniper', () => {
    expect(tiltOf([{ pnlPct: -0.1 }, { pnlPct: -0.2 }, { pnlPct: 0.3 }, { pnlPct: -0.1 }])).toBe(2);
    expect(sizeFactor('gambler', 2)).toBeGreaterThan(sizeFactor('gambler', 0));
    expect(sizeFactor('momentum', 3)).toBe(1);
    const t = seededTraits('p');
    const diamond = planFor(t, 'diamond', 0.5, ''), sniper = planFor(t, 'sniper', 0.5, '');
    expect(diamond.stopPct).toBeLessThan(sniper.stopPct);
    expect(diamond.horizonMs).toBeGreaterThan(sniper.horizonMs);
    expect(planFor(t, 'value', 0.5, '')).toEqual(diamond);
  });
});
