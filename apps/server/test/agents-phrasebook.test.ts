import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testDb } from './helpers.ts';
import type { DbHandle } from '../src/db/client.ts';
import { phrasebooks, users } from '../src/db/schema.ts';
import { newId } from '../src/lib/ids.ts';
import { mulberry32 } from '../src/seed/rng.ts';
import { FALLBACK_LINES, FALLBACK_SITUATIONS, LINES_PER_AGENT, LINES_PER_AGENT_FOR, WEATHER_WORD, closerFits, composeLine, fallbackPhrasebook, feedSeen, fillLine, lineKey, phrasebookOf } from '../src/agents/phrasebook.ts';
import { stanceOf } from '../src/agents/depth/beliefs.ts';
import { normalizeBody } from '../src/services/moderation.ts';
import { seededTraits } from '../src/agents/state.ts';
import type { Phrasebook, Situation } from '../src/agents/types.ts';

let h: DbHandle;
beforeAll(async () => { h = await testDb(); });
afterAll(() => h.close());

describe('fallback phrasebook', () => {
  it('has at least 14 lines for every situation, all using known slots', () => {
    expect(FALLBACK_SITUATIONS).toHaveLength(25);
    for (const s of FALLBACK_SITUATIONS) {
      expect(FALLBACK_LINES[s].length).toBeGreaterThanOrEqual(14);
      for (const l of FALLBACK_LINES[s]) for (const m of l.matchAll(/\{(\w+)\}/g)) expect(['coin', 'user', 'pct', 'sol', 'price', 'holders', 'room', 'weather', 'past', 'topic']).toContain(m[1]);
    }
  });
  it('is deterministic per seed and differs between agents', () => {
    const a = fallbackPhrasebook('agent-a');
    expect(fallbackPhrasebook('agent-a')).toEqual(a);
    expect(fallbackPhrasebook('agent-b')).not.toEqual(a);
    expect(a.traits).toEqual(seededTraits('agent-a'));
    for (const s of FALLBACK_SITUATIONS) expect(a.lines[s]!.length).toBe(LINES_PER_AGENT_FOR[s] ?? LINES_PER_AGENT);
  });
  it('phrasebookOf returns the stored book, or the fallback when there is none', async () => {
    const id = newId();
    await h.db.insert(users).values({ id, username: 'pb_a', displayName: 'pb', kind: 'agent', createdAt: new Date() });
    expect(await phrasebookOf(h.db, id)).toEqual(fallbackPhrasebook(id));
    const book: Phrasebook = { ...fallbackPhrasebook(id), voice: 'loud and short' };
    await h.db.insert(phrasebooks).values({ agentId: id, version: 1, book, model: 'claude-haiku-5-5', writtenAt: new Date() });
    expect((await phrasebookOf(h.db, id)).voice).toBe('loud and short');
  });
});

describe('fillLine and composeLine', () => {
  it('fills slots and refuses lines whose slots have no value', () => {
    expect(fillLine('bought {coin} for {sol} SOL', { coin: '$MOTH', sol: '0.010' })).toBe('bought $MOTH for 0.010 SOL');
    expect(fillLine('bought {coin}', {})).toBeNull();
    expect(fillLine('gm', {})).toBe('gm');
  });
  it('never reuses a line key from the recent list, and returns null when every line was used', () => {
    const pb: Phrasebook = { ...fallbackPhrasebook('x'), openers: [], closers: [], lines: { gm: ['gm one', 'gm two'] } };
    const rng = mulberry32(1);
    const first = composeLine(pb, 'gm', {}, [], rng)!;
    const second = composeLine(pb, 'gm', {}, [first.key], rng)!;
    expect(second.key).not.toBe(first.key);
    expect(composeLine(pb, 'gm', {}, [first.key, second.key], rng)).toBeNull();
  });
  it('prefers the book’s own lines over the fallback, and stays under 500 characters', () => {
    const pb: Phrasebook = { ...fallbackPhrasebook('x'), lines: { idle: ['my own words'] }, openers: ['ok'], closers: ['lol'] };
    for (let i = 0; i < 20; i++) {
      const r = composeLine(pb, 'idle', {}, [], mulberry32(i))!;
      expect(r.text).toContain('my own words');
      expect(r.key).toBe(lineKey('idle', 'my own words'));
      expect(r.template).toBe('my own words');
      expect(r.text.length).toBeLessThanOrEqual(500);
    }
  });
  it('falls back to the built-in lines for a situation the book lacks', () => {
    const pb: Phrasebook = { ...fallbackPhrasebook('x'), lines: {}, openers: [], closers: [] };
    const r = composeLine(pb, 'gm', {}, [], mulberry32(3))!;
    expect(FALLBACK_LINES.gm.map((l) => lineKey('gm', l))).toContain(r.key);
  });
});

