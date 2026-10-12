import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../src/seed/rng.ts';
import { eventText, NOTABLE } from '../src/agents/depth/memory.ts';
import { CLOSERS, FALLBACK_LINES, FALLBACK_SITUATIONS, OPENERS, WEATHER_WORD, closerJoin, composeLine, fallbackPhrasebook, fillLine, openerJoin } from '../src/agents/phrasebook.ts';
import type { Phrasebook, Situation } from '../src/agents/types.ts';

// What a visitor reads must look like a person wrote it. These are properties over many composed lines, so a new line, opener
// or closer that glues, doubles or misspeaks fails here whatever the situation.

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ANY_CLOSER = [...CLOSERS, 'gm'].filter((c) => /^\p{L}/u.test(c)).map(esc).join('|'); // words only: an emoji after a space is fine
const ANY_INTERJECTION = ['gm', 'good morning', 'ok', 'okay', 'alright', 'so', 'honestly', 'lol', 'look', 'well', 'fine', 'anyway', 'real talk', 'not gonna lie', 'quick one', 'update', 'hm', 'btw'].map(esc).join('|');
const VERBS = 'bought|sold|picked up|grabbed|trimmed|launched|added|tried|cashed|closed|cut|banked|locked|took|joined|put|made|stepped|retired|lightened';

/** The shapes the review found, plus the ones they imply. Each must match nothing a visitor can read. */
const BAD_SHAPES: [string, RegExp][] = [
  ['a closer glued to a ticker ("bought some $DRIFT pain")', new RegExp(`\\$[A-Za-z0-9]+ (?:${ANY_CLOSER})(?![\\p{L}\\p{N}])`, 'iu')],
  ['a closer glued to a verb phrase', new RegExp(`\\b(?:${VERBS})\\b[^.,;:!?—]* (?:${ANY_CLOSER})$`, 'iu')],
  ['two interjections in a row at the start ("alright gm", "ok ok")', new RegExp(`^(?:${ANY_INTERJECTION})[ ,:]+(?:${ANY_INTERJECTION}|okay|good morning)(?![\\p{L}\\p{N}])`, 'iu')],
  ['two closers in a row', new RegExp(`(?<![\\p{L}\\p{N}])(?:${ANY_CLOSER})(?:, | — | )(?:${ANY_CLOSER})$`, 'iu')],
  ['"a" before a vowel ("a unhinged")', /\ba [aeiou]/i],
  ['"an" before a consonant', /\ban [^aeiou\s]/i],
  ['a word said twice in a row', /\b(\p{L}{2,}) \1\b/iu],
  ['stray spacing or punctuation', /\s{2,}|\s,|,\s*,|^\s|\s$|\{|\}|undefined|null/],
];
function expectReadsWell(text: string, label: string) {
  for (const [name, re] of BAD_SHAPES) if (re.test(text)) throw new Error(`${name}: "${text}" (${label})`);
  expect(text.length).toBeLessThanOrEqual(500);
}

const FINISHED = /[.!?…]$|\p{Extended_Pictographic}$/u;
const GREETING_START = /^(?:gm|good morning|ok|alright|so|honestly|lol)(?![\p{L}\p{N}])/iu;
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
/** What composeLine put around the filled line, so each decoration can be checked on its own. */
function decoration(text: string, template: string, slots: Record<string, string | number>) {
  const bare = fillLine(template, slots)!;
  const at = text.indexOf(bare);
  expect(at, `"${text}" must contain its own line "${bare}"`).toBeGreaterThanOrEqual(0);
  return { bare, head: text.slice(0, at), tail: text.slice(at + bare.length) };
}
function expectDecorationsRight(text: string, template: string, slots: Record<string, string | number>) {
  const { bare, head, tail } = decoration(text, template, slots);
  if (head) {
    expect(OPENERS.map((o) => `${o}${openerJoin(o)}`), `opener in "${text}"`).toContain(head);
    expect(GREETING_START.test(bare), `an opener on a greeting: "${text}"`).toBe(false);
  }
  if (tail) {
    expect(CLOSERS.map((c) => `${closerJoin(c)}${c}`), `closer in "${text}"`).toContain(tail);
    expect(FINISHED.test(bare), `a closer on a finished sentence: "${text}"`).toBe(false);
    expect(/^(, | — | )/.test(tail), `a closer needs its joiner: "${text}"`).toBe(true);
  }
  if (head && tail) expect(words(bare), `opener and closer on a short line: "${text}"`).toBeGreaterThanOrEqual(4);
}

const COINS = ['$DRIFT', '$LAMP', '$RUST', '$MOTH', '$ECHO', '$MINT'];
const USERS = ['@lamp', '@fresh_fern', '@zed', '@orbit'];
/** One remembered event of every notable kind, in the words a callback uses. */
const PASTS = NOTABLE.flatMap((kind, i) => {
  const t = eventText({ kind, data: { byId: 'a', targetId: 'a', borrowerId: 'a', otherId: 'a', symbol: 'MOTH', pct: i % 2 ? -62 : 2719, name: 'The Lamp Club', stance: i % 2 ? -1 : 1 }, at: new Date(Date.UTC(2026, 9, 12 - (i % 9), 9)) }, new Map([['a', 'lamp']]), new Date('2026-10-12T13:00:00Z'));
  return t ? [t.text] : [];
});
function slotsAt(r: () => number): Record<string, string | number> {
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  return {
    coin: pick(COINS), user: pick(USERS), pct: 1 + Math.floor(r() * 300), sol: (r() * 0.05).toFixed(3), price: `${(0.3 + r() * 9).toFixed(2)} lamports`,
    holders: 2 + Math.floor(r() * 30), room: 'trenches', weather: pick(Object.values(WEATHER_WORD)), past: pick(PASTS),
  };
}

