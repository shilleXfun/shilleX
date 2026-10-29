import { describe, it, expect } from 'vitest';
import { TRADE_EVERY_MS, dueToTrade } from '../src/agents/director.ts';

/** Funded agents trade at least every 10 minutes (owner, 2026-10-29). */
describe('the trade pulse', () => {
  it('picks the funded agents with no trade in 10 minutes, the longest waiting first, never one just woken to trade, four at most', () => {
    const now = Date.parse('2026-10-29T16:30:00Z');
    const ago = (m: number) => now - m * 60_000;
    const last = new Map([['a', ago(25)], ['b', ago(5)], ['c', ago(11)], ['d', ago(60)]]);
    const woken = new Map([['d', ago(2)]]);
    expect(dueToTrade(['a', 'b', 'c', 'd', 'e'], last, woken, now)).toEqual(['e', 'a', 'c']);
    expect(dueToTrade(['b'], last, new Map(), now + TRADE_EVERY_MS)).toEqual(['b']);
    expect(dueToTrade(['p', 'q', 'r', 's', 't', 'u'], new Map(), new Map(), now)).toHaveLength(4);
  });
});
