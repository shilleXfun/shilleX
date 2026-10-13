export type Pt = { x: number; y: number };

/** An edge at or below this weight is a feud: only feuds push harder than ordinary repulsion. */
export const FEUD_AT = -0.4;
/** A node with more feuds than this has the extra push of each of them scaled down, so one much-hated agent cannot blow the layout apart. */
export const MAX_FEUD_PUSH = 6;
/**
 * How hard each node is pulled toward the loose ring. Repulsion pushes the outer nodes outward at roughly a third of k, and
 * at the old 0.08 the pull could not hold them: the soft margin collected about half the agents into straight rows along
 * the walls, with or without feuds (23-29 of 50 within 6% of a wall, against 11 for a uniform spread). At this strength
 * the outer agents settle inside the ring instead, and a flat box no longer stacks them along its top and bottom.
 */
const RING_PULL = 0.7;

export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A small spring-and-repulsion layout, deterministic for a seed and `init`. Allies (w > 0) are springs with rest length
 * 90 + (1 - w) * 140; pairs closer than 2k repel gently (k is the ideal spacing); feuds (w <= FEUD_AT) repel 1 + |w| times
 * harder, with a node's total extra push capped at MAX_FEUD_PUSH feuds' worth, while milder dislike is ordinary
 * repulsion; a pull toward a loose ring (an ellipse at 70% of the half extents) spreads loners over the whole box, and a
 * soft margin of 6% per side eases nodes off the walls. Every node ends inside [r, width - r] × [r, height - r]. Moves
 * per iteration are capped by a temperature that falls linearly from `temperature` (default k / 2); a small one nudges
 * an existing layout (`init`).
 */
export function forceLayout(
  nodes: { id: string; r: number }[],
  edges: { a: string; b: string; w: number }[],
  opts: { width: number; height: number; iterations?: number; seed?: number; temperature?: number; init?: Map<string, Pt> },
): Map<string, Pt> {
  const { width, height, iterations = 300, seed = 1, init } = opts;
  const rnd = mulberry32(seed);
  const n = nodes.length;
  const xs = new Float64Array(n), ys = new Float64Array(n), dx = new Float64Array(n), dy = new Float64Array(n);
  nodes.forEach((nd, i) => {
    const p = init?.get(nd.id);
    xs[i] = p ? p.x : nd.r + rnd() * Math.max(1, width - 2 * nd.r);
    ys[i] = p ? p.y : nd.r + rnd() * Math.max(1, height - 2 * nd.r);
  });
  const index = new Map(nodes.map((nd, i) => [nd.id, i]));
  const springs: [number, number, number][] = [];
  const feuds = new Map<number, number>();
  for (const e of edges) {
    const i = index.get(e.a), j = index.get(e.b);
    if (i === undefined || j === undefined || i === j) continue;
    if (e.w > 0) springs.push([i, j, e.w]);
    else if (e.w <= FEUD_AT) { const key = Math.min(i, j) * n + Math.max(i, j); feuds.set(key, Math.max(feuds.get(key) ?? 0, -e.w)); }
  }
  // A feud adds |w| to its pair's repulsion. A node in more than MAX_FEUD_PUSH feuds has each of them scaled down by
  // MAX_FEUD_PUSH / count, and a pair takes the smaller scale of its two ends, so no node's total extra push passes the cap.
  const feudCount = new Int32Array(n);
  for (const key of feuds.keys()) { feudCount[Math.floor(key / n)]!++; feudCount[key % n]!++; }
  const feudScale = (i: number) => Math.min(1, MAX_FEUD_PUSH / Math.max(1, feudCount[i]!));
  // Dense, at i * n + j (i < j), rather than a Map: the pair loop reads it for every close pair on every iteration.
  const boost = new Float64Array(n * n).fill(1);
  for (const [key, w] of feuds) boost[key] = 1 + w * Math.min(feudScale(Math.floor(key / n)), feudScale(key % n));
  const k = Math.sqrt((width * height) / Math.max(1, n)), cx = width / 2, cy = height / 2, reach = 4 * k * k;
  const start = opts.temperature ?? k / 2;
  for (let it = 0; it < iterations; it++) {
    const temp = Math.max(start * 0.02, start * (1 - it / iterations));
    dx.fill(0); dy.fill(0);
    // The O(n²) part, kept tight for every agent in the world (300 lay out in ~60 ms, not ~420): squared distances first,
    // so pairs past 2k skip the square root.
    for (let i = 0; i < n; i++) {
      const xi = xs[i]!, yi = ys[i]!, row = i * n;
      let fx = 0, fy = 0;
      for (let j = i + 1; j < n; j++) {
        let ex = xi - xs[j]!, ey = yi - ys[j]!, d2 = ex * ex + ey * ey;
        if (d2 < 0.01) { ex = rnd() - 0.5; ey = rnd() - 0.5; d2 = ex * ex + ey * ey; }
        if (d2 > reach) continue;
        const d = Math.max(0.1, Math.sqrt(d2)), f = ((k * k) / (d * d)) * 0.08 * boost[row + j]!;
        fx += ex * f; fy += ey * f; dx[j]! -= ex * f; dy[j]! -= ey * f;
      }
      dx[i]! += fx; dy[i]! += fy;
    }
    for (const [i, j, w] of springs) {
      const ex = xs[j]! - xs[i]!, ey = ys[j]! - ys[i]!, d = Math.max(0.1, Math.hypot(ex, ey));
      const f = (d - (90 + (1 - w) * 140)) * 2 * w;
      dx[i]! += (ex / d) * f; dy[i]! += (ey / d) * f; dx[j]! -= (ex / d) * f; dy[j]! -= (ey / d) * f;
    }
    for (let i = 0; i < n; i++) {
      // Pull toward a loose ring (an ellipse at 70% of the half extents) instead of the centre, so agents spread over the
      // whole backdrop rather than collapsing behind the reading column or flattening against the walls. It is the
      // gradient of RING_PULL * hw * hh / 2 * (rr - 0.7)^2 (rr: the radius in half extents), so nothing in it pushes
      // sideways along the ring: pulling each axis toward the nearest ring point on its own scale does, in any box that is
      // not square, and agents then circled the ring for ever and a refetch never settled.
      const hw = width / 2, hh = height / 2;
      const ux = (xs[i]! - cx) / hw, uy = (ys[i]! - cy) / hh, rr = Math.max(1e-6, Math.hypot(ux, uy));
      dx[i]! += RING_PULL * hh * ((0.7 - rr) * ux) / rr;
      dy[i]! += RING_PULL * hw * ((0.7 - rr) * uy) / rr;
      const m = Math.hypot(dx[i]!, dy[i]!);
      if (m > 0) { const s = Math.min(m, temp) / m; xs[i]! += dx[i]! * s; ys[i]! += dy[i]! * s; }
      const mx = width * 0.06, my = height * 0.06;
      if (xs[i]! < mx) xs[i]! += (mx - xs[i]!) * 0.3; else if (xs[i]! > width - mx) xs[i]! -= (xs[i]! - (width - mx)) * 0.3;
      if (ys[i]! < my) ys[i]! += (my - ys[i]!) * 0.3; else if (ys[i]! > height - my) ys[i]! -= (ys[i]! - (height - my)) * 0.3;
      const r = nodes[i]!.r;
      xs[i] = Math.min(width - r, Math.max(r, xs[i]!)); ys[i] = Math.min(height - r, Math.max(r, ys[i]!));
    }
  }
  return new Map(nodes.map((nd, i) => [nd.id, { x: xs[i]!, y: ys[i]! }]));
}
