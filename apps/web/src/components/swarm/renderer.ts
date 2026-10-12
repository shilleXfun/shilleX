import type { Regime } from '@shillex/shared';
import { mulberry32 } from '../../lib/forceLayout';
import type { SwarmModel } from './model';
import { targetsFor, type SwarmEvent } from './bus';
import { readColours } from './palette';

type RGBA = [number, number, number, number];
interface Sky { top: RGBA; low: RGBA; a1: RGBA; a2: RGBA; a3: RGBA; speed: number; jitter: number }

/** Sky per market regime; `none` is the sky without an agent world or before the weather loads. */
export const SKIES: Record<Regime | 'none', Sky> = {
  none: { top: [7, 8, 13, 1], low: [14, 14, 24, 1], a1: [255, 184, 107, 0.08], a2: [125, 227, 255, 0.06], a3: [182, 156, 255, 0.06], speed: 0.6, jitter: 0 },
  euphoria: { top: [10, 9, 16, 1], low: [30, 20, 10, 1], a1: [255, 184, 107, 0.2], a2: [75, 240, 160, 0.13], a3: [255, 150, 80, 0.16], speed: 1.4, jitter: 0 },
  grind: { top: [7, 8, 11, 1], low: [16, 18, 24, 1], a1: [150, 160, 185, 0.07], a2: [120, 130, 150, 0.06], a3: [120, 130, 150, 0.07], speed: 0.45, jitter: 0 },
  fear: { top: [8, 6, 10, 1], low: [34, 7, 15, 1], a1: [255, 70, 95, 0.15], a2: [130, 40, 90, 0.13], a3: [255, 60, 80, 0.16], speed: 0.8, jitter: 0.5 },
  chaos: { top: [6, 6, 14, 1], low: [20, 10, 38, 1], a1: [170, 120, 255, 0.2], a2: [70, 230, 255, 0.15], a3: [255, 80, 200, 0.12], speed: 2.2, jitter: 2.4 },
};
const FADE_S = 3, FRAME_MS = 32, STILL_T = 12;

