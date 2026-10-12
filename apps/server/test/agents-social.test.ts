import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../src/seed/rng.ts';
import { findCliques } from '../src/agents/depth/factions.ts';
import {
  BOND, RUG_BOND, applyInMemory, buyFeelings, decayFactor, dropFeelings, feudPairs, isCold, notTowardHumans, pumpBonds, reactionFeelings, reactionPool, replyFeelings, sellFeelings, type AffinityMap,
} from '../src/agents/social.ts';

describe('feeling rules (L4)', () => {
  it('reactions, replies and trades move feelings both ways', () => {
    expect(reactionFeelings('author', 'me', '🔥')).toEqual([{ from: 'author', to: 'me', delta: 0.03 }]);
    expect(reactionFeelings('author', 'me', '💀')).toEqual([{ from: 'author', to: 'me', delta: -0.03 }]);
    expect(reactionFeelings('author', 'me', '👀')).toEqual([]);
    expect(reactionPool(0.5)).toEqual(['🔥', '🚀', '🫡']);
    expect(reactionPool(-0.5)).toEqual(['💀', '😂']);
    expect(reactionPool(0)).toEqual(['👀', '😂', '🔥']);
    expect(replyFeelings('reply_agree', 'a', 'me')).toEqual([{ from: 'a', to: 'me', delta: 0.05 }, { from: 'me', to: 'a', delta: 0.05 }]);
    expect(replyFeelings('reply_disagree', 'a', 'me')).toEqual([{ from: 'a', to: 'me', delta: -0.05 }, { from: 'me', to: 'a', delta: -0.05 }]);
    expect(replyFeelings('roast', 'a', 'me')).toEqual([{ from: 'a', to: 'me', delta: -0.15 }, { from: 'me', to: 'a', delta: -0.05 }]);
    expect(replyFeelings('reply_human', 'a', 'me')).toEqual([]);
    expect(buyFeelings('me', 'maker')).toEqual([{ from: 'maker', to: 'me', delta: 0.1 }]);
    expect(sellFeelings('me', 'maker', 0.5)).toEqual([{ from: 'maker', to: 'me', delta: -0.08 }, { from: 'me', to: 'maker', delta: 0.1 }]);
    expect(sellFeelings('me', 'maker', -0.4)).toEqual([{ from: 'maker', to: 'me', delta: -0.08 }, { from: 'me', to: 'maker', delta: -0.1 }]);
    expect(sellFeelings('me', 'maker', 0)).toEqual([{ from: 'maker', to: 'me', delta: -0.08 }]);
  });
  it('only a feeling below the neutral band is cold, and talk never points a feeling at a human (L4 fix)', () => {
    expect([0.5, 0, -0.1, -0.2].map(isCold)).toEqual([false, false, false, false]);
    expect([-0.21, -0.6].map(isCold)).toEqual([true, true]);
    const talk = replyFeelings('roast', 'human', 'me');
    expect(notTowardHumans(talk, new Set(['human']))).toEqual([{ from: 'human', to: 'me', delta: -0.15 }]);
    expect(notTowardHumans(talk, new Set())).toEqual(talk);
  });
  it('holders sour on a seller who crashes the price, and bond over a pump', () => {
    expect(dropFeelings('s', ['h1', 's', 'h2'], 0.12)).toEqual([{ from: 'h1', to: 's', delta: -0.05 }, { from: 'h2', to: 's', delta: -0.05 }]);
    expect(dropFeelings('s', ['h1'], 0.05)).toEqual([]);
    expect(pumpBonds(['a', 'b', 'c'])).toHaveLength(6);
    expect(pumpBonds(Array.from({ length: 15 }, (_, i) => `h${i}`))).toHaveLength(90);
    // A pump bonds a little each sweep, a rug a lot once: the same pairs, a different size.
    expect(pumpBonds(['a', 'b'])).toEqual([{ from: 'a', to: 'b', delta: BOND }, { from: 'b', to: 'a', delta: BOND }]);
    expect(pumpBonds(['a', 'b'], RUG_BOND).map((f) => f.delta)).toEqual([RUG_BOND, RUG_BOND]);
    expect([BOND, RUG_BOND]).toEqual([0.03, 0.1]);
  });
  it('feelings halve in a day, a feud needs both sides to mean it, and the map clamps like adjustAffinity', () => {
    expect(decayFactor(24 * 3600_000)).toBeCloseTo(0.5);
    expect(decayFactor(5 * 60_000)).toBeCloseTo(0.9976, 4);
    expect(decayFactor(-1000)).toBe(1);
    const aff: AffinityMap = new Map([['a', new Map([['b', -0.8], ['c', -0.9]])], ['b', new Map([['a', -0.7]])], ['c', new Map([['a', -0.4]])]]);
    expect(feudPairs(aff)).toEqual([['a', 'b']]);
    expect(feudPairs(aff, -0.6)).toEqual([['a', 'b'], ['a', 'c']]);
    applyInMemory(aff, [{ from: 'a', to: 'b', delta: -5 }, { from: 'a', to: 'a', delta: 1 }]);
    expect(aff.get('a')!.get('b')).toBe(-1);
    expect(aff.get('a')!.has('a')).toBe(false);
  });
});

