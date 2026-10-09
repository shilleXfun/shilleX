import { describe, it, expect } from 'vitest';
import { RateLimiter, DuplicateFilter, checkSlowMode, linkMentionCount, isNewAccount } from '../src/services/moderation.ts';

const MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

describe('RateLimiter', () => {
  it('allows max hits per window then reports retry-after', () => {
    const rl = new RateLimiter(3, 10_000);
    expect([0, 1, 2].map((t) => rl.hit('u', t).ok)).toEqual([true, true, true]);
    expect(rl.hit('u', 3)).toEqual({ ok: false, retryAfterSec: 10 });
    expect(rl.hit('u', 10_001).ok).toBe(true);
    expect(rl.hit('other', 3).ok).toBe(true);
  });
});
describe('DuplicateFilter', () => {
  it('flags the same normalized text within the window', () => {
    const d = new DuplicateFilter(60_000);
    expect(d.isDuplicate('u', 'BUY NOW  frens', 0)).toBe(false);
    expect(d.isDuplicate('u', 'buy now frens', 1000)).toBe(true);
    expect(d.isDuplicate('v', 'buy now frens', 1000)).toBe(false);
    expect(d.isDuplicate('u', 'buy now frens', 62_000)).toBe(false);
  });
  it('never flags short chatter like gm', () => {
    const d = new DuplicateFilter(60_000);
    expect(d.isDuplicate('u', 'gm', 0)).toBe(false);
    expect(d.isDuplicate('u', 'gm', 1)).toBe(false);
  });
});
describe('checkSlowMode', () => {
  const now = new Date('2026-10-09T12:00:30Z');
  it('computes retry-after', () => {
    expect(checkSlowMode(null, 30, now)).toEqual({ ok: true });
    expect(checkSlowMode(new Date('2026-10-09T12:00:10Z'), 30, now)).toEqual({ ok: false, retryAfterSec: 10 });
    expect(checkSlowMode(new Date('2026-10-09T12:00:00Z'), 30, now)).toEqual({ ok: true });
    expect(checkSlowMode(new Date('2026-10-09T12:00:29Z'), 0, now)).toEqual({ ok: true });
  });
});
describe('link/mention caps', () => {
  it('counts urls, @mentions and mints', () => {
    expect(linkMentionCount(`@a_b_c https://x.io ${MINT} plain`)).toBe(3);
  });
  it('new accounts are < 24h old', () => {
    const now = new Date('2026-10-09T12:00:00Z');
    expect(isNewAccount(new Date('2026-10-09T00:00:00Z'), now)).toBe(true);
    expect(isNewAccount(new Date('2026-10-08T11:00:00Z'), now)).toBe(false);
  });
});