describe('many voices (L6)', () => {
  it('gives each agent its own 8 of 14+ lines per situation, and 5 openers and closers', () => {
    expect(LINES_PER_AGENT).toBe(8);
    const a = fallbackPhrasebook('agent-a'), b = fallbackPhrasebook('agent-b');
    const differ = FALLBACK_SITUATIONS.filter((s) => [...a.lines[s]!].sort().join('|') !== [...b.lines[s]!].sort().join('|'));
    expect(differ.length).toBeGreaterThanOrEqual(20);
    expect(a.openers).toHaveLength(5);
    expect(a.closers).toHaveLength(5);
  });
  it('gives every agent at least 10 fresh agreeing replies to a mention before it runs dry (Task S finding 3)', () => {
    let worst = Infinity;
    for (let i = 0; i < 50; i++) {
      const pb = fallbackPhrasebook(`agent-${i}`);
      const recent: string[] = [];
      // A mention reply fills {user} but never {coin}.
      for (let r = composeLine(pb, 'reply_agree', { user: '@lamp' }, recent, mulberry32(i)); r; r = composeLine(pb, 'reply_agree', { user: '@lamp' }, recent, mulberry32(i))) recent.push(r.key);
      worst = Math.min(worst, recent.length);
    }
    expect(worst).toBeGreaterThanOrEqual(10);
  });
  it('keeps report lines free of bullish or bearish words, so posting one is never a call on the coin', () => {
    for (const s of ['bought', 'sold', 'took_profit', 'rugged_someone', 'launching', 'market_take', 'idle', 'gm', 'reply_agree', 'reply_disagree'] as const) {
      for (const l of FALLBACK_LINES[s]) expect([0, null]).toContain(stanceOf(l.replaceAll('{coin}', '$TEST'), 'TEST'));
    }
  });
  it('skips a line already on the feed (any case or spacing), and stays quiet when every fresh line is there', () => {
    const pb: Phrasebook = { ...fallbackPhrasebook('x'), openers: [], closers: [], lines: { gm: ['gm one', 'gm two'] } };
    for (let s = 0; s < 20; s++) expect(composeLine(pb, 'gm', {}, [], mulberry32(s), new Set([normalizeBody('GM   One')]))!.text).toBe('gm two');
    expect(composeLine(pb, 'gm', {}, [], mulberry32(1), new Set(['gm one', 'gm two']))).toBeNull();
  });
  it('never ends a sad line cheerfully or a happy one sadly', () => {
    const pb: Phrasebook = { ...fallbackPhrasebook('x'), openers: [], closers: ['wagmi', 'rip'], lines: { dumping: ['{coin} red again'], pumping: ['{coin} woke up'] } };
    const say = (s: 'dumping' | 'pumping') => Array.from({ length: 200 }, (_, i) => composeLine(pb, s, { coin: '$X' }, [], mulberry32(i))!.text);
    const sad = say('dumping'), happy = say('pumping');
    const ends = (t: string, w: string) => t.endsWith(` ${w}`) || t.endsWith(` ${w}.`);
    expect(sad.some((t) => ends(t, 'rip'))).toBe(true);
    expect(sad.some((t) => ends(t, 'wagmi'))).toBe(false);
    expect(happy.some((t) => ends(t, 'wagmi'))).toBe(true);
    expect(happy.some((t) => ends(t, 'rip'))).toBe(false);
    expect(closerFits('bought', 'ngmi')).toBe(true);
    expect(closerFits('dumping', 'gm')).toBe(false);
  });
  it('names the weather with a mood word', () => {
    expect(WEATHER_WORD).toEqual({ euphoria: 'giddy', grind: 'slow', fear: 'jumpy', chaos: 'unhinged' });
  });
});

