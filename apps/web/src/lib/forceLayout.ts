export type Pt = { x: number; y: number };

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
 * 90 + (1 - w) * 140; pairs closer than 2k repel gently (k is the ideal spacing); enemies (w < 0) repel 1 + 2|w| times
 * harder; a pull toward a loose ring (an ellipse at 70% of the half extents) spreads loners over the whole box, and a
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
  const boost = new Map<number, number>();
  for (const e of edges) {
    const i = index.get(e.a), j = index.get(e.b);
    if (i === undefined || j === undefined || i === j) continue;
    if (e.w > 0) springs.push([i, j, e.w]);
    else if (e.w < 0) boost.set(Math.min(i, j) * n + Math.max(i, j), 1 + 2 * Math.abs(e.w));
  }
  const k = Math.sqrt((width * height) / Math.max(1, n)), cx = width / 2, cy = height / 2;
  const start = opts.temperature ?? k / 2;
  for (let it = 0; it < iterations; it++) {
    const temp = Math.max(start * 0.02, start * (1 - it / iterations));
    dx.fill(0); dy.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let ex = xs[i]! - xs[j]!, ey = ys[i]! - ys[j]!;
        if (ex * ex + ey * ey < 0.01) { ex = rnd() - 0.5; ey = rnd() - 0.5; }
        const d = Math.max(0.1, Math.hypot(ex, ey));
        if (d > 2 * k) continue;
        const f = ((k * k) / d) * 0.08 * (boost.get(i * n + j) ?? 1);
        dx[i]! += (ex / d) * f; dy[i]! += (ey / d) * f; dx[j]! -= (ex / d) * f; dy[j]! -= (ey / d) * f;
      }
    }
    for (const [i, j, w] of springs) {
      const ex = xs[j]! - xs[i]!, ey = ys[j]! - ys[i]!, d = Math.max(0.1, Math.hypot(ex, ey));
      const f = (d - (90 + (1 - w) * 140)) * 2 * w;
      dx[i]! += (ex / d) * f; dy[i]! += (ey / d) * f; dx[j]! -= (ex / d) * f; dy[j]! -= (ey / d) * f;
    }
    for (let i = 0; i < n; i++) {
      // Pull toward a loose ring (an ellipse at 70% of the half extents) instead of the centre, so agents spread over the
      // whole backdrop rather than collapsing behind the reading column or flattening against the walls.
      const ux = (xs[i]! - cx) / (width / 2), uy = (ys[i]! - cy) / (height / 2), rr = Math.max(1e-6, Math.hypot(ux, uy));
      dx[i]! += (cx + (ux / rr) * 0.7 * (width / 2) - xs[i]!) * 0.08;
      dy[i]! += (cy + (uy / rr) * 0.7 * (height / 2) - ys[i]!) * 0.08;
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
