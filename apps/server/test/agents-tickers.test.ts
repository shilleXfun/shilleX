import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../src/seed/rng.ts';
import { WORDS, coinName, grudgeWords, launchWords, pickSymbol, postWords } from '../src/agents/tickers.ts';
import { CLOSERS, FALLBACK_LINES, FALLBACK_SITUATIONS, OPENERS, WEATHER_WORD, closerTail, fillLine, openerJoin } from '../src/agents/phrasebook.ts';
import { NOTABLE, eventText } from '../src/agents/depth/memory.ts';

/** Every text the engine itself can put in a post: each stock line with each weather word, with openers and closers, and every memory a callback recalls, on any day. */
function stockTexts(): string[] {
  const now = new Date('2026-10-12T13:00:00Z');
  const memories = NOTABLE.flatMap((kind) => Array.from({ length: 10 }, (_, days) => eventText({ kind,
    data: { byId: 'a', targetId: 'a', borrowerId: 'a', otherId: 'a', symbol: 'MOTH', pct: 40, name: '', stance: days % 2 ? 1 : -1 },
    at: new Date(now.getTime() - days * 86_400_000) }, new Map([['a', 'lamp_9']]), now)?.text ?? ''));
  const lines = FALLBACK_SITUATIONS.flatMap((s) => FALLBACK_LINES[s]).flatMap((l) => [...Object.values(WEATHER_WORD), ...memories].map((x) =>
    fillLine(l, { coin: '$MOTH', user: '@lamp_9', pct: 12, sol: '0.010', price: '0.93 lamports', holders: 4, room: 'trenches', weather: x, past: x })!));
  return [...lines, ...memories, ...OPENERS.map((o) => `${o}${openerJoin(o)}x`), ...CLOSERS.map((c) => `x${closerTail(c)}`)];
}

describe('tickers (L3)', () => {
  it('prefers the agent’s own words: interests first, then its posts, never trading filler', () => {
    const words = launchWords({ interests: ['late night charts', 'Lamp'], ownPosts: ['bought some $DRIFT, lanterns at midnight', 'owls know'], grudges: [] }, mulberry32(1));
    expect(words.slice(0, 3)).toEqual(['late', 'night', 'lamp']);
    expect(postWords(['bought some $DRIFT, lanterns at midnight', 'owls never blink'])).toEqual(['lanterns', 'midnight', 'owls', 'blink']);
    expect(postWords(['gm @lamp_9, $MOTH is velvety', 'Velvety again'])).toEqual(['velvety']);
  });
  it('never draws a ticker from the engine’s own stock lines, sentiment words or memory phrasing (engine I2)', () => {
    const stock = stockTexts();
    expect(stock.length).toBeGreaterThan(2000);
    expect(postWords(stock)).toEqual([]);
    expect(postWords(['said', 'same', 'why', 'agreed', 'seconded', 'noted', 'everyone', 'position', 'staring', 'rugged', 'dead', 'holding', 'moon', 'diamond', 'dumped', 'bullish', 'tuesday'])).toEqual([]);
    // With nothing of its own (a fallback book has no interests), an agent names its coins from the plain word list.
    const r = mulberry32(5), taken = new Set<string>();
    const plain = new Set(WORDS.map((w) => w.toUpperCase()));
    for (let i = 0; i < 40; i++) {
      const s = pickSymbol(launchWords({ interests: [], ownPosts: stock.slice(i * 50, i * 50 + 20), grudges: [] }, r), taken, r);
      expect(plain.has(s), s).toBe(true);
      taken.add(s);
    }
    // A model's interests are its own words: they keep a noun a stock line also has ("coffee") and lose the sentiment words.
    expect(launchWords({ interests: ['moon missions', 'diamond lamps', 'coffee'], ownPosts: ['charts first, coffee second'], grudges: [] }, r).slice(0, 3)).toEqual(['missions', 'lamps', 'coffee']);
    expect(postWords(['charts first, coffee second'])).toEqual([]);
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
