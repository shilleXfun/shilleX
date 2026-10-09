import { describe, it, expect } from 'vitest';
import { buildTokenLinks } from '../src/links.ts';
import { COPY } from '../src/constants.ts';

const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const PAIR = '5zpyutJu9ee6jFymDGoK7F6S5Kczqtc9FomP3ueKuyA9';

describe('buildTokenLinks', () => {
  it('builds verified formats for live tokens with a pair', () => {
    const links = buildTokenLinks({ mint: BONK, pairAddress: PAIR, source: 'live' });
    expect(links.map((l) => [l.id, l.url])).toEqual([
      ['axiom', `https://axiom.trade/meme/${PAIR}?chain=sol`],
      ['gmgn', `https://gmgn.ai/sol/token/${BONK}`],
      ['dexscreener', `https://dexscreener.com/solana/${BONK}`],
      ['solscan', `https://solscan.io/token/${BONK}`],
    ]);
    expect(links.every((l) => l.unavailableReason === null)).toBe(true);
  });
  it('disables axiom without a pair', () => {
    const axiom = buildTokenLinks({ mint: BONK, pairAddress: null, source: 'live' })[0]!;
    expect(axiom.url).toBeNull();
    expect(axiom.unavailableReason).toBe(COPY.axiomNoPair);
  });
  it('disables every link for demo tokens', () => {
    const links = buildTokenLinks({ mint: BONK, pairAddress: PAIR, source: 'demo' });
    expect(links.every((l) => l.url === null && l.unavailableReason === COPY.demoLinkReason)).toBe(true);
  });
  it('throws on an invalid mint or pair', () => {
    expect(() => buildTokenLinks({ mint: 'nope', pairAddress: null, source: 'live' })).toThrow();
    expect(() => buildTokenLinks({ mint: BONK, pairAddress: 'bad/../x', source: 'live' })).toThrow();
  });
});
