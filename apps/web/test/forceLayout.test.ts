import { describe, it, expect } from 'vitest';
import { forceLayout, mulberry32 } from '../src/lib/forceLayout';

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
  it('spreads agents without pinning them to the walls', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ id: `n${i}`, r: 12 }));
    const star = Array.from({ length: 40 }, (_, i) => ({ a: 'n0', b: `n${i + 1}`, w: 0.3 + (i % 5) * 0.1 }));
    const m = forceLayout(many, star, { width: 1000, height: 625, seed: 7 });
    const onWall = [...m.values()].filter((p) => p.x < 25 || p.x > 975 || p.y < 19 || p.y > 606);
    expect(onWall.length).toBeLessThanOrEqual(5);
  });
  it('clusters factions', () => {
    const group = (i: number) => Math.floor(i / 10);
    const ppl = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, r: 12 }));
    const rnd = mulberry32(5);
    const links: { a: string; b: string; w: number }[] = [];
    for (let i = 0; i < 30; i++) for (let j = i + 1; j < 30; j++) if (group(i) === group(j) && rnd() < 0.35) links.push({ a: `p${i}`, b: `p${j}`, w: 0.4 + rnd() * 0.5 });
    for (const [i, j] of [[0, 10], [3, 22], [14, 25], [7, 17], [19, 28]] as const) links.push({ a: `p${i}`, b: `p${j}`, w: -0.8 });
    const m = forceLayout(ppl, links, { width: 1000, height: 625, seed: 7 });
    let same = 0, sameN = 0, cross = 0, crossN = 0;
    for (let i = 0; i < 30; i++) for (let j = i + 1; j < 30; j++) {
      const d = dist(m, `p${i}`, `p${j}`);
      if (group(i) === group(j)) { same += d; sameN++; } else { cross += d; crossN++; }
    }
    expect(same / sameN).toBeLessThan(0.7 * (cross / crossN));
  });
});
