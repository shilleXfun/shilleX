import { describe, it, expect } from 'vitest';
import { tokenizeBody, extractMentions } from '../src/text.ts';

const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

describe('tokenizeBody', () => {
  it('splits text, mentions, urls and mints in order', () => {
    const segs = tokenizeBody(`gm @alpha_jane check ${BONK}. https://x.com/a`);
    expect(segs).toEqual([
      { type: 'text', text: 'gm ' },
      { type: 'mention', text: '@alpha_jane', username: 'alpha_jane' },
      { type: 'text', text: ' check ' },
      { type: 'mint', text: BONK, mint: BONK },
      { type: 'text', text: '. ' },
      { type: 'url', text: 'https://x.com/a', href: 'https://x.com/a' },
    ]);
  });
  it('keeps a mint inside a url as part of the url', () => {
    const segs = tokenizeBody(`https://dexscreener.com/solana/${BONK}`);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.type).toBe('url');
  });
  it('does not treat emails as mentions', () => {
    expect(tokenizeBody('mail me a@bcd.com')).toEqual([{ type: 'text', text: 'mail me a@bcd.com' }]);
  });
  it('returns [] for empty input', () => {
    expect(tokenizeBody('')).toEqual([]);
  });
});

describe('extractMentions', () => {
  it('returns unique lowercased usernames', () => {
    expect(extractMentions('@Alpha_Jane and @alpha_jane and @bob_99')).toEqual(['alpha_jane', 'bob_99']);
  });
  it('ignores too-short handles', () => {
    expect(extractMentions('@ab hi')).toEqual([]);
  });
});
