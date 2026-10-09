import { describe, it, expect } from 'vitest';
import { isValidSolanaAddress, extractMintCandidates, uniqueMints, abbreviateMint } from '../src/mint.ts';

const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const WSOL = 'So11111111111111111111111111111111111111112';

describe('isValidSolanaAddress', () => {
  it('accepts real 32-byte addresses', () => {
    expect(isValidSolanaAddress(BONK)).toBe(true);
    expect(isValidSolanaAddress(WSOL)).toBe(true);
  });
  it('rejects non-base58 characters', () => {
    expect(isValidSolanaAddress(BONK.replace('D', '0'))).toBe(false);
    expect(isValidSolanaAddress(BONK.replace('D', 'l'))).toBe(false);
  });
  it('rejects base58 strings that do not decode to 32 bytes', () => {
    expect(isValidSolanaAddress('z'.repeat(44))).toBe(false); // 33 bytes
    expect(isValidSolanaAddress('2'.repeat(32))).toBe(false); // < 32 bytes
    expect(isValidSolanaAddress('abc')).toBe(false);
  });
});

describe('extractMintCandidates', () => {
  it('finds a mint with positions', () => {
    const text = `aping ${BONK} now`;
    expect(extractMintCandidates(text)).toEqual([{ mint: BONK, start: 6, end: 6 + BONK.length }]);
  });
  it('ignores tickers and ordinary words', () => {
    expect(extractMintCandidates('$BONK is pumping, gm frens')).toEqual([]);
  });
  describe('punctuation and URLs (Review Focus #1)', () => {
    it('handles trailing period, parentheses and comma-joined mints', () => {
      expect(uniqueMints(`CA: ${BONK}.`)).toEqual([BONK]);
      expect(uniqueMints(`(${BONK})`)).toEqual([BONK]);
      expect(uniqueMints(`${BONK},${WSOL}`)).toEqual([BONK, WSOL]);
    });
    it('does not extract mints embedded in a URL', () => {
      expect(uniqueMints(`chart https://dexscreener.com/solana/${BONK} lol`)).toEqual([]);
    });
    it('does not match when glued to other alphanumerics', () => {
      expect(uniqueMints(`x${BONK}`)).toEqual([]);
      expect(uniqueMints(`${BONK}0`)).toEqual([]);
    });
    it('rejects 44-char base58 that decodes to 33 bytes', () => {
      expect(uniqueMints(`look ${'z'.repeat(44)} here`)).toEqual([]);
    });
  });
  it('uniqueMints deduplicates and keeps first-seen order', () => {
    expect(uniqueMints(`${WSOL} ${BONK} ${WSOL}`)).toEqual([WSOL, BONK]);
  });
});

describe('abbreviateMint', () => {
  it('keeps head and tail', () => {
    expect(abbreviateMint(BONK)).toBe('DezX…B263');
    expect(abbreviateMint(BONK, 6, 4)).toBe('DezXAZ…B263');
  });
});
