import { describe, it, expect } from 'vitest';
import { avatarSvg, tokenSvg, bannerSvg, artSvg } from '../src/lib/svg-art.ts';

describe('svg-art', () => {
  it('never emits undefined or NaN for many seeds', () => {
    for (let i = 0; i < 2000; i++) {
      const seed = `seed-${i}`;
      for (const fn of [avatarSvg, tokenSvg, bannerSvg, artSvg]) {
        const out = fn(seed);
        expect(out).not.toContain('undefined');
        expect(out).not.toContain('NaN');
      }
    }
  });
});
