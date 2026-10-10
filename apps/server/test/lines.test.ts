import { describe, it, expect } from 'vitest';
import { CHAT_LINES, CHAT_REPLIES, DM_LINES, POST_LINES, REPLY_LINES, TOPIC_LINES, chatPool, fill, lineDrawer, lineMatcher, pickFresh } from '../src/seed/lines.ts';
import { mulberry32 } from '../src/seed/rng.ts';
import { COMMUNITIES, DEMO_TOKENS } from '../src/seed/world.ts';

const tok = DEMO_TOKENS[0]!;
const filled = (l: string, user = 'someone') => fill(l, { mint: tok.mint, symbol: tok.symbol, user });

describe('demo line pools', () => {
  it('have no duplicate lines', () => {
    for (const pool of [POST_LINES, CHAT_LINES, REPLY_LINES, CHAT_REPLIES, DM_LINES, ...Object.values(TOPIC_LINES)]) expect(new Set(pool).size).toBe(pool.length);
  });
  it('only key topic lines by channels that exist', () => {
    const channels = new Set(COMMUNITIES.flatMap((c) => c.channels.map((ch) => `${c.slug}/${ch.name}`)));
    for (const key of Object.keys(TOPIC_LINES)) expect(channels).toContain(key);
  });
  it('weights a room’s topic lines into its chat pool', () => {
    const pool = chatPool('mascot-club', 'lore');
    expect(pool.filter((l) => TOPIC_LINES['mascot-club/lore']!.includes(l)).length).toBe(4 * TOPIC_LINES['mascot-club/lore']!.length);
    expect(chatPool('trenches', 'general')).toEqual(CHAT_LINES);
  });
});

describe('lineMatcher', () => {
  it('recognises a filled line, with or without an appended CA, and nothing else', () => {
    const line = 'not touching {TOKEN} until the LP situation is explained. happy to be wrong.';
    expect(lineMatcher(line).test(filled(line))).toBe(true);
    expect(lineMatcher('{USER} welcome back').test(filled('{USER} welcome back', 'fresh_fern'))).toBe(true);
    expect(lineMatcher('the {SYM} community is genuinely funny.').test(`${filled('the {SYM} community is genuinely funny.')}\n\nCA: ${tok.mint}`)).toBe(true);
    expect(lineMatcher('lol').test('lol accurate')).toBe(false);
  });
});

describe('pickFresh', () => {
  it('never picks a line used recently while a fresh one exists', () => {
    const r = mulberry32(1);
    const lines = ['a {SYM}', 'b', 'c'];
    for (let i = 0; i < 50; i++) expect(pickFresh(r, lines, [filled('a {SYM}'), 'b'])).toBe('c');
  });
  it('falls back to the least recently used line when all were used', () => {
    expect(pickFresh(mulberry32(2), ['a', 'b', 'c'], ['b', 'a', 'c'])).toBe('b');
  });
});

describe('lineDrawer', () => {
  it('does not repeat within its window, even with weighted duplicates', () => {
    const draw = lineDrawer(mulberry32(3), ['a', 'a', 'a', 'b', 'c', 'd', 'e'], 3);
    const seq = Array.from({ length: 200 }, draw);
    for (let i = 0; i < seq.length; i++) expect(seq.slice(Math.max(0, i - 3), i)).not.toContain(seq[i]);
  });
  it('still works with a single line', () => {
    const draw = lineDrawer(mulberry32(4), ['only'], 10);
    expect([draw(), draw()]).toEqual(['only', 'only']);
  });
});
