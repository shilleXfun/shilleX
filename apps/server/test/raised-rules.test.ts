import { describe, it, expect } from 'vitest';
import { blocklisted } from '../src/lib/blocklist.ts';
import { checkHandle, checkWish, clampTraits } from '../src/agents/raised/rules.ts';

const config = { adminUsernames: ['admin'] };

describe('checkWish', () => {
  it('accepts plain words and tidies the whitespace', () => {
    expect(checkWish('  a calm   lighthouse keeper\nwho loves tide charts ')).toEqual({ ok: true, wish: 'a calm lighthouse keeper who loves tide charts' });
  });
  it.each([
    ['', 'empty'], ['   ', 'empty'], [42, 'empty'], ['x'.repeat(281), 'length'],
    ['loves https://evil.example', 'link'], ['see www.example', 'link'], ['visit evil.com daily', 'link'],
    ['friend of @someone', 'mention'], ['friend of ＠someone', 'mention'],
    ['pumps $MOON all day', 'cashtag'], ['<b>bold</b>', 'markup'],
    ['quiet​ one', 'control'], ['‮evil', 'control'], ['bell\u0007', 'control'],
    ['loves porn', 'blocked'], ['p0rn star', 'blocked'], ['a s e x bot', 'blocked'], ['NSFW only', 'blocked'],
  ])('refuses %j as %s', (raw, rule) => {
    const r = checkWish(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.rule).toBe(rule); expect(r.message.length).toBeGreaterThan(5); }
  });
  it('keeps words that only contain a blocked word', () => {
    expect(checkWish('a classy assistant who studies analysis and sextants').ok).toBe(true);
  });
  it('counts code points: 280 emoji pass, 281 do not', () => {
    expect(checkWish('🌊'.repeat(280)).ok).toBe(true);
    expect(checkWish('🌊'.repeat(281)).ok).toBe(false);
  });
});

describe('blocklisted', () => {
  it('folds case, NFKC and leetspeak', () => {
    expect(blocklisted('PORN')).toBe(true);
    expect(blocklisted('ｐｏｒｎ')).toBe(true);
    expect(blocklisted('n5fw')).toBe(true);
    expect(blocklisted('portion control')).toBe(false);
  });
});

describe('checkHandle', () => {
  it('accepts 3-20 letters, digits or underscores', () => {
    expect(checkHandle(config, ' tide_watch ')).toEqual({ ok: true, handle: 'tide_watch' });
  });
  it.each([['ab', 'HANDLE_INVALID'], ['has space', 'HANDLE_INVALID'], ['x'.repeat(21), 'HANDLE_INVALID'], [null, 'HANDLE_INVALID'],
    ['admin', 'USERNAME_RESERVED'], ['New', 'USERNAME_RESERVED'], ['graph', 'USERNAME_RESERVED'],
    ['agent_07', 'USERNAME_RESERVED'], ['Agent_51', 'USERNAME_RESERVED'], ['shillex', 'USERNAME_RESERVED'], ['shil_lex', 'USERNAME_RESERVED'],
  ])('refuses %j with %s', (raw, code) => {
    const r = checkHandle(config, raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(code);
  });
});

describe('clampTraits', () => {
  it('keeps every trait within 0.1..0.9', () => {
    expect(clampTraits({ risk: 1, chattiness: 0, loyalty: 0.5, pettiness: 0.95, greed: 0.05, humor: 0.4, curiosity: 0.9 }))
      .toEqual({ risk: 0.9, chattiness: 0.1, loyalty: 0.5, pettiness: 0.9, greed: 0.1, humor: 0.4, curiosity: 0.9 });
  });
});
