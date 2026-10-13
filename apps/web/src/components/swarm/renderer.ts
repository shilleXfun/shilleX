import type { Regime } from '@shillex/shared';
import { mulberry32, type Pt } from '../../lib/forceLayout';
import { coinSpot, type SwarmModel } from './model';
import { targetsFor, type SwarmEvent } from './bus';
import { readColours } from './palette';

type RGBA = [number, number, number, number];
/** `drift` scales how far each light wanders around its place: slow in a grind, wide in euphoria. */
interface Sky { top: RGBA; low: RGBA; a1: RGBA; a2: RGBA; a3: RGBA; speed: number; jitter: number; drift: number }

/**
 * Sky per market regime; `none` is the sky without an agent world or before the weather loads. Every regime keeps one
 * deep night blue: the market only shifts a faint wash of colour and how fast the lights drift, never the ground (no
 * red or maroon sky behind the reading column).
 */
export const SKIES: Record<Regime | 'none', Sky> = {
  none: { top: [5, 6, 11, 1], low: [9, 11, 21, 1], a1: [255, 184, 107, 0.035], a2: [125, 227, 255, 0.03], a3: [140, 120, 255, 0.045], speed: 0.5, jitter: 0, drift: 0.9 },
  euphoria: { top: [5, 6, 11, 1], low: [11, 12, 21, 1], a1: [255, 184, 107, 0.06], a2: [75, 240, 160, 0.035], a3: [140, 120, 255, 0.04], speed: 0.8, jitter: 0, drift: 1.1 },
  grind: { top: [5, 6, 10, 1], low: [9, 11, 19, 1], a1: [150, 160, 185, 0.03], a2: [120, 140, 170, 0.03], a3: [120, 130, 170, 0.035], speed: 0.4, jitter: 0, drift: 0.6 },
  fear: { top: [5, 5, 11, 1], low: [9, 10, 22, 1], a1: [150, 130, 255, 0.04], a2: [90, 120, 200, 0.035], a3: [120, 100, 220, 0.045], speed: 0.55, jitter: 0, drift: 0.8 },
  chaos: { top: [5, 5, 12, 1], low: [10, 9, 24, 1], a1: [170, 120, 255, 0.06], a2: [70, 230, 255, 0.045], a3: [140, 110, 255, 0.05], speed: 0.9, jitter: 0.4, drift: 1 },
};
const FADE_S = 3, FRAME_MS = 32, STILL_T = 12;