const rgba = (c: RGBA) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${c[3]})`;
const mix = (a: RGBA, b: RGBA, k: number): RGBA => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k];
const mixSky = (a: Sky, b: Sky, k: number): Sky => ({ top: mix(a.top, b.top, k), low: mix(a.low, b.low, k), a1: mix(a.a1, b.a1, k), a2: mix(a.a2, b.a2, k), a3: mix(a.a3, b.a3, k), speed: a.speed + (b.speed - a.speed) * k, jitter: a.jitter + (b.jitter - a.jitter) * k });
const hexA = (hex: string, a: number) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };

type At = { node: number } | { coin: number };
interface Streak { from: number; to: At; t0: number; dur: number; col: string; hit: boolean }
interface Ring { at: At; r0: number; r1: number; t0: number; dur: number; col: string; w: number }

export interface Renderer {
  resize(w: number, h: number, dpr: number): void;
  setModel(m: SwarmModel | null): void;
  setRegime(r: Regime | null): void;
  event(e: SwarmEvent): void;
  start(): void;
  stop(): void;
  destroy(): void;
  /** Average draw time in ms over the last 60 frames (dev performance check). */
  stats(): { drawMs: number };
}

/** The Swarm backdrop on a 2D canvas. Returns null when the browser gives no 2D context. */
export function createRenderer(canvas: HTMLCanvasElement, opts: { reduced: boolean }): Renderer | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const c: CanvasRenderingContext2D = ctx; // non-null alias: narrowing of `ctx` does not reach the function declarations below
  const { up: UP, down: DOWN, amber: AMBER, cyan: CYAN, white: WHITE, coin: COIN } = readColours();
  const t0 = performance.now();
  const now = () => (performance.now() - t0) / 1000;
  const rnd = mulberry32(11);
  const stars = Array.from({ length: 140 }, () => ({ x: rnd(), y: rnd(), a: 0.15 + rnd() * 0.5, ph: rnd() * 6.28 }));
  const glowCache = new Map<string, HTMLCanvasElement>();
  const deadNow = new Set<string>();
  let W = 0, H = 0, D = 0, raf = 0, last = 0, running = false, drawAvg = 0;
  let model: SwarmModel | null = null;
  let px = new Float32Array(0), py = new Float32Array(0), hot = new Float32Array(0), pulse = new Float32Array(0);
  let streaks: Streak[] = [], rings: Ring[] = [];
  let from: Sky = SKIES.none, to: Sky = SKIES.none, fadeAt = -FADE_S;

  function glow(col: string) {
    let g = glowCache.get(col);
    if (g) return g;
    g = document.createElement('canvas'); g.width = g.height = 64;
    const x = g.getContext('2d');
    if (x) {
      const grad = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, col); grad.addColorStop(0.16, col); grad.addColorStop(0.34, hexA(col, 0.32)); grad.addColorStop(1, hexA(col, 0));
      x.fillStyle = grad; x.fillRect(0, 0, 64, 64);
    }
    glowCache.set(col, g);
    return g;
  }
  function blob(x: number, y: number, r: number, col: RGBA) {
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(col)); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  const mx = () => W * 0.04, my = () => H * 0.07;
  const coinX = (i: number) => mx() + model!.coins[i]!.x * (W - 2 * mx());
  const coinY = (i: number) => my() + model!.coins[i]!.y * (H - 2 * my());
  const atX = (a: At) => ('node' in a ? px[a.node]! : coinX(a.coin));
  const atY = (a: At) => ('node' in a ? py[a.node]! : coinY(a.coin));
  const skyAt = (t: number) => { const k = Math.min(1, (t - fadeAt) / FADE_S); return k >= 1 ? to : mixSky(from, to, k); };

  function frame(t: number, dt: number) {
    const begin = performance.now();
    const sky = skyAt(t), sp = sky.speed, big = Math.max(W, H);
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, rgba(sky.top)); g.addColorStop(1, rgba(sky.low));
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    blob(W * (0.26 + 0.12 * Math.sin(t * 0.05 * sp)), H * 0.2, big * 0.5, sky.a1);
    blob(W * (0.78 + 0.1 * Math.cos(t * 0.04 * sp)), H * 0.66, big * 0.45, sky.a2);
    blob(W * 0.5, H * 1.05, big * 0.55, sky.a3);
    c.fillStyle = '#fff';
    for (const s of stars) { c.globalAlpha = s.a * (0.6 + 0.4 * Math.sin(t * 0.8 + s.ph)); c.fillRect(s.x * W, s.y * H, 1, 1); }
    c.globalAlpha = 1;
    // A dark band behind the reading column keeps text legible over the brightest parts of the swarm.
    const band = c.createRadialGradient(W / 2, H * 0.55, 0, W / 2, H * 0.55, Math.max(380, W * 0.34));
    band.addColorStop(0, 'rgba(4,5,9,0.55)'); band.addColorStop(1, 'rgba(4,5,9,0)');
    c.fillStyle = band; c.fillRect(0, 0, W, H);
    if (model) {
      const m = model, j = opts.reduced ? 0 : sky.jitter, x0 = mx(), y0 = my();
      m.nodes.forEach((n, i) => {
        px[i] = x0 + n.x * (W - 2 * x0) + Math.sin(t * 0.35 * sp + n.phase) * 9 + (j ? (Math.random() - 0.5) * j : 0);
        py[i] = y0 + n.y * (H - 2 * y0) + Math.cos(t * 0.28 * sp + n.phase * 1.3) * 7 + (j ? (Math.random() - 0.5) * j : 0);
        hot[i] = hot[i]! - Math.sign(hot[i]!) * Math.min(Math.abs(hot[i]!), dt * 0.7);
      });
      c.lineWidth = 1;
      for (const [colour, pairs] of m.alliesByColour) {
        c.strokeStyle = hexA(colour, 0.16); c.beginPath();
        for (const [a, b] of pairs) { c.moveTo(px[a]!, py[a]!); c.lineTo(px[b]!, py[b]!); }
        c.stroke();
      }
      c.setLineDash([3, 6]); c.strokeStyle = hexA(DOWN, 0.38); c.beginPath();
      for (const [a, b] of m.feuds) { c.moveTo(px[a]!, py[a]!); c.lineTo(px[b]!, py[b]!); }
      c.stroke(); c.setLineDash([]);
      c.font = "500 10px 'Geist Mono Variable', ui-monospace, monospace"; c.textBaseline = 'middle'; c.textAlign = 'left';
      m.coins.forEach((coin, i) => {
        const x = coinX(i), y = coinY(i), dead = coin.dead || deadNow.has(coin.mint), col = dead ? DOWN : COIN;
        if (pulse[i]! > 0) { const s = 36 + pulse[i]! * 34; c.drawImage(glow(dead ? DOWN : AMBER), x - s / 2, y - s / 2, s, s); pulse[i] = Math.max(0, pulse[i]! - dt * 1.4); }
        c.save(); c.translate(x, y); c.rotate(Math.PI / 4); c.globalAlpha = dead ? 0.45 : 0.95; c.fillStyle = col; c.fillRect(-3.5, -3.5, 7, 7); c.restore();
        // Phones keep the diamonds but drop the $TICKER labels: under the cards they only clutter the text.
        if (W >= 768) { c.globalAlpha = dead ? 0.4 : 0.7; c.fillStyle = col; c.fillText(`$${coin.symbol}${dead ? ' ✕' : ''}`, x + 9, y); c.globalAlpha = 1; }
      });
      m.nodes.forEach((n, i) => {
        const h = hot[i]!, heat = Math.abs(h), col = h < -0.05 ? DOWN : n.colour, size = n.r * (7 + heat * 7);
        c.globalAlpha = Math.min(1, Math.max(0, n.glow + heat * 0.5 + 0.12 * Math.sin(t * 1.3 + n.phase)));
        c.drawImage(glow(col), px[i]! - size / 2, py[i]! - size / 2, size, size);
      });
      c.globalAlpha = 1;
      streaks = streaks.filter((s) => t - s.t0 < s.dur);
      for (const s of streaks) {
        const k = (t - s.t0) / s.dur, ax = px[s.from]!, ay = py[s.from]!, bx = atX(s.to), by = atY(s.to);
        const cx = (ax + bx) / 2 + (by - ay) * 0.18, cy = (ay + by) / 2 - (bx - ax) * 0.18;
        const at = (u: number) => { const iu = 1 - u; return [iu * iu * ax + 2 * iu * u * cx + u * u * bx, iu * iu * ay + 2 * iu * u * cy + u * u * by] as const; };
        const [x, y] = at(k), [tx, ty] = at(Math.max(0, k - 0.16));
        c.strokeStyle = hexA(s.col, 0.55); c.lineWidth = 1.5; c.beginPath(); c.moveTo(tx, ty); c.lineTo(x, y); c.stroke();
        c.drawImage(glow(s.col), x - 8, y - 8, 16, 16);
        if (k > 0.92 && !s.hit) { s.hit = true; if ('coin' in s.to) pulse[s.to.coin] = 1; else hot[s.to.node] = 0.6; }
      }
      rings = rings.filter((r) => t - r.t0 < r.dur);
      for (const r of rings) {
        const k = (t - r.t0) / r.dur;
        if (k < 0) continue;
        c.strokeStyle = hexA(r.col, (1 - k) * 0.8); c.lineWidth = r.w * (1 - k) + 0.5;
        c.beginPath(); c.arc(atX(r.at), atY(r.at), r.r0 + (r.r1 - r.r0) * (1 - (1 - k) ** 3), 0, Math.PI * 2); c.stroke();
      }
    }
    drawAvg = drawAvg * 0.95 + (performance.now() - begin) * 0.05;
  }

  function loop(ts: number) {
    raf = requestAnimationFrame(loop);
    if (ts - last < FRAME_MS) return;
    const dt = last ? Math.min(0.1, (ts - last) / 1000) : 1 / 30;
    last = ts;
    frame(now(), dt);
  }
  const still = () => { if (W && H) frame(STILL_T, 0); };
  /** Redraws now: a resized buffer is blank until the next frame, and frames come 32 ms apart. */
  const redraw = () => { if (opts.reduced || !running) still(); else if (W && H) frame(now(), 0); };

  function nearest(x: number, y: number, k: number): number[] {
    return model!.nodes.map((_, i) => [i, Math.hypot(px[i]! - x, py[i]! - y)] as const).sort((a, b) => a[1] - b[1]).slice(0, k).map(([i]) => i);
  }

  return {
    resize(w, h, dpr) {
      // Same size, same buffer: assigning canvas.width clears it, and a phone's URL bar sliding fires resize for nothing.
      if (w === W && h === H && dpr === D) return;
      W = w; H = h; D = dpr;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      redraw();
    },
    setModel(m) {
      const old = model;
      model = m;
      const n = m?.nodes.length ?? 0, nc = m?.coins.length ?? 0;
      const oldHot = hot, oldPulse = pulse;
      px = new Float32Array(n); py = new Float32Array(n); hot = new Float32Array(n); pulse = new Float32Array(nc);
      if (old && m) {
        // Animations in flight follow their agent and coin into the new model (by id and mint); those whose target is gone end.
        for (const [id, i] of m.index) { const o = old.index.get(id); if (o !== undefined) hot[i] = oldHot[o] ?? 0; }
        for (const [mint, i] of m.coinIndex) { const o = old.coinIndex.get(mint); if (o !== undefined) pulse[i] = oldPulse[o] ?? 0; }
        const node = (i: number) => { const id = old.nodes[i]?.id; return id === undefined ? undefined : m.index.get(id); };
        const coin = (i: number) => { const mint = old.coins[i]?.mint; return mint === undefined ? undefined : m.coinIndex.get(mint); };
        const at = (a: At): At | null => { const i = 'node' in a ? node(a.node) : coin(a.coin); return i === undefined ? null : 'node' in a ? { node: i } : { coin: i }; };
        streaks = streaks.flatMap((s) => { const f = node(s.from), to = at(s.to); return f === undefined || !to ? [] : [{ ...s, from: f, to }]; });
        rings = rings.flatMap((r) => { const to = at(r.at); return to ? [{ ...r, at: to }] : []; });
      } else { streaks = []; rings = []; }
      if (opts.reduced || !running) still();
    },
    setRegime(r) {
      const target = SKIES[r ?? 'none'];
      if (target === to) return;
      const t = opts.reduced ? STILL_T : now();
      from = opts.reduced ? target : skyAt(t); to = target; fadeAt = opts.reduced ? -FADE_S : t;
      if (opts.reduced || !running) still();
    },
    event(e) {
      if (!model) return;
      const tg = targetsFor(model, e);
      if (e.kind === 'rug' && tg.coin !== null) deadNow.add(model.coins[tg.coin]!.mint);
      if (opts.reduced) { still(); return; }
      const t = now();
      const ring = (at: At, r1: number, col: string, w: number, dur: number, r0 = 4, delay = 0) => rings.push({ at, r0, r1, t0: t + delay, dur, col, w });
      if (tg.from !== null) hot[tg.from] = e.kind === 'transfer' ? 0.6 : e.kind === 'buy' || e.kind === 'sell' ? 0.8 : 1;
      switch (e.kind) {
        case 'buy': case 'sell':
          if (tg.from !== null && tg.coin !== null) streaks.push({ from: tg.from, to: { coin: tg.coin }, t0: t, dur: 1.1, col: e.kind === 'buy' ? UP : DOWN, hit: false });
          break;
        case 'transfer':
          if (tg.from !== null && tg.toNode !== null) streaks.push({ from: tg.from, to: { node: tg.toNode }, t0: t, dur: 1.3, col: WHITE, hit: false });
          break;
        case 'post':
          if (tg.from !== null) ring({ node: tg.from }, 34, CYAN, 1.5, 1.2);
          break;
        case 'launch':
          if (tg.coin !== null) { pulse[tg.coin] = 1; ring({ coin: tg.coin }, 90, AMBER, 3, 1.8, 6); }
          else if (tg.from !== null) ring({ node: tg.from }, 90, AMBER, 3, 1.8, 6);
          break;
        case 'rug': {
          const at: At | null = tg.coin !== null ? { coin: tg.coin } : tg.from !== null ? { node: tg.from } : null;
          if (!at) break;
          if (tg.coin !== null) pulse[tg.coin] = 1;
          const big = Math.max(W, H);
          ring(at, big * 0.6, DOWN, 6, 2.2, 10);
          ring(at, big * 0.35, AMBER, 3, 1.8, 4, 0.25);
          for (const i of nearest(atX(at), atY(at), 10)) hot[i] = -1;
          break;
        }
      }
    },
    start() { if (running || opts.reduced) return; running = true; last = 0; raf = requestAnimationFrame(loop); },
    stop() { running = false; cancelAnimationFrame(raf); },
    destroy() { running = false; cancelAnimationFrame(raf); model = null; },
    stats: () => ({ drawMs: Math.round(drawAvg * 100) / 100 }),
  };
}
