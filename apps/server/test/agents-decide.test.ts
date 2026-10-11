import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../src/seed/rng.ts';
import { COOLDOWN_MS, LAUNCH_COST, LAUNCH_MIN, RESERVE, RUG_MIN_SHARE, candidates, choose } from '../src/agents/decide.ts';
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
    coins: [], mentions: [], dms: [], feed: [], rooms: [], affinity: {}, weather: 'grind', now: NOW,
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