const rgba = (c: RGBA) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${c[3]})`;
const mix = (a: RGBA, b: RGBA, k: number): RGBA => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k];
const mixSky = (a: Sky, b: Sky, k: number): Sky => ({ top: mix(a.top, b.top, k), low: mix(a.low, b.low, k), a1: mix(a.a1, b.a1, k), a2: mix(a.a2, b.a2, k), a3: mix(a.a3, b.a3, k), speed: a.speed + (b.speed - a.speed) * k, jitter: a.jitter + (b.jitter - a.jitter) * k, drift: a.drift + (b.drift - a.drift) * k });
const hexA = (hex: string, a: number) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };

/** How long an agent that acted glows brighter. */
const AFTERGLOW_S = 20;
/**
 * The afterglow `age` seconds after an agent acted: fading from 1 to 0 over 20 s, read off the clock so a tab that comes
 * back late does not replay it. Under reduced motion it does not fade: on for 20 s, then off.
 */
export const afterglow = (age: number, reduced: boolean) => (age >= AFTERGLOW_S || !(age >= 0) ? 0 : reduced ? 1 : 1 - age / AFTERGLOW_S);

/**
 * A light's brightness at time t: its mood glow, breathing on its own cycle (quicker and deeper when happier, never
 * for ghosts), plus the heat of an event that just touched it and the 20 s afterglow of having acted. Clamped to 0..1.
 */
export function nodeAlpha(n: { glow: number; ghost: boolean; breath: number; phase: number }, t: number, heat: number, recent: number) {
  const depth = 0.06 + 0.1 * ((6 - n.breath) / 3);
  const breath = n.ghost ? 0 : depth * Math.sin((2 * Math.PI * t) / n.breath + n.phase);
  return Math.min(1, Math.max(0, n.glow + heat * 0.5 + 0.25 * recent + breath));
}

/** What an animation is on: an agent, a coin of the model, or a normalised spot (where a coin launched since the coins were fetched will sit). */
type At = { node: number } | { coin: number } | { spot: Pt };
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
  const stars = Array.from({ length: 120 }, () => ({ x: rnd(), y: rnd(), a: 0.08 + rnd() * 0.32, ph: rnd() * 6.28 }));
  const glowCache = new Map<string, HTMLCanvasElement>();
  const deadNow = new Set<string>();
  /** Coins launched since the model's coins were fetched, by mint: their creator, so trades on one streak to where it will sit. */
  const launched = new Map<string, string>();
  let W = 0, H = 0, D = 0, raf = 0, last = 0, running = false, drawAvg = 0;
  let model: SwarmModel | null = null;
  let px = new Float32Array(0), py = new Float32Array(0), hot = new Float32Array(0), pulse = new Float32Array(0);
  /** When each agent last acted (seconds on this renderer's clock), for its afterglow; -Infinity for never. */
  let actedAt = new Float64Array(0);
  let glowTimer: ReturnType<typeof setTimeout> | undefined;
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
  const toX = (x: number) => mx() + x * (W - 2 * mx()), toY = (y: number) => my() + y * (H - 2 * my());
  const coinX = (i: number) => toX(model!.coins[i]!.x);
  const coinY = (i: number) => toY(model!.coins[i]!.y);
  const atX = (a: At) => ('node' in a ? px[a.node]! : 'coin' in a ? coinX(a.coin) : toX(a.spot.x));
  const atY = (a: At) => ('node' in a ? py[a.node]! : 'coin' in a ? coinY(a.coin) : toY(a.spot.y));
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
    const band = c.createRadialGradient(W / 2, H * 0.5, 0, W / 2, H * 0.5, Math.max(420, W * 0.42));
    band.addColorStop(0, 'rgba(4,5,10,0.62)'); band.addColorStop(1, 'rgba(4,5,10,0)');
    c.fillStyle = band; c.fillRect(0, 0, W, H);
    if (model) {
      const m = model, j = opts.reduced ? 0 : sky.jitter, x0 = mx(), y0 = my();
      m.nodes.forEach((n, i) => {
        px[i] = x0 + n.x * (W - 2 * x0) + Math.sin(t * 0.35 * sp + n.phase) * 9 * sky.drift + (j ? (Math.random() - 0.5) * j : 0);
        py[i] = y0 + n.y * (H - 2 * y0) + Math.cos(t * 0.28 * sp + n.phase * 1.3) * 7 * sky.drift + (j ? (Math.random() - 0.5) * j : 0);
        hot[i] = hot[i]! - Math.sign(hot[i]!) * Math.min(Math.abs(hot[i]!), dt * 0.7);
      });
      c.lineWidth = 1;
      for (const [colour, pairs] of m.alliesByColour) {
        c.strokeStyle = hexA(colour, 0.07); c.beginPath();
        for (const [a, b] of pairs) { c.moveTo(px[a]!, py[a]!); c.lineTo(px[b]!, py[b]!); }
        c.stroke();
      }
      c.setLineDash([2, 7]); c.strokeStyle = hexA(DOWN, 0.1); c.beginPath();
      for (const [a, b] of m.feuds) { c.moveTo(px[a]!, py[a]!); c.lineTo(px[b]!, py[b]!); }
      c.stroke(); c.setLineDash([]);
      // Coins are small quiet diamonds and never labelled: under the cards a $TICKER only clutters the text. Past the
      // busiest MAX_COINS a coin shows only while a trade or launch lights it, fading with its pulse.
      m.coins.forEach((coin, i) => {
        const p = pulse[i]!;
        if (!coin.shown && !(p > 0)) return;
        const x = coinX(i), y = coinY(i), dead = coin.dead || deadNow.has(coin.mint);
        if (p > 0) { const s = 28 + p * 24; c.globalAlpha = 0.55; c.drawImage(glow(AMBER), x - s / 2, y - s / 2, s, s); pulse[i] = Math.max(0, p - dt * 1.4); }
        c.save(); c.translate(x, y); c.rotate(Math.PI / 4); c.globalAlpha = (dead ? 0.1 : 0.4) * (coin.shown ? 1 : p); c.fillStyle = dead ? WHITE : COIN; c.fillRect(-2.5, -2.5, 5, 5); c.restore();
      });
      c.globalAlpha = 1;
      // An agent that acted glows brighter for 20 s, by the clock (a still frame passes a fixed t).
      const wall = now();
      m.nodes.forEach((n, i) => {
        // Quieter than full strength: the lights are a field behind the page, not content of their own.
        const heat = Math.abs(hot[i]!), size = n.r * (6 + heat * 5);
        c.globalAlpha = 0.6 * nodeAlpha(n, t, heat, afterglow(wall - actedAt[i]!, opts.reduced));
        const col = n.colour;
        c.drawImage(glow(col), px[i]! - size / 2, py[i]! - size / 2, size, size);
        // The viewer's own agent (RAISE): a thin amber ring, static, so it reads the same under reduced motion.
        if (n.own) { c.globalAlpha = 0.9; c.strokeStyle = AMBER; c.lineWidth = 1.5; c.beginPath(); c.arc(px[i]!, py[i]!, n.r * 3.2 + 4, 0, Math.PI * 2); c.stroke(); }
      });
      c.globalAlpha = 1;
      streaks = streaks.filter((s) => t - s.t0 < s.dur);
      for (const s of streaks) {
        const k = (t - s.t0) / s.dur, ax = px[s.from]!, ay = py[s.from]!, bx = atX(s.to), by = atY(s.to);
        const cx = (ax + bx) / 2 + (by - ay) * 0.18, cy = (ay + by) / 2 - (bx - ax) * 0.18;
        const at = (u: number) => { const iu = 1 - u; return [iu * iu * ax + 2 * iu * u * cx + u * u * bx, iu * iu * ay + 2 * iu * u * cy + u * u * by] as const; };
        const [x, y] = at(k), [tx, ty] = at(Math.max(0, k - 0.16));
        c.strokeStyle = hexA(s.col, 0.28); c.lineWidth = 1; c.beginPath(); c.moveTo(tx, ty); c.lineTo(x, y); c.stroke();
        c.globalAlpha = 0.55; c.drawImage(glow(s.col), x - 6, y - 6, 12, 12); c.globalAlpha = 1;
        if (k > 0.92 && !s.hit) { s.hit = true; if ('coin' in s.to) pulse[s.to.coin] = 1; else if ('node' in s.to) hot[s.to.node] = 0.6; }
      }
      rings = rings.filter((r) => t - r.t0 < r.dur);
      for (const r of rings) {
        const k = (t - r.t0) / r.dur;
        if (k < 0) continue;
        c.strokeStyle = hexA(r.col, (1 - k) * 0.32); c.lineWidth = r.w * (1 - k) * 0.6 + 0.5;
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
  const still = () => {
    if (!W || !H) return;
    frame(STILL_T, 0);
    // A still frame shows who acted in the last 20 s; it is redrawn once, when the earliest of those glows ends.
    clearTimeout(glowTimer);
    const wall = now();
    let next = Infinity;
    for (const at of actedAt) { const end = at + AFTERGLOW_S; if (end > wall && end < next) next = end; }
    if (next < Infinity) glowTimer = setTimeout(still, (next - wall) * 1000 + 50);
  };
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
      const oldHot = hot, oldPulse = pulse, oldActed = actedAt;
      px = new Float32Array(n); py = new Float32Array(n); hot = new Float32Array(n); pulse = new Float32Array(nc); actedAt = new Float64Array(n).fill(-Infinity);
      if (old && m) {
        // Animations in flight follow their agent and coin into the new model (by id and mint); those whose target is gone end.
        for (const [id, i] of m.index) {
          const o = old.index.get(id);
          if (o !== undefined) hot[i] = oldHot[o] ?? 0;
          if (o !== undefined) actedAt[i] = oldActed[o] ?? -Infinity;
        }
        for (const [mint, i] of m.coinIndex) { const o = old.coinIndex.get(mint); if (o !== undefined) pulse[i] = oldPulse[o] ?? 0; }
        const node = (i: number) => { const id = old.nodes[i]?.id; return id === undefined ? undefined : m.index.get(id); };
        const coin = (i: number) => { const mint = old.coins[i]?.mint; return mint === undefined ? undefined : m.coinIndex.get(mint); };
        const at = (a: At): At | null => {
          if ('spot' in a) return a;
          const i = 'node' in a ? node(a.node) : coin(a.coin);
          return i === undefined ? null : 'node' in a ? { node: i } : { coin: i };
        };
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
      const m = model, tg = targetsFor(m, e);
      if (e.kind === 'rug' && tg.coin !== null) deadNow.add(m.coins[tg.coin]!.mint);
      if (e.kind === 'launch' && e.mint && tg.coin === null) {
        launched.set(e.mint, e.agentId);
        if (launched.size > 64) launched.delete(launched.keys().next().value as string);
      }
      // Who acted glows brighter for 20 s; set before the still-frame return, so the still frame shows it too.
      if (tg.from !== null) actedAt[tg.from] = now();
      if (opts.reduced) { still(); return; }
      const t = now();
      const ring = (at: At, r1: number, col: string, w: number, dur: number, r0 = 4, delay = 0) => rings.push({ at, r0, r1, t0: t + delay, dur, col, w });
      // The coin an event names; one the model does not have yet is the spot it will take, beside its creator if that launch was seen.
      const coinAt = (): At | null => {
        if (tg.coin !== null) return { coin: tg.coin };
        if (!('mint' in e) || !e.mint) return null;
        const owner = m.index.get(launched.get(e.mint) ?? '');
        return { spot: coinSpot(e.mint, owner === undefined ? undefined : m.nodes[owner]) };
      };
      if (tg.from !== null) hot[tg.from] = e.kind === 'transfer' ? 0.6 : e.kind === 'buy' || e.kind === 'sell' ? 0.8 : 1;
      switch (e.kind) {
        case 'buy': case 'sell': {
          const to = coinAt();
          if (tg.from !== null && to) streaks.push({ from: tg.from, to, t0: t, dur: 1.1, col: e.kind === 'buy' ? UP : DOWN, hit: false });
          break;
        }
        case 'transfer':
          if (tg.from !== null && tg.toNode !== null) streaks.push({ from: tg.from, to: { node: tg.toNode }, t0: t, dur: 1.3, col: WHITE, hit: false });
          break;
        case 'post':
          if (tg.from !== null) ring({ node: tg.from }, 22, CYAN, 1, 1.2);
          break;
        case 'launch': {
          const at = coinAt();
          if (at && 'coin' in at) pulse[at.coin] = 1;
          if (at) ring(at, 56, AMBER, 2, 1.8, 6);
          else if (tg.from !== null) ring({ node: tg.from }, 56, AMBER, 2, 1.8, 6);
          break;
        }
        case 'rug': {
          const at: At | null = tg.coin !== null ? { coin: tg.coin } : tg.from !== null ? { node: tg.from } : null;
          if (!at) break;
          if (tg.coin !== null) pulse[tg.coin] = 1;
          const big = Math.max(W, H);
          ring(at, big * 0.2, DOWN, 3, 2.4, 8);
          for (const i of nearest(atX(at), atY(at), 6)) hot[i] = -0.6;
          break;
        }
      }
    },
    start() { if (running || opts.reduced) return; running = true; last = 0; raf = requestAnimationFrame(loop); },
    stop() { running = false; cancelAnimationFrame(raf); },
    destroy() { running = false; cancelAnimationFrame(raf); clearTimeout(glowTimer); model = null; },
    stats: () => ({ drawMs: Math.round(drawAvg * 100) / 100 }),
  };
}