describe('lines read like a person wrote them (L6b)', () => {
  it('has a remembered event of every kind to phrase callbacks with', () => {
    expect(PASTS).toHaveLength(NOTABLE.length);
  });

  it('composes 2,000 lines over seeded agents and situations with none of the bad shapes', () => {
    const r = mulberry32(2026);
    let opened = 0, closed = 0;
    for (let i = 0; i < 2000; i++) {
      const pb = fallbackPhrasebook(`agent-${i % 50}`);
      const situation = FALLBACK_SITUATIONS[Math.floor(r() * FALLBACK_SITUATIONS.length)]!;
      const slots = slotsAt(r);
      const line = composeLine(pb, situation, slots, [], r);
      expect(line, `${situation} for agent-${i % 50}`).not.toBeNull();
      expectReadsWell(line!.text, situation);
      expectDecorationsRight(line!.text, line!.template, slots);
      const { head, tail } = decoration(line!.text, line!.template, slots);
      if (head) opened++;
      if (tail) closed++;
    }
    // Not vacuous: openers and closers did get attached.
    expect(opened).toBeGreaterThan(100);
    expect(closed).toBeGreaterThan(100);
  });

  it('holds for every fallback line with every opener and every closer forced on', () => {
    // rng 0 takes the first line, rolls an opener and a closer every time, and picks index 0 of each list.
    let opened = 0, closed = 0, both = 0;
    const slots = { coin: '$DRIFT', user: '@lamp', pct: 12, sol: '0.020', price: '0.93 lamports', holders: 5, room: 'trenches', weather: 'unhinged', past: PASTS[0]! };
    for (const situation of FALLBACK_SITUATIONS) for (const line of FALLBACK_LINES[situation]) for (const o of OPENERS) for (const c of CLOSERS) {
      const pb: Phrasebook = { ...fallbackPhrasebook('forced'), lines: { [situation]: [line] }, openers: [o], closers: [c] };
      const r = composeLine(pb, situation, slots, [], () => 0)!;
      expectReadsWell(r.text, `${situation}: ${line} + ${o} + ${c}`);
      expectDecorationsRight(r.text, r.template, slots);
      const { head, tail } = decoration(r.text, r.template, slots);
      if (head) opened++;
      if (tail) closed++;
      if (head && tail) both++;
    }
    expect(opened).toBeGreaterThan(1000);
    expect(closed).toBeGreaterThan(1000);
    expect(both).toBeGreaterThan(100);
  });

  it('gives every known closer and opener its own joiner, and a model-written one a sensible default', () => {
    for (const c of CLOSERS) expect(closerJoin(c), c).toMatch(/^(, | — | )$/);
    expect(closerJoin('pain')).toBe(' — ');
    expect(closerJoin('lol')).toBe(', ');
    expect(closerJoin('🫡')).toBe(' ');
    expect(closerJoin('touch grass')).toBe(', ');
    expect(closerJoin('…sigh')).toBe(' ');
    for (const o of OPENERS) expect(openerJoin(o), o).toMatch(/^(, |: | )$/);
    expect(openerJoin('honestly,')).toBe(' ');
    expect(openerJoin('ok')).toBe(' ');
  });
});

describe('grammar (L6b)', () => {
  it('never puts an article in front of a slot, so no "a unhinged" can be built', () => {
    for (const s of FALLBACK_SITUATIONS) for (const l of FALLBACK_LINES[s]) expect(l, `${s}: ${l}`).not.toMatch(/\b(a|an) \{\w+\}/i);
  });
  it('reads right with every weather word in every line that uses it', () => {
    let used = 0;
    for (const word of Object.values(WEATHER_WORD)) for (const s of FALLBACK_SITUATIONS) for (const l of FALLBACK_LINES[s].filter((x) => x.includes('{weather}'))) {
      const text = fillLine(l, { weather: word, coin: '$X', user: '@u', pct: 5, past: PASTS[0]! })!;
      expectReadsWell(text, `${s}: ${l} / ${word}`);
      used++;
    }
    expect(used).toBe(4 * FALLBACK_SITUATIONS.flatMap((s) => FALLBACK_LINES[s].filter((x) => x.includes('{weather}'))).length);
    expect(used).toBeGreaterThanOrEqual(24);
  });
  it('reads right for a callback of every kind', () => {
    for (const past of PASTS) for (const l of FALLBACK_LINES.callback) expectReadsWell(fillLine(l, { past })!, `callback: ${l}`);
    // {past} is a whole clause ("@lamp dumped $MOTH on me"), so no line may hang it off a preposition.
    for (const l of FALLBACK_LINES.callback) expect(l, l).not.toMatch(/\b(about|to|of|for|with|on) \{past\}/);
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
