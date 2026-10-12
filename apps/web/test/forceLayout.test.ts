import { describe, it, expect } from 'vitest';
import { forceLayout, mulberry32, FEUD_AT } from '../src/lib/forceLayout';
import { FEUD_AT as SWARM_FEUD_AT } from '../src/components/swarm/model';

const nodes = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, r: 10 }));
const edges = [{ a: 'a', b: 'b', w: 0.9 }, { a: 'c', b: 'd', w: -0.9 }];
const dist = (m: Map<string, { x: number; y: number }>, p: string, q: string) => Math.hypot(m.get(p)!.x - m.get(q)!.x, m.get(p)!.y - m.get(q)!.y);
/** Nodes within 2.5% of a wall of the 1000x625 box the density tests lay out in. */
const inWallBand = (m: Map<string, { x: number; y: number }>) => [...m.values()].filter((p) => p.x < 25 || p.x > 975 || p.y < 19 || p.y > 606);

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
    expect(inWallBand(m).length).toBeLessThanOrEqual(5);
  });
  it('stays organic in a feud-heavy world', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ id: `n${i}`, r: 12 }));
    const rnd = mulberry32(3);
    const links: { a: string; b: string; w: number }[] = [];
    while (links.length < 300) {
      const i = Math.floor(rnd() * 50), j = Math.floor(rnd() * 50);
      if (i !== j) links.push({ a: `n${i}`, b: `n${j}`, w: -1 + rnd() * 0.6 });
    }
    for (let i = 0; i < 20; i++) links.push({ a: `n${i}`, b: `n${(i * 7 + 3) % 50}`, w: 0.4 + (i % 5) * 0.1 });
    const m = forceLayout(many, links, { width: 1000, height: 625, seed: 7 });
    expect(inWallBand(m).length).toBeLessThanOrEqual(5);
  });
  it('a much-hated agent is pushed away but the rest stay spread', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ id: `n${i}`, r: 12 }));
    const hated = Array.from({ length: 40 }, (_, i) => ({ a: 'n0', b: `n${i + 1}`, w: -0.9 }));
    const m = forceLayout(many, hated, { width: 1000, height: 625, seed: 7 });
    const ids = many.map((n) => n.id);
    const mean = ids.slice(1).reduce((s, id) => s + dist(m, 'n0', id), 0) / (ids.length - 1);
    const pairs: number[] = [];
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) pairs.push(dist(m, ids[i]!, ids[j]!));
    pairs.sort((x, y) => x - y);
    expect(mean).toBeGreaterThan(pairs[Math.floor(pairs.length / 2)]!);
    expect(inWallBand(m).length).toBeLessThanOrEqual(5);
  });
  it('mild dislike is ordinary repulsion', () => {
    const plain = forceLayout(nodes, [], { width: 800, height: 500, seed: 1 });
    const mild = forceLayout(nodes, [{ a: 'c', b: 'd', w: -0.3 }], { width: 800, height: 500, seed: 1 });
    expect(Math.abs(dist(mild, 'c', 'd') - dist(plain, 'c', 'd'))).toBeLessThan(1);
  });
  describe('a feud adds |w| to its pair\'s repulsion, scaled down once a node has more than MAX_FEUD_PUSH feuds', () => {
    // One step from a hand-placed start in a world of 50: `h` sits on the ring (so no ring pull), `foes` stand in an arc
    // around it inside 2k, and everyone else is far away. h's push is then the sum of its pair repulsions, and every feud
    // of h multiplies its pair by the same factor, so the ratio to the push without feuds is that factor.
    const push = (foes: number, w: number) => {
      const ppl = Array.from({ length: 50 }, (_, i) => ({ id: i === 0 ? 'h' : `p${i}`, r: 10 }));
      const start = new Map<string, { x: number; y: number }>([['h', { x: 850, y: 312.5 }]]);
      for (let i = 1; i < 50; i++) {
        if (i <= foes) { const t = -Math.PI / 2 + (Math.PI * (i - 0.5)) / foes; start.set(`p${i}`, { x: 850 + 90 * Math.cos(t), y: 312.5 + 90 * Math.sin(t) }); }
        else start.set(`p${i}`, { x: 60 + (i % 8) * 60, y: 50 + Math.floor(i / 8) * 90 });
      }
      const links = Array.from({ length: foes }, (_, i) => ({ a: 'h', b: `p${i + 1}`, w }));
      const moved = forceLayout(ppl, links, { width: 1000, height: 625, iterations: 1, temperature: 1e6, init: start });
      return Math.hypot(moved.get('h')!.x - 850, moved.get('h')!.y - 312.5);
    };
    const ratio = (foes: number, w: number) => push(foes, w) / push(foes, 0);
    it('multiplies a feud pair by 1 + |w|', () => {
      expect(ratio(4, -0.4)).toBeCloseTo(1.4, 3);
      expect(ratio(6, -1)).toBeCloseTo(2, 3);
    });
    it('leaves milder dislike alone', () => {
      expect(ratio(4, -0.39)).toBeCloseTo(1, 6);
      expect(ratio(4, -0.1)).toBeCloseTo(1, 6);
    });
    it('caps a much-hated agent at six feuds of push', () => {
      expect(ratio(12, -1)).toBeCloseTo(1.5, 3);
      expect(ratio(24, -1)).toBeCloseTo(1.25, 3);
    });
  });
  it('shares its feud threshold with the swarm model', () => {
    expect(FEUD_AT).toBe(SWARM_FEUD_AT);
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
