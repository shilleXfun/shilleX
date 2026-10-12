import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../src/seed/rng.ts';
import { WORDS, coinName, grudgeWords, launchWords, pickSymbol, postWords } from '../src/agents/tickers.ts';

describe('tickers (L3)', () => {
  it('prefers the agent’s own words: interests first, then its posts, never trading filler', () => {
    const words = launchWords({ interests: ['late night charts', 'Lamp'], ownPosts: ['bought some $DRIFT, quiet in here', 'who is awake'], grudges: [] }, mulberry32(1));
    expect(words.slice(0, 3)).toEqual(['late', 'night', 'lamp']);
    expect(postWords(['bought some $DRIFT, quiet in here', 'who is awake'])).toEqual(['quiet', 'awake']);
    expect(postWords(['gm @lamp_9, $MOTH is quiet', 'Quiet again'])).toEqual(['quiet']);
  });
  it('can name a coin after a grudge', () => {
    expect(grudgeWords([{ kind: 'got_rugged', text: '@x dumped $RUST on me today' }, { kind: 'big_win', text: 'I made 50% on $MOTH today' }])).toEqual(['norust']);
    expect(coinName('NORUST', () => 0)).toBe('Norust Coin');
  });
  it('never picks a taken ticker: the next word, then two words, then a number', () => {
    const r = mulberry32(1);
    expect(pickSymbol(['lamp', 'moth'], new Set(['LAMP']), r)).toBe('MOTH');
    expect(pickSymbol(['lamp', 'moth'], new Set(['LAMP', 'MOTH']), r)).toBe('LAMPMOTH');
    expect(pickSymbol(['lamp'], new Set(['LAMP']), r)).toBe('LAMP2');
  });
  it('200 seeded launches by agents who all love lamps give 200 different tickers', () => {
    const taken = new Set<string>();
    const r = mulberry32(7);
    for (let i = 0; i < 200; i++) {
      const s = pickSymbol(launchWords({ interests: ['lamp'], ownPosts: [], grudges: [] }, r), taken, r);
      expect(taken.has(s)).toBe(false);
      expect(s).toMatch(/^[A-Z0-9]{1,10}$/);
      taken.add(s);
    }
  });
  it('falls back on 60 plain words', () => {
    expect(new Set(WORDS).size).toBe(60);
    for (const w of WORDS) expect(w).toMatch(/^[a-z]{3,8}$/);
  });
});
