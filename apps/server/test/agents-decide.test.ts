import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../src/seed/rng.ts';
import { COOLDOWN_MS, LAUNCH_COST, LAUNCH_MIN, RESERVE, RUG_MIN_SHARE, candidates, choose, coinScore, feedTalk, tasteFor } from '../src/agents/decide.ts';
import { emptyDepth } from '../src/agents/depth/registry.ts';
import { fallbackPhrasebook } from '../src/agents/phrasebook.ts';
import type { AgentView, Traits } from '../src/agents/types.ts';

const NOW = '2026-10-12T12:00:00.000Z';
const traits = (t: Partial<Traits> = {}): Traits => ({ risk: 0.5, chattiness: 0.5, loyalty: 0.5, pettiness: 0.5, greed: 0.5, humor: 0.5, curiosity: 0.5, ...t });
function view(over: Partial<AgentView> = {}, t: Partial<Traits> = {}): AgentView {
  return {
    agent: { id: 'me', username: 'me', displayName: 'Me' },
    state: { energy: 1, mood: 0, traits: traits(t), cooldowns: {}, recentLines: [], brokeSince: null, ghostSince: null },
    phrasebook: fallbackPhrasebook('me'),
    wallet: { lamports: 100_000_000, positions: [] },
    coins: [], mentions: [], dms: [], feed: [], rooms: [], affinity: {}, weather: 'grind', now: NOW, depth: emptyDepth(),
    ...over,
  };
}
const hot = { mint: 'HOT', symbol: 'HOT', creatorId: 'maker', priceLamports: 2, change10m: 0.4, change1h: 0.6, holders: 6, graduated: false, launchedAt: NOW };
const of = (v: AgentView, kind: string) => candidates(v, mulberry32(1)).filter((c) => c.kind === kind);

describe('money rules', () => {
  it('never spends into the 0.01 SOL reserve and makes no money moves when broke', () => {
    for (let s = 0; s < 50; s++) for (const c of candidates(view({ coins: [hot] }, { risk: 1 }), mulberry32(s)).filter((x) => x.kind === 'buy')) {
      expect(c.lamports!).toBeLessThanOrEqual(100_000_000 - RESERVE);
    }
    const broke = view({ coins: [hot], wallet: { lamports: RESERVE - 1, positions: [] } }, { risk: 1 });
    expect(candidates(broke, mulberry32(1)).filter((c) => ['buy', 'launch', 'send_sol'].includes(c.kind))).toEqual([]);
  });
  it('launches only with at least 0.04 SOL and keeps the reserve after launch cost and first buy', () => {
    expect(of(view({ wallet: { lamports: LAUNCH_MIN - 1, positions: [] } }, { risk: 1 }), 'launch')).toEqual([]);
    const [l] = of(view({ wallet: { lamports: LAUNCH_MIN, positions: [] } }, { risk: 1 }), 'launch');
    expect(l).toBeDefined();
    expect(LAUNCH_MIN - LAUNCH_COST - l!.lamports!).toBeGreaterThanOrEqual(RESERVE);
  });
  it('rugs only its own coin in profit, selling at least 70% of the bag', () => {
    const mine = { ...hot, mint: 'MINE', creatorId: 'me' };
    const pos = { mint: 'MINE', symbol: 'MINE', raw: 1_000_000_000, costLamports: 10_000_000, valueLamports: 30_000_000, createdByMe: true, creatorId: 'me' };
    const [r] = of(view({ coins: [mine], wallet: { lamports: 50_000_000, positions: [pos] } }, { greed: 0.9 }), 'rug');
    expect(r).toMatchObject({ situation: 'rugged_someone', target: { mint: 'MINE' } });
    expect(r!.raw!).toBeGreaterThanOrEqual(RUG_MIN_SHARE * pos.raw);
    expect(r!.raw!).toBeLessThanOrEqual(pos.raw);
    expect(of(view({ coins: [mine], wallet: { lamports: 50_000_000, positions: [{ ...pos, valueLamports: 9_000_000 }] } }, { greed: 0.9 }), 'rug')).toEqual([]);
    const theirs = { ...pos, mint: 'HOT', createdByMe: false, creatorId: 'maker' };
    expect(of(view({ coins: [hot], wallet: { lamports: 50_000_000, positions: [theirs] } }, { greed: 0.9 }), 'rug')).toEqual([]);
  });
});

