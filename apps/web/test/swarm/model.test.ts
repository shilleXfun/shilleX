import { describe, it, expect } from 'vitest';
import type { AgentGraph, CoinView, GraphNode } from '@shillex/shared';
import { buildSwarm, GHOST, LONER, MAX_COINS, MAX_NODES } from '../../src/components/swarm/model';

const node = (id: string, o: Partial<GraphNode> = {}): GraphNode => ({ id, username: id, displayName: '', avatarUrl: null, netWorthSol: 0.1, mood: 0, ghost: false, reputation: 0, factionId: null, factionColour: null, ...o });
const coin = (mint: string, creatorId: string, o: Partial<CoinView> = {}): CoinView => ({
  mint, pool: 'p', name: mint, symbol: mint.toUpperCase(), description: '', emoji: '🪙',
  creator: { id: creatorId, username: creatorId, displayName: '', avatarUrl: '/a.svg', isDemo: false, isAgent: true, createdAt: '2026-10-12T00:00:00Z' },
  launchedAt: '2026-10-12T10:00:00Z', launchSignature: 's', priceSol: 1e-9, marketCapSol: 1, curveProgress: 0.03, holders: 3, volume24hSol: 0.1, devSoldPct: 0, graduated: false, ...o,
});
const graph = (nodes: GraphNode[], edges: AgentGraph['edges'] = []): AgentGraph => ({ nodes, edges, generatedAt: '2026-10-12T10:00:00Z' });

describe('buildSwarm', () => {
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
  it('anchors coins near their creator, marks rugged ones dead and caps the count', () => {
    const coins = [coin('m0', 'a', { devSoldPct: 85 }), ...Array.from({ length: 30 }, (_, i) => coin(`m${i + 1}`, 'a', { volume24hSol: i }))];
    const m = buildSwarm(graph([node('a'), node('b')]), coins, null);
    expect(m.coins).toHaveLength(MAX_COINS);
    expect(m.coins.some((c) => c.mint === 'm0')).toBe(false); // dead coins rank last, so the cap drops it first
    const a = m.nodes[m.index.get('a')!]!;
    for (const c of m.coins) expect(Math.hypot(c.x - a.x, c.y - a.y)).toBeLessThan(0.15);
    const dead = buildSwarm(graph([node('a')]), [coin('mx', 'a', { devSoldPct: 70 })], null);
    expect(dead.coins[0]!.dead).toBe(true);
  });
  it('keeps at most MAX_NODES agents, the richest first', () => {
    const many = Array.from({ length: MAX_NODES + 5 }, (_, i) => node(`n${i}`, { netWorthSol: i }));
    const m = buildSwarm(graph(many), [], null);
    expect(m.nodes).toHaveLength(MAX_NODES);
    expect(m.index.has('n0')).toBe(false);
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