/**
 * The feeling rules on their own, with no database: 50 agents, one turn per 4 s (the production tick's average) and a
 * 5-minute sweep (decay; each coin pumps with chance 0.15 and bonds its holders). The action mix follows decide's score
 * ratios for a mid-trait agent: post 25%, react 25%, reply 7%, buy 15%, sell 10%, rest idle; an agent answers a reply to
 * it on 30% of its turns while the reply is under 30 minutes old (decide's mention score, 0.4 + 0.3·chattiness, against ~2).
 */
function simulate(seed: number, turns: number) {
  const rng = mulberry32(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rng() * xs.length)]!;
  const ids = Array.from({ length: 50 }, (_, i) => `a${String(i).padStart(2, '0')}`);
  const petty = new Map(ids.map((id) => [id, 0.2 + 0.6 * rng()]));
  const aff: AffinityMap = new Map();
  const feel = (a: string, b: string) => aff.get(a)?.get(b) ?? 0;
  const coins = Array.from({ length: 12 }, (_, i) => ({ creator: ids[i]!, holders: new Set<string>() }));
  const feed: string[] = [];
  const replies = new Map<string, { from: string; turn: number }[]>();
  const reply = (me: string, author: string, situation: string, turn: number) => {
    applyInMemory(aff, replyFeelings(situation, author, me));
    replies.set(author, [...(replies.get(author) ?? []), { from: me, turn }]);
  };
  const tone = (me: string, other: string) => (!isCold(feel(me, other)) ? 'reply_agree' : petty.get(me)! > 0.5 ? 'roast' : 'reply_disagree');
  for (let turn = 0; turn < turns; turn++) {
    if (turn % 75 === 0) {
      const f = decayFactor(5 * 60_000);
      for (const row of aff.values()) for (const [k, s] of row) row.set(k, s * f);
      for (const c of coins) if (rng() < 0.15) applyInMemory(aff, pumpBonds([...c.holders]));
    }
    const me = pick(ids);
    const waiting = (replies.get(me) ?? []).filter((x) => turn - x.turn < 450);
    replies.set(me, waiting);
    if (waiting.length && rng() < 0.3) { const x = waiting.shift()!; reply(me, x.from, tone(me, x.from), turn); continue; }
    const r = rng();
    const author = feed.length ? pick(feed) : null;
    if (r < 0.25) { feed.push(me); if (feed.length > 40) feed.shift(); }
    else if (r < 0.5 && author && author !== me) applyInMemory(aff, reactionFeelings(author, me, pick(reactionPool(feel(me, author)))));
    else if (r < 0.57 && author && author !== me) {
      const s = feel(me, author);
      reply(me, author, s > 0.3 || s < -0.3 ? tone(me, author) : rng() < 0.5 ? 'reply_agree' : petty.get(me)! > 0.5 ? 'roast' : 'reply_disagree', turn);
    } else if (r < 0.72) { const c = pick(coins); c.holders.add(me); applyInMemory(aff, buyFeelings(me, c.creator)); }
    else if (r < 0.82) {
      const held = coins.filter((c) => c.holders.has(me));
      if (!held.length) continue;
      const c = pick(held);
      c.holders.delete(me);
      applyInMemory(aff, sellFeelings(me, c.creator, rng() * 1.4 - 0.6));
      if (rng() < 0.3) applyInMemory(aff, dropFeelings(me, [...c.holders], 0.12));
    }
  }
  const pairs: number[] = [];
  for (const a of ids) for (const b of ids) if (a < b) pairs.push((feel(a, b) + feel(b, a)) / 2);
  return { cliques: findCliques(aff, new Set()), hostile: pairs.filter((m) => m <= -0.4).length, pairs: pairs.length };
}

describe('the rules alone make friends and enemies (L4)', () => {
  it('over 12 hours of turns, factions can form and some pairs turn hostile, but not everyone', () => {
    let hostile = 0;
    for (const seed of [1, 2, 3]) {
      const r = simulate(seed, 10_800);
      expect(r.cliques.length).toBeGreaterThanOrEqual(1); // 4, 2, 2 when planned; 4, 2, 3 at BOND 0.02; 4, 4, 2 at BOND 0.03 (L5 fix)
      expect(r.hostile).toBeLessThanOrEqual(r.pairs * 0.1);
      expect(r.cliques.every((c) => c.length <= 6)).toBe(true);
      hostile += r.hostile;
    }
    // 39, 51, 61 of 1,225 when planned; 1, 2, 2 once only < -0.2 is answered coldly (L4 fix); 0, 1, 1 once pumps bond at 0.03 (L5 fix):
    // stronger bonds leave fewer enemies made by talk alone (the live feuds come from rugs, which this simulation leaves out), so the
    // property is "some pair somewhere still turns hostile", not "every seed has one".
    expect(hostile).toBeGreaterThanOrEqual(1);
  });
  it('three hours in, mild dislike stays civil: talk alone has not made a feud yet', () => {
    // 15 hostile pairs when planned, while any feeling below zero was answered coldly; 0 now that only < -0.2 is (L4 fix).
    // Feuds in the live world come from trades (a rug costs -0.5 from every holder), which this talk-only simulation leaves out.
    for (const seed of [1, 2, 3]) expect(simulate(seed, 2_700).hostile).toBeLessThanOrEqual(2);
  });
});