describe('scoring', () => {
  it('answers an unanswered human mention first, as reply_human', () => {
    const v = view({ mentions: [{ postId: 'p1', authorId: 'h1', authorKind: 'human', body: 'hi', at: NOW }], feed: [{ postId: 'p2', authorId: 'x', body: 'yo', at: NOW, reactions: 1 }] });
    const cs = candidates(v, mulberry32(1));
    const top = [...cs].sort((a, b) => b.score - a.score)[0]!;
    expect(top).toMatchObject({ kind: 'reply', situation: 'reply_human', target: { postId: 'p1', userId: 'h1' } });
  });
  it('answers an agent it dislikes with a roast when petty', () => {
    const v = view({ mentions: [{ postId: 'p1', authorId: 'foe', authorKind: 'agent', body: 'hi', at: NOW }], affinity: { foe: -0.6 } }, { pettiness: 0.9 });
    expect(of(v, 'reply')[0]).toMatchObject({ situation: 'roast' });
  });
  it('respects cooldowns', () => {
    const fresh = view({ coins: [hot] }, { risk: 1 });
    expect(of(fresh, 'buy')).toHaveLength(1);
    const cooling = view({ coins: [hot], state: { ...fresh.state, cooldowns: { buy: new Date(Date.parse(NOW) - COOLDOWN_MS.buy + 1000).toISOString() } } }, { risk: 1 });
    expect(of(cooling, 'buy')).toEqual([]);
  });
  it('a bold agent wants a pumping coin more than a timid one, and nobody buys from an enemy', () => {
    const bold = of(view({ coins: [hot] }, { risk: 0.95 }), 'buy')[0]!;
    const timid = of(view({ coins: [hot] }, { risk: 0.05 }), 'buy')[0];
    expect(bold.score).toBeGreaterThan(timid?.score ?? 0);
    expect(bold.reason).toMatch(/HOT/);
    expect(of(view({ coins: [hot], affinity: { maker: -0.8 } }, { risk: 0.95 }), 'buy')).toEqual([]);
  });
  it('low energy lowers every score except idle', () => {
    const full = candidates(view({ coins: [hot] }), mulberry32(2));
    const tired = candidates(view({ coins: [hot], state: { ...view().state, energy: 0 } }), mulberry32(2));
    const score = (cs: typeof full, k: string) => cs.find((c) => c.kind === k)?.score ?? 0;
    expect(score(tired, 'post')).toBeLessThan(score(full, 'post'));
    expect(score(tired, 'idle')).toBeGreaterThan(score(full, 'idle'));
  });
  it('a ghost only haunts or rests', () => {
    const g = view({ coins: [hot], mentions: [{ postId: 'p1', authorId: 'h1', authorKind: 'human', body: 'hi', at: NOW }], state: { ...view().state, ghostSince: NOW } });
    const kinds = new Set(candidates(g, mulberry32(1)).map((c) => c.kind));
    expect([...kinds].sort()).toEqual(['idle', 'post']);
    expect(candidates(g, mulberry32(1)).find((c) => c.kind === 'post')!.situation).toBe('ghost');
  });
  it('every candidate explains itself, and choose is deterministic and falls back to idle', () => {
    const cs = candidates(view({ coins: [hot], feed: [{ postId: 'p2', authorId: 'x', body: 'yo', at: NOW, reactions: 1 }] }), mulberry32(4));
    for (const c of cs) expect(c.reason.length).toBeGreaterThan(5);
    expect(choose(cs, mulberry32(9))).toEqual(choose(cs, mulberry32(9)));
    expect(choose([], mulberry32(1))).toMatchObject({ kind: 'idle', score: 0 });
  });
});

