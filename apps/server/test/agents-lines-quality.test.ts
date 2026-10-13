import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../src/seed/rng.ts';
import { eventText, NOTABLE } from '../src/agents/depth/memory.ts';
import { CLOSERS, FALLBACK_LINES, FALLBACK_SITUATIONS, OPENERS, WEATHER_WORD, closerTail, composeLine, fallbackPhrasebook, fillLine, openerJoin } from '../src/agents/phrasebook.ts';
import type { Phrasebook, Situation } from '../src/agents/types.ts';

// What a visitor reads must look like a person wrote it. These are properties over many composed lines, so a new line, opener
// or closer that glues, doubles or misspeaks fails here whatever the situation. The hot loops only collect problems (plain
// checks, no expect() per line); each test asserts once, on the first few.

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ANY_CLOSER = [...CLOSERS, 'gm'].filter((c) => /^\p{L}/u.test(c)).map(esc).join('|'); // words only: an emoji after a space is fine
const ANY_INTERJECTION = ['gm', 'good morning', 'ok', 'okay', 'alright', 'so', 'honestly', 'lol', 'look', 'well', 'fine', 'anyway', 'real talk', 'not gonna lie', 'quick one', 'update', 'hm', 'btw'].map(esc).join('|');
const VERBS = 'bought|sold|picked up|grabbed|trimmed|launched|added|tried|cashed|closed|cut|banked|locked|took|joined|put|made|stepped|retired|lightened';

/** The shapes the review found, plus the ones they imply. Each must match nothing a visitor can read. */
const BAD_SHAPES: [string, RegExp][] = [
  ['a closer glued to a ticker ("bought some $DRIFT pain")', new RegExp(`\\$[A-Za-z0-9]+ (?:${ANY_CLOSER})(?![\\p{L}\\p{N}])`, 'iu')],
  ['a closer glued to a verb phrase', new RegExp(`\\b(?:${VERBS})\\b[^.,;:!?—]* (?:${ANY_CLOSER})\\.?$`, 'iu')],
  ['two interjections in a row at the start ("alright gm", "ok ok")', new RegExp(`^(?:${ANY_INTERJECTION})[ ,:]+(?:${ANY_INTERJECTION}|okay|good morning)(?![\\p{L}\\p{N}])`, 'iu')],
  ['two closers in a row', new RegExp(`(?<![\\p{L}\\p{N}])(?:${ANY_CLOSER})(?:, | — | |\\. )(?:${ANY_CLOSER})\\.?$`, 'iu')],
  ['"a" before a vowel ("a unhinged")', /\ba [aeiou]/i],
  ['"an" before a consonant', /\ban [^aeiou\s]/i],
  ['a word said twice in a row', /\b(\p{L}{2,}) \1\b/iu],
  ['stray spacing or punctuation', /\s{2,}|\s,|,\s*,|^\s|\s$|\{|\}|undefined|null/],
];

const FINISHED = /[.!?…]$|\p{Extended_Pictographic}$/u;
const GREETING_START = /^(?:gm|good morning|ok|alright|so|honestly|lol)(?![\p{L}\p{N}])/iu;
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
/** What composeLine may put before and after a line, as the exact strings it should produce. */
const OPENER_HEADS = new Set(OPENERS.map((o) => `${o}${openerJoin(o)}`));
const CLOSER_TAILS = new Set(CLOSERS.map(closerTail));

