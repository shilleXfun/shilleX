import { describe, it, expect } from 'vitest';
import type { AgentGraph, CoinView, GraphNode } from '@shillex/shared';
import { breathOf, buildSwarm, GHOST, LONER, MAX_COINS } from '../../src/components/swarm/model';

const node = (id: string, o: Partial<GraphNode> = {}): GraphNode => ({ id, username: id, displayName: '', avatarUrl: null, netWorthSol: 0.1, mood: 0, ghost: false, reputation: 0, factionId: null, factionColour: null, ...o });
const coin = (mint: string, creatorId: string, o: Partial<CoinView> = {}): CoinView => ({
  mint, pool: 'p', name: mint, symbol: mint.toUpperCase(), description: '', emoji: '🪙',
  creator: { id: creatorId, username: creatorId, displayName: '', avatarUrl: '/a.svg', isDemo: false, isAgent: true, createdAt: '2026-10-12T00:00:00Z' },
  launchedAt: '2026-10-12T10:00:00Z', launchSignature: 's', priceSol: 1e-9, marketCapSol: 1, curveProgress: 0.03, holders: 3, volume24hSol: 0.1, devSoldPct: 0, graduated: false, ...o,
});
const graph = (nodes: GraphNode[], edges: AgentGraph['edges'] = []): AgentGraph => ({ nodes, edges, generatedAt: '2026-10-12T10:00:00Z' });