describe('fix round 1', () => {
  const pos = (over = {}) => ({ mint: 'MINE', symbol: 'MINE', raw: 1_000_000_000, costLamports: 10_000_000, valueLamports: 30_000_000, createdByMe: false, creatorId: 'maker', ...over });
  const top = (cs: ReturnType<typeof candidates>) => [...cs].sort((a, b) => b.score - a.score)[0]!;

  it('sells a held coin that is missing from the coin list, treating it as flat', () => {
    const v = view({ wallet: { lamports: 50_000_000, positions: [pos({ mint: 'OLD', symbol: 'OLD' })] } }, { greed: 0.9 });
    expect(of(v, 'sell')).toHaveLength(1);
  });
  it('launch is rarer than posting, and damped by recent world launches', () => {
    const recent = (n: number) => Array.from({ length: n }, (_, i) => ({ ...hot, mint: `R${i}`, creatorId: 'maker', change10m: 0, change1h: 0 }));
    const base = (n: number) => view({ coins: recent(n) });
    const launch0 = of(base(0), 'launch')[0]!, post0 = of(base(0), 'post')[0]!;
    expect(launch0.score).toBeLessThan(post0.score);
    expect(of(base(5), 'launch')[0]!.score).toBeLessThan(launch0.score / 5);
  });
  it('ignores launches older than an hour for damping', () => {
    const old = { ...hot, mint: 'OLDL', launchedAt: new Date(Date.parse(NOW) - 2 * 3_600_000).toISOString(), change10m: 0, change1h: 0 };
    expect(of(view({ coins: [old] }), 'launch')[0]!.score).toBeCloseTo(of(view(), 'launch')[0]!.score, 10);
  });
  it('a human mention outranks any number of agent mentions', () => {
    const m = (i: number, kind: 'human' | 'agent') => ({ postId: `p${i}`, authorId: `a${i}`, authorKind: kind, body: 'hi', at: NOW });
    const v = view({ mentions: [1, 2, 3, 4, 5].map((i) => m(i, 'agent')).concat([m(6, 'human')]) });
    const replies = candidates(v, mulberry32(1)).filter((c) => c.kind === 'reply');
    const human = replies.find((c) => c.target?.postId === 'p6')!;
    for (const r of replies) if (r !== human) expect(r.score).toBeLessThan(human.score);
    expect(top(candidates(v, mulberry32(1))).target?.postId).toBe('p6');
  });
  it('buy reserve at the edge', () => {
    for (let s = 0; s < 30; s++) for (const c of candidates(view({ coins: [hot], wallet: { lamports: 12_000_000, positions: [] } }, { risk: 1 }), mulberry32(s)).filter((x) => x.kind === 'buy')) {
      expect(c.lamports!).toBeLessThanOrEqual(2_000_000);
    }
    expect(of(view({ coins: [hot], wallet: { lamports: 12_000_000, positions: [] } }, { risk: 1 }), 'buy')).toHaveLength(1);
    expect(of(view({ coins: [hot], wallet: { lamports: 11_999_999, positions: [] } }, { risk: 1 }), 'buy')).toEqual([]);
  });
  it('broke alone excludes trading', () => {
    // 9_999_999 is below the reserve; 10_000_000 exactly has nothing spendable, so also no buy
    expect(of(view({ coins: [hot], wallet: { lamports: 9_999_999, positions: [] } }, { risk: 1 }), 'buy')).toEqual([]);
    expect(of(view({ coins: [hot], wallet: { lamports: 9_999_999, positions: [] }, affinity: { ally: 0.9 } }, { risk: 1, loyalty: 1 }), 'send_sol')).toEqual([]);
  });
  it('rug floor holds at greed 0 with an odd bag, using the literal 0.7', () => {
    const mine = { ...hot, mint: 'MINE', creatorId: 'me' };
    const p = pos({ raw: 1_000_000_001, createdByMe: true, creatorId: 'me' });
    const [r] = of(view({ coins: [mine], wallet: { lamports: 50_000_000, positions: [p] } }, { greed: 0, pettiness: 0.9 }), 'rug');
    expect(r).toBeDefined();
    expect(r!.raw!).toBeGreaterThanOrEqual(Math.ceil(0.7 * 1_000_000_001));
    expect(r!.raw!).toBeLessThanOrEqual(1_000_000_001);
  });
  it('a coin I created never yields a plain sell', () => {
    const mine = { ...hot, mint: 'MINE', creatorId: 'me' };
    for (const valueLamports of [30_000_000, 5_000_000]) {
      const v = view({ coins: [mine], wallet: { lamports: 50_000_000, positions: [pos({ createdByMe: true, creatorId: 'me', valueLamports })] } }, { greed: 0.9 });
      expect(of(v, 'sell')).toEqual([]);
    }
  });
  it('send_sol to a close ally keeps the reserve', () => {
    const [s] = of(view({ affinity: { ally: 0.9 }, wallet: { lamports: 80_000_001, positions: [] } }, { loyalty: 1 }), 'send_sol');
    expect(s).toMatchObject({ target: { userId: 'ally' } });
    expect(80_000_001 - s!.lamports!).toBeGreaterThanOrEqual(RESERVE);
    expect(of(view({ affinity: { ally: 0.9 }, wallet: { lamports: 80_000_000, positions: [] } }, { loyalty: 1 }), 'send_sol')).toEqual([]);
  });
  it('is deterministic for the same view and seed', () => {
    const v = view({ coins: [hot], feed: [{ postId: 'p2', authorId: 'x', body: 'yo', at: NOW, reactions: 1 }, { postId: 'p3', authorId: 'y', body: 'hey', at: NOW, reactions: 0 }], wallet: { lamports: 100_000_000, positions: [pos()] } });
    expect(candidates(v, mulberry32(11))).toEqual(candidates(v, mulberry32(11)));
  });
  it('an unparsable cooldown timestamp counts as ready', () => {
    const v = view({ coins: [hot] }, { risk: 1 });
    expect(of({ ...v, state: { ...v.state, cooldowns: { buy: 'garbage' } } }, 'buy')).toHaveLength(1);
  });
  it('skips dust and fee-less sells', () => {
    expect(of(view({ wallet: { lamports: 50_000_000, positions: [pos({ raw: 999_999 })] } }, { greed: 0.9 }), 'sell')).toEqual([]);
    expect(of(view({ wallet: { lamports: 9_999, positions: [pos()] } }, { greed: 0.9 }), 'sell')).toEqual([]);
  });
});

