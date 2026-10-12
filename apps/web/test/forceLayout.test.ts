import { describe, it, expect } from 'vitest';
import { forceLayout, mulberry32, FEUD_AT } from '../src/lib/forceLayout';
import { FEUD_AT as SWARM_FEUD_AT } from '../src/components/swarm/model';

const nodes = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, r: 10 }));
const edges = [{ a: 'a', b: 'b', w: 0.9 }, { a: 'c', b: 'd', w: -0.9 }];
const dist = (m: Map<string, { x: number; y: number }>, p: string, q: string) => Math.hypot(m.get(p)!.x - m.get(q)!.x, m.get(p)!.y - m.get(q)!.y);
/** Nodes within 2.5% of a wall of the 1000x625 box the density tests lay out in. */
const inWallBand = (m: Map<string, { x: number; y: number }>) => [...m.values()].filter((p) => p.x < 25 || p.x > 975 || p.y < 19 || p.y > 606);
/** The median distance over all pairs of nodes. */
const medianGap = (m: Map<string, { x: number; y: number }>) => {
  const pts = [...m.values()], gaps: number[] = [];
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) gaps.push(Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.y - pts[j]!.y));
  return gaps.sort((p, q) => p - q)[Math.floor(gaps.length / 2)]!;
};
/**
 * How much harder a node's feuds push it than ordinary repulsion would, read off one step from a hand-placed start in a
 * world of 50: `h` sits on the ring (so no ring pull), `foes` stand in an arc around it inside 2k, everyone else is far
 * away. h's push is then the sum of its pair repulsions, and every one of its feuds multiplies its pair by the same
 * factor, so the push with feuds over the push without any is that factor.
 */
const feudPush = (foes: number, w: number) => {
  const push = (weight: number) => {
    const ppl = Array.from({ length: 50 }, (_, i) => ({ id: i === 0 ? 'h' : `p${i}`, r: 10 }));
    const start = new Map<string, { x: number; y: number }>([['h', { x: 850, y: 312.5 }]]);
    for (let i = 1; i < 50; i++) {
      if (i <= foes) { const t = -Math.PI / 2 + (Math.PI * (i - 0.5)) / foes; start.set(`p${i}`, { x: 850 + 90 * Math.cos(t), y: 312.5 + 90 * Math.sin(t) }); }
      else start.set(`p${i}`, { x: 60 + (i % 8) * 60, y: 50 + Math.floor(i / 8) * 90 });
    }
    const links = Array.from({ length: foes }, (_, i) => ({ a: 'h', b: `p${i + 1}`, w: weight }));
    const moved = forceLayout(ppl, links, { width: 1000, height: 625, iterations: 1, temperature: 1e6, init: start });
    return Math.hypot(moved.get('h')!.x - 850, moved.get('h')!.y - 312.5);
  };
  return push(w) / push(0);
};

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
    // Pushed away, but only a feud's worth of 6 / 40 per enemy (1 + 0.9 * 6 / 40 times the usual repulsion).
    expect(feudPush(40, -0.9)).toBeCloseTo(1 + (0.9 * 6) / 40, 3);
    // The rest stay spread: nobody sits on the walls and the typical gap between agents is what it is with no feuds at all.
    expect(inWallBand(m).length).toBeLessThanOrEqual(5);
    expect(Math.abs(medianGap(m) / medianGap(forceLayout(many, [], { width: 1000, height: 625, seed: 7 })) - 1)).toBeLessThan(0.05);
  });
  it('mild dislike is ordinary repulsion', () => {
    const plain = forceLayout(nodes, [], { width: 800, height: 500, seed: 1 });
    const mild = forceLayout(nodes, [{ a: 'c', b: 'd', w: -0.3 }], { width: 800, height: 500, seed: 1 });
    expect(Math.abs(dist(mild, 'c', 'd') - dist(plain, 'c', 'd'))).toBeLessThan(1);
  });
  it('adds |w| to a feud pair\'s repulsion and leaves milder dislike alone', () => {
    expect(feudPush(4, -0.4)).toBeCloseTo(1.4, 3);
    expect(feudPush(4, -0.39)).toBeCloseTo(1, 6);
    expect(feudPush(4, -0.1)).toBeCloseTo(1, 6);
  });
  it('caps a node\'s extra push at MAX_FEUD_PUSH feuds', () => {
    expect(feudPush(6, -1)).toBeCloseTo(2, 3);
    expect(feudPush(12, -1)).toBeCloseTo(1.5, 3);
    expect(feudPush(24, -1)).toBeCloseTo(1.25, 3);
  });
  it('keeps agents off a frame along the walls, in any box and with or without feuds', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ id: `n${i}`, r: 12 }));
    const rnd = mulberry32(3);
    const feuds: { a: string; b: string; w: number }[] = [];
    while (feuds.length < 300) {
      const i = Math.floor(rnd() * 50), j = Math.floor(rnd() * 50);
      if (i !== j) feuds.push({ a: `n${i}`, b: `n${j}`, w: -1 + rnd() * 0.6 });
    }
    // A uniform spread puts about 11 of 50 within 6% of a wall; a frame of agents along the walls is more than twice that.
    for (const [width, height] of [[1000, 625], [1250, 500], [900, 700]] as const) {
      for (const links of [[], feuds]) {
        const near = [...forceLayout(many, links, { width, height, seed: 7 }).values()]
          .filter((p) => p.x < width * 0.06 || p.x > width * 0.94 || p.y < height * 0.06 || p.y > height * 0.94);
        expect(near.length).toBeLessThanOrEqual(12);
      }
    }
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