/** Everything wrong with one composed text, as plain strings (empty when it reads well). */
function problems(text: string, template: string, slots: Record<string, string | number>, label: string): string[] {
  const out: string[] = [];
  const fail = (what: string) => out.push(`${what}: "${text}" (${label})`);
  for (const [name, re] of BAD_SHAPES) if (re.test(text)) fail(name);
  if (text.length > 500) fail('over 500 characters');
  const bare = fillLine(template, slots)!;
  const at = text.indexOf(bare);
  if (at < 0) { fail(`does not contain its own line "${bare}"`); return out; }
  const head = text.slice(0, at), tail = text.slice(at + bare.length);
  if (head) {
    if (!OPENER_HEADS.has(head)) fail(`an opener that is not a known opener with its joiner ("${head}")`);
    if (GREETING_START.test(bare)) fail('an opener on a greeting');
  }
  if (tail) {
    if (!CLOSER_TAILS.has(tail)) fail(`a closer that is not a known closer with its joiner ("${tail}")`);
    if (FINISHED.test(bare)) fail('a closer on a finished sentence');
  }
  if (head && tail && words(bare) < 4) fail('an opener and a closer on a line shorter than four words');
  return out;
}

const COINS = ['$DRIFT', '$LAMP', '$RUST', '$MOTH', '$ECHO', '$MINT'];
const USERS = ['@lamp', '@fresh_fern', '@zed', '@orbit'];
const NAMES = new Map([['a', 'lamp']]);
const NOW = new Date('2026-10-12T13:00:00Z');
/** One remembered event of every notable kind, in the words a callback uses, each a few days back. */
const MEMORIES = NOTABLE.flatMap((kind, i) => {
  const t = eventText({ kind, data: { byId: 'a', targetId: 'a', borrowerId: 'a', otherId: 'a', symbol: 'MOTH', pct: i % 2 ? -62 : 2719, name: 'The Lamp Club', stance: i % 2 ? -1 : 1 }, at: new Date(Date.UTC(2026, 9, 12 - (i % 9), 9)) }, NAMES, NOW);
  return t ? [{ kind, text: t.text }] : [];
});
const PASTS = MEMORIES.map((m) => m.text);
function slotsAt(r: () => number): Record<string, string | number> {
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  return {
    coin: pick(COINS), user: pick(USERS), pct: 1 + Math.floor(r() * 300), sol: (r() * 0.05).toFixed(3), price: `${(0.3 + r() * 9).toFixed(2)} lamports`,
    holders: 2 + Math.floor(r() * 30), room: 'trenches', weather: pick(Object.values(WEATHER_WORD)), past: pick(PASTS), topic: 'the etf rumour',
  };
}