describe('no herding (L2)', () => {
  const twin = (mint: string) => ({ ...hot, mint, symbol: mint, change10m: 0.05, change1h: 0.1 });
  const as = (s: number) => ({ id: `agent-${s}`, username: `a${s}`, displayName: '' });
  const boughtMint = (v: AgentView, s: number) => candidates(v, mulberry32(s)).find((c) => c.kind === 'buy')?.target?.mint;
  const ago = (ms: number) => new Date(Date.parse(NOW) - ms).toISOString();

  it('agents split between two identical coins instead of all piling into one', () => {
    let a = 0;
    for (let s = 0; s < 200; s++) if (boughtMint(view({ coins: [twin('AAA'), twin('BBB')], agent: as(s) }, { risk: 0.6 }), s) === 'AAA') a++;
    expect(a).toBeGreaterThanOrEqual(60); // 106 of 200 when planned
    expect(a).toBeLessThanOrEqual(140);
  });
  it('gives every agent a stable taste of its own for each coin', () => {
    expect(tasteFor('x', 'M')).toBe(tasteFor('x', 'M'));
    const all = Array.from({ length: 200 }, (_, i) => tasteFor(`a${i}`, 'M'));
    expect(Math.max(...all.map(Math.abs))).toBeLessThanOrEqual(0.2);
    expect(Math.min(...all)).toBeLessThan(-0.1);
    expect(Math.max(...all)).toBeGreaterThan(0.1);
  });
  it('a coin an ally shills wins over an identical coin, and the receipt says why', () => {
    const shill = { postId: 'p1', authorId: 'pal', body: '$AAA to the moon, holding 🚀', at: NOW, reactions: 0 };
    let a = 0;
    for (let s = 0; s < 200; s++) if (boughtMint(view({ coins: [twin('AAA'), twin('BBB')], agent: as(s), affinity: { pal: 0.8 }, feed: [shill] }, { risk: 0.6 }), s) === 'AAA') a++;
    expect(a).toBeGreaterThanOrEqual(120); // 158 of 200 when planned
    const loud = view({ coins: [twin('AAA')], affinity: { pal: 0.8 }, feed: [shill, { ...shill, postId: 'p2' }] });
    expect(coinScore(loud, twin('AAA')).why).toBe('people I like are talking it up');
  });
  it('weighs what the feed says by who said it, and ignores its own posts', () => {
    const talk = feedTalk(view({ affinity: { pal: 0.8, foe: -1 }, feed: [
      { postId: 'p1', authorId: 'pal', body: '$AAA to the moon 🚀', at: NOW, reactions: 0 },
      { postId: 'p2', authorId: 'foe', body: '$AAA to the moon 🚀', at: NOW, reactions: 0 },
      { postId: 'p3', authorId: 'x', body: '$BBB is dead, a scam', at: NOW, reactions: 0 },
      { postId: 'p4', authorId: 'me', body: '$CCC to the moon', at: NOW, reactions: 0 },
    ] }));
    expect(talk.get('AAA')).toBeCloseTo(0.18, 9);
    expect(talk.get('BBB')).toBeCloseTo(-0.1, 9);
    expect(talk.has('CCC')).toBe(false);
  });
  it('wants a coin less the more of its net worth is already in it', () => {
    const c = twin('AAA');
    const pos = { mint: 'AAA', symbol: 'AAA', raw: 1_000_000_000, costLamports: 60_000_000, valueLamports: 60_000_000, createdByMe: false, creatorId: 'maker' };
    const held = coinScore(view({ coins: [c], wallet: { lamports: 40_000_000, positions: [pos] } }), c).d;
    const free = coinScore(view({ coins: [c], wallet: { lamports: 100_000_000, positions: [] } }), c).d;
    expect(free - held).toBeCloseTo(0.24, 9);
  });
  it('a curious agent buys a five-minute-old coin some of the time even while a hot coin runs', () => {
    const fresh = { ...hot, mint: 'NEWB', symbol: 'NEWB', holders: 1, change10m: 0.02, change1h: 0.02, launchedAt: ago(5 * 60_000) };
    let n = 0;
    for (let s = 0; s < 200; s++) if (boughtMint(view({ coins: [hot, fresh], agent: as(s) }, { curiosity: 0.8 }), s) === 'NEWB') n++;
    expect(n).toBeGreaterThanOrEqual(30); // 42 of 200 when planned
  });
  it('gives no novelty to a coin dated in the future (Review Focus 3)', () => {
    const fresh = { ...hot, mint: 'NEWB', symbol: 'NEWB', holders: 1, change10m: 0, change1h: 0 };
    const v = view({}, { curiosity: 1 });
    expect(coinScore(v, { ...fresh, launchedAt: new Date(Date.parse(NOW) + 10 * 60_000).toISOString() }).d)
      .toBeCloseTo(coinScore(v, { ...fresh, launchedAt: ago(50 * 60_000) }).d, 12);
  });
  it('does not retry a coin whose buy just failed', () => {
    expect(of(view({ coins: [hot], failedBuys: ['HOT'] }, { risk: 1 }), 'buy')).toEqual([]);
  });
});
