import { describe, it, expect } from 'vitest';
import { forceLayout } from '../src/lib/forceLayout';

const nodes = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, r: 10 }));
const edges = [{ a: 'a', b: 'b', w: 0.9 }, { a: 'c', b: 'd', w: -0.9 }];
const dist = (m: Map<string, { x: number; y: number }>, p: string, q: string) => Math.hypot(m.get(p)!.x - m.get(q)!.x, m.get(p)!.y - m.get(q)!.y);

describe('forceLayout', () => {
  it('is deterministic for a seed', () => {
    const a = forceLayout(nodes, edges, { width: 800, height: 500, seed: 3 });
    const b = forceLayout(nodes, edges, { width: 800, height: 500, seed: 3 });
    expect([...a]).toEqual([...b]);
  });
  it('keeps every node inside the box', () => {
    const m = forceLayout(nodes, edges, { width: 800, height: 500, seed: 1 });
    for (const p of m.values()) { expect(p.x).toBeGreaterThanOrEqual(10); expect(p.x).toBeLessThanOrEqual(790); expect(p.y).toBeGreaterThanOrEqual(10); expect(p.y).toBeLessThanOrEqual(490); }
  });
  it('pulls allies closer than enemies', () => {
    const m = forceLayout(nodes, edges, { width: 800, height: 500, seed: 1 });
    expect(dist(m, 'a', 'b')).toBeLessThan(dist(m, 'c', 'd'));
  });
  it('starts from the given positions and moves them only a little in a few iterations', () => {
    const first = forceLayout(nodes, edges, { width: 800, height: 500, seed: 1 });
    const again = forceLayout(nodes, edges, { width: 800, height: 500, seed: 9, iterations: 20, temperature: 4, init: first });
    for (const n of nodes) expect(dist(new Map([['p', first.get(n.id)!], ['q', again.get(n.id)!]]), 'p', 'q')).toBeLessThan(60);
  });
});
