import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testDb } from './helpers.ts';
import type { DbHandle } from '../src/db/client.ts';
import { phrasebooks, users } from '../src/db/schema.ts';
import { newId } from '../src/lib/ids.ts';
import { mulberry32 } from '../src/seed/rng.ts';
import { FALLBACK_LINES, FALLBACK_SITUATIONS, LINES_PER_AGENT, WEATHER_WORD, closerFits, composeLine, fallbackPhrasebook, fillLine, lineKey, phrasebookOf } from '../src/agents/phrasebook.ts';
import { stanceOf } from '../src/agents/depth/beliefs.ts';
import { normalizeBody } from '../src/services/moderation.ts';
import { seededTraits } from '../src/agents/state.ts';
import type { Phrasebook } from '../src/agents/types.ts';

let h: DbHandle;
beforeAll(async () => { h = await testDb(); });
afterAll(() => h.close());

describe('fallback phrasebook', () => {
  it('has at least 14 lines for every situation, all using known slots', () => {
    expect(FALLBACK_SITUATIONS).toHaveLength(24);
    for (const s of FALLBACK_SITUATIONS) {
      expect(FALLBACK_LINES[s].length).toBeGreaterThanOrEqual(14);
      for (const l of FALLBACK_LINES[s]) for (const m of l.matchAll(/\{(\w+)\}/g)) expect(['coin', 'user', 'pct', 'sol', 'price', 'holders', 'room', 'weather', 'past']).toContain(m[1]);
    }
  });
  it('is deterministic per seed and differs between agents', () => {
    const a = fallbackPhrasebook('agent-a');
    expect(fallbackPhrasebook('agent-a')).toEqual(a);
    expect(fallbackPhrasebook('agent-b')).not.toEqual(a);
    expect(a.traits).toEqual(seededTraits('agent-a'));
    for (const s of FALLBACK_SITUATIONS) expect(a.lines[s]!.length).toBe(LINES_PER_AGENT);
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
    expect(sad.some((t) => t.endsWith(' rip'))).toBe(true);
    expect(sad.some((t) => t.endsWith(' wagmi'))).toBe(false);
    expect(happy.some((t) => t.endsWith(' wagmi'))).toBe(true);
    expect(happy.some((t) => t.endsWith(' rip'))).toBe(false);
    expect(closerFits('bought', 'ngmi')).toBe(true);
    expect(closerFits('dumping', 'gm')).toBe(false);
  });
  it('names the weather with a mood word', () => {
    expect(WEATHER_WORD).toEqual({ euphoria: 'giddy', grind: 'slow', fear: 'jumpy', chaos: 'unhinged' });
  });
});
