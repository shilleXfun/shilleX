import { describe, it, expect, vi, afterEach } from 'vitest';
import type { AgentGraph, CoinView, GraphNode } from '@shillex/shared';
import { buildSwarm } from '../../src/components/swarm/model';
import { createRenderer } from '../../src/components/swarm/renderer';

const node = (id: string): GraphNode => ({ id, username: id, displayName: '', avatarUrl: null, netWorthSol: 0.1, mood: 0, ghost: false, reputation: 0, factionId: null, factionColour: null });
const coin = (mint: string, creatorId: string, volume24hSol: number): CoinView => ({
  mint, pool: 'p', name: mint, symbol: mint.toUpperCase(), description: '', emoji: '🪙',
  creator: { id: creatorId, username: creatorId, displayName: '', avatarUrl: '/a.svg', isDemo: false, isAgent: true, createdAt: '2026-10-12T00:00:00Z' },
  launchedAt: '2026-10-12T10:00:00Z', launchSignature: 's', priceSol: 1e-9, marketCapSol: 1, curveProgress: 0.03, holders: 3, volume24hSol, devSoldPct: 0, graduated: false,
});
const graph: AgentGraph = { nodes: [node('a'), node('b')], edges: [], generatedAt: '2026-10-12T10:00:00Z' };

/** A 2D context that does nothing except remember where rings (the only arcs) were drawn, what text was written and how many background fills there were (one per frame drawn, plus the stars). */
function fakeContext() {
  const arcs: number[][] = [];
  const texts: string[] = [];
  const fills = { n: 0 };
  const grad = { addColorStop: () => undefined };
  const target: Record<string, unknown> = { arc: (...a: number[]) => { arcs.push(a); }, fillText: (t: string) => { texts.push(t); }, fillRect: () => { fills.n++; }, createLinearGradient: () => grad, createRadialGradient: () => grad };
  return { arcs, texts, fills, ctx: new Proxy(target, { get: (t, k) => (k in t ? t[k as string] : () => undefined), set: () => true }) };
}

function setup({ reduced = false } = {}) {
  const { arcs, texts, fills, ctx } = fakeContext();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
  let clock = 0, frame: FrameRequestCallback = () => undefined;
  const raf = vi.fn((cb: FrameRequestCallback) => { frame = cb; return 1; });
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  vi.stubGlobal('requestAnimationFrame', raf);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  const canvas = document.createElement('canvas');
  const r = createRenderer(canvas, { reduced })!;
  r.resize(1000, 600, 1);
  const first = buildSwarm(graph, [coin('c1', 'a', 1)], null);
  r.setModel(first);
  r.start();
  return { r, canvas, arcs, texts, fills, raf, first, at: (ms: number) => { clock = ms; }, draw: (ms: number) => { clock = ms; frame(ms); } };
}

afterEach(() => vi.unstubAllGlobals());

describe('renderer setModel', () => {
  it('keeps a ring going on its coin when the coins refresh and the coin changes index', () => {
    const { r, arcs, first, at, draw } = setup();
    at(1000);
    r.event({ kind: 'launch', agentId: 'a', mint: 'c1' });
    // A busier coin now ranks first, so c1 moves from index 0 to 1.
    const next = buildSwarm(graph, [coin('c1', 'a', 1), coin('c2', 'b', 9)], first, { relayout: false });
    expect(next.coinIndex.get('c1')).toBe(1);
    at(1100);
    r.setModel(next);
    arcs.length = 0;
    draw(1300);
    const c1 = next.coins[1]!;
    expect(arcs).toHaveLength(1);
    expect(arcs[0]![0]).toBeCloseTo(40 + c1.x * 920, 5);
    expect(arcs[0]![1]).toBeCloseTo(42 + c1.y * 516, 5);
  });
  it('ends a ring whose coin is gone from the new model', () => {
    const { r, arcs, first, at, draw } = setup();
    at(1000);
    r.event({ kind: 'launch', agentId: 'a', mint: 'c1' });
    at(1100);
    r.setModel(buildSwarm(graph, [coin('c9', 'b', 1)], first, { relayout: false }));
    arcs.length = 0;
    draw(1300);
    expect(arcs).toHaveLength(0);
  });
});

describe('renderer coin labels', () => {
  it('writes each coin’s ticker beside its diamond, but not on phones', () => {
    const { r, texts, draw } = setup();
    draw(1000);
    expect(texts).toContain('$C1');
    r.resize(390, 844, 1);
    texts.length = 0;
    draw(1100);
    expect(texts).toHaveLength(0);
  });
});

describe('renderer resize', () => {
  it('draws a frame at once when it resizes while running (assigning the buffer size clears it)', () => {
    const { r, canvas, fills, draw } = setup();
    draw(1000);
    const before = fills.n;
    r.resize(800, 500, 1);
    expect(canvas.width).toBe(800);
    expect(fills.n).toBeGreaterThan(before);
  });
  it('leaves the buffer alone when the size is the same (a phone’s URL bar sliding fires resize for nothing)', () => {
    const { r, canvas, fills, draw } = setup();
    draw(1000);
    const before = fills.n;
    const set = vi.spyOn(canvas, 'width', 'set');
    r.resize(1000, 600, 1);
    expect(set).not.toHaveBeenCalled();
    expect(fills.n).toBe(before);
    r.resize(1000, 600, 2);
    expect(set).toHaveBeenCalledWith(2000);
  });
});

describe('renderer reduced motion', () => {
  it('never requests an animation frame, and draws still frames instead', () => {
    const { raf, fills } = setup({ reduced: true });
    expect(raf).not.toHaveBeenCalled();
    expect(fills.n).toBeGreaterThan(0);
  });
  it('queues no animation for a rug: no rings, and the coin is redrawn as rugged', () => {
    const { r, arcs, texts, raf } = setup({ reduced: true });
    texts.length = 0;
    r.event({ kind: 'rug', agentId: 'a', mint: 'c1' });
    r.event({ kind: 'buy', agentId: 'a', mint: 'c1' });
    r.event({ kind: 'post', agentId: 'a' });
    expect(arcs).toHaveLength(0);
    expect(texts).toContain('$C1 ✕');
    expect(raf).not.toHaveBeenCalled();
  });
});