describe('openers and closers sit right on the line (L6b)', () => {
  const book = (lines: Partial<Record<Situation, string[]>>, openers: string[], closers: string[]): Phrasebook => ({ ...fallbackPhrasebook('x'), lines, openers, closers });
  /** Every composed text over many seeds, so a decoration that is rolled sometimes shows up. */
  const sayMany = (pb: Phrasebook, situation: Situation, slots: Record<string, string | number> = {}, n = 400, avoid?: Set<string>) =>
    Array.from({ length: n }, (_, i) => composeLine(pb, situation, slots, [], mulberry32(i), avoid)!.text);

  it('never puts a closer after a finished sentence or an emoji', () => {
    for (const line of ['all done.', 'who is awake?', 'we are early!', 'wen moon 🚀', 'trimmed it…']) {
      const texts = sayMany(book({ idle: [line] }, [], ['lol', 'pain', '🫡']), 'idle');
      expect(texts, line).toEqual(texts.map(() => line));
    }
  });
  it('joins each closer its own way: a comma, its own short sentence, a dash or a space, never glued', () => {
    const closing = (closer: string) => sayMany(book({ idle: ['bought some $DRIFT'] }, [], [closer]), 'idle').filter((t) => t !== 'bought some $DRIFT');
    expect(new Set(closing('pain'))).toEqual(new Set(['bought some $DRIFT. pain.']));
    expect(new Set(closing('lol'))).toEqual(new Set(['bought some $DRIFT, lol']));
    expect(new Set(closing('we will see'))).toEqual(new Set(['bought some $DRIFT — we will see']));
    expect(new Set(closing('🫡'))).toEqual(new Set(['bought some $DRIFT 🫡']));
    expect(new Set(closing('touch grass'))).toEqual(new Set(['bought some $DRIFT, touch grass'])); // a closer a model wrote
  });
  it('keeps a closer off a line that already ends like one, or already says its word', () => {
    expect(new Set(sayMany(book({ idle: ['awake early. gm'] }, [], ['lol', 'ok']), 'idle'))).toEqual(new Set(['awake early. gm']));
    expect(new Set(sayMany(book({ dumping: ['pain in {coin}'] }, [], ['pain']), 'dumping', { coin: '$X' }))).toEqual(new Set(['pain in $X']));
    expect(sayMany(book({ dumping: ['pain in {coin}'] }, [], ['pain', 'rip']), 'dumping', { coin: '$X' })).toContain('pain in $X. rip.');
  });
  it('keeps an opener off a line that already starts with a greeting or an interjection', () => {
    for (const line of ['gm everyone, still here', 'good morning, everyone', 'ok then, watching $X', 'alright gm. who slept', 'so here we are', 'honestly just tired today', 'lol the feed is wild']) {
      const texts = sayMany(book({ idle: [line] }, ['quick one', 'update', 'real talk', 'btw'], []), 'idle');
      expect(new Set(texts), line).toEqual(new Set([line]));
    }
    // ...and goes on a plain one, with its own punctuation.
    expect(sayMany(book({ idle: ['the chart is a mood ring'] }, ['honestly'], []), 'idle')).toContain('honestly, the chart is a mood ring');
    expect(sayMany(book({ idle: ['the chart is a mood ring'] }, ['real talk'], []), 'idle')).toContain('real talk: the chart is a mood ring');
    expect(sayMany(book({ idle: ['the chart is a mood ring'] }, ['ok'], []), 'idle')).toContain('ok the chart is a mood ring');
  });
  it('keeps openers to statements: no "real talk: welcome @lamp"', () => {
    const texts = sayMany(book({ welcome: ['welcome to shillex friend'], thank: ['thanks for the help friend'] }, ['honestly', 'real talk'], []), 'welcome');
    expect(new Set(texts)).toEqual(new Set(['welcome to shillex friend']));
    expect(new Set(sayMany(book({ thank: ['thanks for the help friend'] }, ['honestly'], []), 'thank'))).toEqual(new Set(['thanks for the help friend']));
  });
  it('never puts an opener and a closer on a line shorter than four words', () => {
    const short = sayMany(book({ idle: ['quiet in here'] }, ['honestly'], ['lol']), 'idle', {}, 2000);
    expect(short.some((t) => t.startsWith('honestly,'))).toBe(true);
    expect(short.some((t) => t.endsWith(', lol'))).toBe(true);
    expect(short.filter((t) => t.startsWith('honestly,') && t.endsWith(', lol'))).toEqual([]);
    const long = sayMany(book({ idle: ['quiet in here tonight'] }, ['honestly'], ['lol']), 'idle', {}, 2000);
    expect(long.some((t) => t.startsWith('honestly,') && t.endsWith(', lol'))).toBe(true);
  });
  it('falls back to the bare line when its decorated form is already on the feed', () => {
    const pb = book({ idle: ['the chart is a mood ring'] }, [], ['lol']);
    const decorated = sayMany(pb, 'idle').find((t) => t.endsWith(', lol'))!;
    expect(decorated).toBeTruthy();
    expect(sayMany(pb, 'idle', {}, 400, new Set([normalizeBody(decorated)]))).not.toContain(decorated);
  });
  it('reads the feed into the normalized set composeLine avoids', () => {
    expect(feedSeen([{ body: 'GM   Frens' }, { body: 'second post' }])).toEqual(new Set(['gm frens', 'second post']));
    expect(feedSeen(undefined)).toEqual(new Set());
  });
  it('welcomes a human without a mournful closer', () => {
    expect(closerFits('reply_human', 'ngmi')).toBe(false);
    expect(closerFits('reply_human', 'wagmi')).toBe(true);
    expect(closerFits('thank', 'whatever')).toBe(false);
  });
});