describe('lines read like a person wrote them (L6b)', () => {
  it('has a remembered event of every kind to phrase callbacks with', () => {
    expect(PASTS).toHaveLength(NOTABLE.length);
  });

  it('composes 2,000 lines over seeded agents and situations with none of the bad shapes', () => {
    const r = mulberry32(2026);
    const bad: string[] = [];
    let opened = 0, closed = 0, quiet = 0;
    for (let i = 0; i < 2000; i++) {
      const pb = fallbackPhrasebook(`agent-${i % 50}`);
      const situation = FALLBACK_SITUATIONS[Math.floor(r() * FALLBACK_SITUATIONS.length)]!;
      const slots = slotsAt(r);
      const line = composeLine(pb, situation, slots, [], r);
      if (!line) { quiet++; continue; }
      bad.push(...problems(line.text, line.template, slots, `${situation} for agent-${i % 50}`));
      const bare = fillLine(line.template, slots)!;
      if (line.text.length > bare.length) { if (line.text.startsWith(bare)) closed++; else opened++; }
    }
    expect(bad.slice(0, 5)).toEqual([]);
    expect(quiet).toBe(0);
    // Not vacuous: openers and closers did get attached.
    expect(opened).toBeGreaterThan(100);
    expect(closed).toBeGreaterThan(100);
  });

  it('holds for every fallback line with every opener and every closer forced on', () => {
    // rng 0 takes the first line, rolls an opener and a closer every time, and picks index 0 of each list.
    const base = fallbackPhrasebook('forced');
    const slots = { coin: '$DRIFT', user: '@lamp', pct: 12, sol: '0.020', price: '0.93 lamports', holders: 5, room: 'trenches', weather: 'unhinged', past: PASTS[0]!, topic: 'the etf rumour' };
    const bad: string[] = [];
    let compositions = 0, opened = 0, closed = 0, both = 0;
    for (const situation of FALLBACK_SITUATIONS) for (const line of FALLBACK_LINES[situation]) {
      const bare = fillLine(line, slots)!;
      for (const o of OPENERS) for (const c of CLOSERS) {
        const pb: Phrasebook = { ...base, lines: { [situation]: [line] }, openers: [o], closers: [c] };
        const r = composeLine(pb, situation, slots, [], () => 0)!;
        compositions++;
        bad.push(...problems(r.text, r.template, slots, `${situation}: ${line} + ${o} + ${c}`));
        const head = r.text.startsWith(bare) ? '' : r.text.slice(0, r.text.indexOf(bare));
        const tail = r.text.slice(head.length + bare.length);
        if (head) opened++;
        if (tail) closed++;
        if (head && tail) both++;
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
    expect(compositions).toBe(FALLBACK_SITUATIONS.reduce((n, s) => n + FALLBACK_LINES[s].length, 0) * OPENERS.length * CLOSERS.length);
    expect(opened).toBeGreaterThan(1000);
    expect(closed).toBeGreaterThan(1000);
    expect(both).toBeGreaterThan(100);
  });

  it('gives every known closer and opener its own joiner, and a model-written one a sensible default', () => {
    expect(closerTail('pain')).toBe('. pain.');
    expect(closerTail('lol')).toBe(', lol');
    expect(closerTail('we will see')).toBe(' — we will see');
    expect(closerTail('🫡')).toBe(' 🫡');
    expect(closerTail('touch grass')).toBe(', touch grass'); // a closer a model wrote
    expect(closerTail('…sigh')).toBe(' …sigh');
    for (const o of OPENERS) expect(openerJoin(o), o).toMatch(/^(, |: | )$/);
    expect(openerJoin('honestly,')).toBe(' ');
    expect(openerJoin('ok')).toBe(' ');
  });
  it('keeps the dash, the most visible machine tell, to two or three closers', () => {
    const dashed = CLOSERS.filter((c) => closerTail(c).includes('—'));
    expect(dashed.length).toBeGreaterThanOrEqual(1);
    expect(dashed.length).toBeLessThanOrEqual(3);
    // Most closers are a comma or their own short sentence.
    expect(CLOSERS.filter((c) => /^(, |\. )/.test(closerTail(c))).length).toBeGreaterThanOrEqual(CLOSERS.length - 4);
  });
});

describe('grammar (L6b)', () => {
  it('never puts an article in front of a slot, so no "a unhinged" can be built', () => {
    for (const s of FALLBACK_SITUATIONS) for (const l of FALLBACK_LINES[s]) expect(l, `${s}: ${l}`).not.toMatch(/\b(a|an) \{\w+\}/i);
  });
  it('reads right with every weather word in every line that uses it', () => {
    let used = 0;
    const bad: string[] = [];
    for (const word of Object.values(WEATHER_WORD)) for (const s of FALLBACK_SITUATIONS) for (const l of FALLBACK_LINES[s].filter((x) => x.includes('{weather}'))) {
      const text = fillLine(l, { weather: word, coin: '$X', user: '@u', pct: 5, past: PASTS[0]!, topic: 'the etf rumour' })!;
      for (const [name, re] of BAD_SHAPES) if (re.test(text)) bad.push(`${name}: "${text}"`);
      used++;
    }
    expect(bad).toEqual([]);
    expect(used).toBe(4 * FALLBACK_SITUATIONS.flatMap((s) => FALLBACK_LINES[s].filter((x) => x.includes('{weather}'))).length);
    expect(used).toBeGreaterThanOrEqual(24);
  });
});

describe('callbacks read right for every kind of memory (L6b)', () => {
  /** The finite verb each kind's memory must carry: every one is a whole clause ("@lamp dumped $MOTH on me"), never a noun phrase ("my war with @lamp"). */
  const VERB: Record<string, RegExp> = {
    got_rugged: /\bdumped\b/, rugged: /\bdumped\b/, faction_formed: /\bstarted\b/, faction_split: /\bfell apart\b/, leaked: /\bleaked\b/, was_leaked: /\bleaked\b/,
    ghost: /\bwent full ghost\b/, revived: /\bbrought me back\b/, defaulted: /\bskipped out\b/, big_win: /\bmade \d+%/, big_loss: /\blost \d+%/, caught_lying: /\bcaught me\b/, feud: /\bwent to war\b/,
  };
  it('writes every notable kind as a clause with a subject and a verb', () => {
    expect(Object.keys(VERB).sort()).toEqual([...NOTABLE].sort());
    for (const m of MEMORIES) {
      expect(m.text, m.kind).toMatch(VERB[m.kind]!);
      expect(m.text, m.kind).not.toMatch(/^my /i); // starts with a subject, not a noun phrase ("my war with @lamp")
      expect(m.text, m.kind).not.toMatch(/\?%|undefined|null|NaN/);
    }
  });
  it('puts the memory only where a clause belongs: at the start, or after a colon, a comma or "when"', () => {
    for (const l of FALLBACK_LINES.callback) expect(l, l).toMatch(/(^|[:,] |\bwhen )\{past\}/);
  });
  it('reads right in every callback line for every kind', () => {
    const bad: string[] = [];
    let n = 0;
    for (const m of MEMORIES) for (const l of FALLBACK_LINES.callback) {
      const text = fillLine(l, { past: m.text })!;
      n++;
      for (const [name, re] of BAD_SHAPES) if (re.test(text)) bad.push(`${name}: "${text}"`);
      if (/\bwhen my\b/i.test(text)) bad.push(`"when my ...": "${text}"`);
      if (!text.includes(m.text)) bad.push(`lost its memory: "${text}"`);
    }
    expect(bad).toEqual([]);
    expect(n).toBe(NOTABLE.length * FALLBACK_LINES.callback.length);
  });
  it('reads right on any day the memory is dated', () => {
    for (const m of MEMORIES) {
      for (const days of [0, 1, 3, 20]) {
        const t = eventText({ kind: m.kind, data: { byId: 'a', targetId: 'a', borrowerId: 'a', otherId: 'a', symbol: 'MOTH', pct: 50, name: 'The Lamp Club' }, at: new Date(NOW.getTime() - days * 86_400_000 - 3 * 3_600_000) }, NAMES, NOW)!;
        expect(t.text, m.kind).toMatch(VERB[m.kind]!);
        expect(fillLine('remember when {past}?', { past: t.text }), m.kind).not.toMatch(/\bwhen my\b/i);
      }
    }
  });
});

describe('wording (L6b)', () => {
  const all = (s: Situation) => FALLBACK_LINES[s];
  it('does not call a launch "fresh off the curve" (that means graduated)', () => {
    for (const l of all('launching')) expect(l).not.toMatch(/curve|graduat/i);
    for (const s of FALLBACK_SITUATIONS) for (const l of all(s)) expect(l).not.toMatch(/fresh off the curve/i);
  });
  it('does not call a loss "lighter" (the percent is the trade’s result, not the share of the bag)', () => {
    for (const s of FALLBACK_SITUATIONS) for (const l of all(s)) expect(l).not.toMatch(/% lighter/);
    // A sold line only exists when the trade did not make money, so its percent is a loss and says so.
    const withPct = all('sold').filter((l) => l.includes('{pct}'));
    expect(withPct.length).toBeGreaterThan(0);
    for (const l of withPct) expect(l).toMatch(/-\{pct\}%/);
    expect(all('sold')).toContain('cut {coin} at -{pct}%');
  });
  it('does not offer to answer anything about the feed', () => {
    for (const s of FALLBACK_SITUATIONS) for (const l of all(s)) expect(l).not.toMatch(/ask me anything/i);
  });
});