describe('buildSwarm', () => {
  it('gives happier agents a quicker breath, from 6 s at the bottom to 3 s at the top', () => {
    expect(breathOf(-1)).toBe(6);
    expect(breathOf(1)).toBe(3);
    expect(breathOf(5)).toBe(3);
    const m = buildSwarm(graph([node('sad', { mood: -1 }), node('glad', { mood: 1 })]), [], null);
    expect(m.nodes[m.index.get('glad')!]!.breath).toBe(3);
    expect(m.nodes[m.index.get('sad')!]!.breath).toBe(6);
  });
  it('normalises positions and maps faction, loner and ghost colours', () => {
    const m = buildSwarm(graph([node('a', { factionId: 'f', factionColour: '#3DDBD9' }), node('b'), node('c', { ghost: true })]), [], null);
    for (const n of m.nodes) { expect(n.x).toBeGreaterThanOrEqual(0); expect(n.x).toBeLessThanOrEqual(1); expect(n.y).toBeGreaterThanOrEqual(0); expect(n.y).toBeLessThanOrEqual(1); }
    const by = (id: string) => m.nodes[m.index.get(id)!]!;
    expect(by('a').colour).toBe('#3DDBD9');
    expect(by('b').colour).toBe(LONER);
    expect(by('c').colour).toBe(GHOST);
    expect(by('c').glow).toBeLessThan(by('b').glow);
  });
  it('sorts edges into allies and feuds and ignores weak dislike', () => {
    const m = buildSwarm(graph([node('a'), node('b'), node('c'), node('d')], [{ a: 'a', b: 'b', score: 0.5 }, { a: 'c', b: 'd', score: -0.6 }, { a: 'a', b: 'c', score: -0.3 }]), [], null);
    const allies = [...m.alliesByColour.values()].flat();
    expect(allies).toHaveLength(1);
    expect(m.feuds).toHaveLength(1);
  });
  it('anchors coins near their creator, marks rugged ones dead and shows only the busiest as diamonds', () => {
    const coins = [coin('m0', 'a', { devSoldPct: 85 }), ...Array.from({ length: 30 }, (_, i) => coin(`m${i + 1}`, 'a', { volume24hSol: i })), coin('old', 'a', { archived: true })];
    const m = buildSwarm(graph([node('a'), node('b')]), coins, null);
    expect(m.coins).toHaveLength(31); // every coin still trading has a place; an archived one does not
    expect(m.coins.filter((c) => c.shown)).toHaveLength(MAX_COINS);
    expect(m.coins[m.coinIndex.get('m0')!]!.shown).toBe(false); // dead coins rank last, so they are the first not drawn
    const a = m.nodes[m.index.get('a')!]!;
    for (const c of m.coins) expect(Math.hypot(c.x - a.x, c.y - a.y)).toBeLessThan(0.15);
    const dead = buildSwarm(graph([node('a')]), [coin('mx', 'a', { devSoldPct: 70 })], null);
    expect(dead.coins[0]!.dead).toBe(true);
  });
  it('keeps every agent, the richest first', () => {
    const many = Array.from({ length: 300 }, (_, i) => node(`n${i}`, { netWorthSol: i }));
    const m = buildSwarm(graph(many), [], null);
    expect(m.nodes).toHaveLength(300);
    expect(m.index.get('n299')).toBe(0);
    expect(m.index.has('n0')).toBe(true);
  });
  it('moves agents only slightly when the graph is refetched', () => {
    const g = graph(Array.from({ length: 20 }, (_, i) => node(`n${i}`)), [{ a: 'n0', b: 'n1', score: 0.8 }]);
    const first = buildSwarm(g, [], null);
    const second = buildSwarm(g, [], first);
    for (const n of first.nodes) {
      const s = second.nodes[second.index.get(n.id)!]!;
      expect(Math.hypot(s.x - n.x, s.y - n.y)).toBeLessThan(0.05);
    }
  });
  it('moves coins with their creator across refetches and leaves a coin of an unknown creator where it is', () => {
    const people = Array.from({ length: 50 }, (_, i) => node(`n${i}`));
    const edgesAt = (k: number): AgentGraph['edges'] => [
      { a: 'n0', b: 'n1', score: 0.8 }, { a: 'n2', b: 'n3', score: -0.7 }, { a: 'n4', b: 'n5', score: 0.6 },
      ...Array.from({ length: k }, (_, j): AgentGraph['edges'][number] => ({ a: 'n3', b: `n${10 + j}`, score: 0.9 })), // n3's ties change, so n3 moves
    ];
    const coins = [coin('m1', 'n3'), coin('m2', 'n7'), coin('m3', 'ghost')];
    const initial = buildSwarm(graph(people, edgesAt(0)), coins, null);
    let model = initial;
    const first = new Map(model.coins.map((c) => [c.mint, { ...c }]));
    const gap = (m: typeof model, mint: string, creator: string) => {
      const c = m.coins[m.coinIndex.get(mint)!]!, a = m.nodes[m.index.get(creator)!]!;
      return [c.x - a.x, c.y - a.y] as const;
    };
    const start = [gap(model, 'm1', 'n3'), gap(model, 'm2', 'n7')];
    for (let k = 1; k <= 5; k++) {
      model = buildSwarm(graph(people, edgesAt(k)), coins, model);
      const now = [gap(model, 'm1', 'n3'), gap(model, 'm2', 'n7')];
      // Each coin keeps its offset from its creator, so it follows the creator wherever the layout puts it.
      now.forEach(([x, y], i) => { expect(x).toBeCloseTo(start[i]![0], 9); expect(y).toBeCloseTo(start[i]![1], 9); expect(Math.hypot(x, y)).toBeLessThan(0.15); });
      // A creator the graph does not have leaves its coin where it first was.
      expect(model.coins[model.coinIndex.get('m3')!]).toEqual(first.get('m3'));
    }
    // n3 really did move, so the check above is not vacuous.
    const n3 = (m: typeof model) => m.nodes[m.index.get('n3')!]!;
    expect(Math.hypot(n3(model).x - n3(initial).x, n3(model).y - n3(initial).y)).toBeGreaterThan(0.005);
  });
  it('keeps agents exactly where they are when only the coins change', () => {
    const g = graph(Array.from({ length: 20 }, (_, i) => node(`n${i}`)), [{ a: 'n0', b: 'n1', score: 0.8 }, { a: 'n2', b: 'n3', score: -0.7 }]);
    const first = buildSwarm(g, [coin('m1', 'n0')], null);
    const second = buildSwarm(g, [coin('m1', 'n0'), coin('m2', 'n5')], first, { relayout: false });
    for (const n of first.nodes) {
      const s = second.nodes[second.index.get(n.id)!]!;
      expect([s.x, s.y]).toEqual([n.x, n.y]);
    }
    expect(second.alliesByColour).toEqual(first.alliesByColour);
    expect(second.feuds).toEqual(first.feuds);
    expect(second.coins.map((c) => c.mint).sort()).toEqual(['m1', 'm2']);
    expect(second.coins[second.coinIndex.get('m1')!]).toEqual(first.coins[0]);
  });
});

describe('the viewer’s own agent', () => {
  // Richest first: a0 holds the most, a79 the least.
  const many = (n: number) => graph(Array.from({ length: n }, (_, i) => node(`a${i}`, { netWorthSol: n - i })));
  it('is drawn, even when it is the poorest, and is marked own', () => {
    const m = buildSwarm(many(80), [], null, { pin: 'a79' });
    expect(m.nodes).toHaveLength(80);
    expect(m.index.has('a79')).toBe(true);
    expect(m.nodes[m.index.get('a79')!]!.own).toBe(true);
    expect(m.nodes.filter((n) => n.own)).toHaveLength(1);
  });
  it('no pin, no ring', () => {
    expect(buildSwarm(many(10), [], null).nodes.some((n) => n.own)).toBe(false);
  });
});
