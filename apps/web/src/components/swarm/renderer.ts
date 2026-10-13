import type { Regime } from '@shillex/shared';
import { mulberry32, type Pt } from '../../lib/forceLayout';
import { coinSpot, GHOST, hash, LONER, type SwarmModel, type SwarmNode } from './model';
import { targetsFor, type SwarmEvent, type SwarmStage } from './bus';
import { hexA, hueHex, mixHex, readColours } from './palette';

type RGBA = [number, number, number, number];
/** `drift` scales how far each light wanders on its orbit: little in a grind, wide in euphoria. */
interface Sky { top: RGBA; low: RGBA; a1: RGBA; a2: RGBA; a3: RGBA; speed: number; jitter: number; drift: number }

/**
 * Sky per market regime; `none` is the sky without an agent world or before the weather loads. Every regime keeps one
 * deep night blue, close to the page's void so the lights read: the market only shifts a faint wash of colour and how
 * fast the lights drift, never the ground (no red or maroon sky behind the reading column).
 */
export const SKIES: Record<Regime | 'none', Sky> = {
  none: { top: [4, 6, 13, 1], low: [8, 10, 20, 1], a1: [255, 184, 107, 0.035], a2: [125, 227, 255, 0.03], a3: [140, 120, 255, 0.045], speed: 0.5, jitter: 0, drift: 0.9 },
  euphoria: { top: [4, 6, 13, 1], low: [10, 11, 20, 1], a1: [255, 184, 107, 0.06], a2: [75, 240, 160, 0.035], a3: [140, 120, 255, 0.04], speed: 0.8, jitter: 0, drift: 1.1 },
  grind: { top: [4, 6, 12, 1], low: [8, 10, 18, 1], a1: [150, 160, 185, 0.03], a2: [120, 140, 170, 0.03], a3: [120, 130, 170, 0.035], speed: 0.4, jitter: 0, drift: 0.6 },
  fear: { top: [4, 5, 13, 1], low: [8, 9, 21, 1], a1: [150, 130, 255, 0.04], a2: [90, 120, 200, 0.035], a3: [120, 100, 220, 0.045], speed: 0.55, jitter: 0, drift: 0.8 },
  chaos: { top: [4, 5, 14, 1], low: [9, 8, 23, 1], a1: [170, 120, 255, 0.06], a2: [70, 230, 255, 0.045], a3: [140, 110, 255, 0.05], speed: 0.9, jitter: 0.4, drift: 1 },
};
const FADE_S = 3, STILL_T = 12;
/** Frame budget: about 60 fps on a desktop (a 120 Hz screen draws every other frame), about 30 on a phone. */
const FRAME_MS = 12, LITE_FRAME_MS = 32;
/** Phones and tablets, for the backdrop and its overlays: a device pixel ratio of at most 1.5 and half the effects. */
export const LITE_QUERY = '(max-width: 767px), (pointer: coarse)';

const rgba = (c: RGBA) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${c[3]})`;
const mix = (a: RGBA, b: RGBA, k: number): RGBA => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k];
const mixSky = (a: Sky, b: Sky, k: number): Sky => ({ top: mix(a.top, b.top, k), low: mix(a.low, b.low, k), a1: mix(a.a1, b.a1, k), a2: mix(a.a2, b.a2, k), a3: mix(a.a3, b.a3, k), speed: a.speed + (b.speed - a.speed) * k, jitter: a.jitter + (b.jitter - a.jitter) * k, drift: a.drift + (b.drift - a.drift) * k });
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** `v` moved toward `target` by at most `d`. */
const step = (v: number, target: number, d: number) => (v < target ? Math.min(target, v + d) : Math.max(target, v - d));

/**
 * How each stage draws the field (x-revamp §4). 'hero' (the home hero, where the world is the show) zooms in a little
 * and turns the lights, stars, nebulae and the network's motion up; 'calm' (behind reading) dims all of it, keeps the
 * idle motion small and faint, darkens a band behind the reading column and thins the reply arcs. `orbit` scales the
 * lights' orbits, breathing and the fibres' sway; `fibre` the fibres' alpha; `pulse` the idle signals' alpha and `rate`
 * how many start per second across the field. The renderer eases from one stage to the other over STAGE_S.
 */
interface Look { zoom: number; light: number; size: number; band: number; stars: number; nebula: number; arc: number; arcAlpha: number; orbit: number; fibre: number; pulse: number; rate: number }
const LOOKS: Record<SwarmStage['stage'], Look> = {
  // Calm is what everyone sees most (the X layout over it), so the network stays visibly alive in the gutters: lights near
  // full, fibres and signals up, the reading band light (the columns are glass of their own).
  calm: { zoom: 1, light: 0.9, size: 1.05, band: 0.35, stars: 1.1, nebula: 0.95, arc: 1.4, arcAlpha: 0.9, orbit: 1, fibre: 1.35, pulse: 1.1, rate: 3.4 },
  hero: { zoom: 1.12, light: 1, size: 1.4, band: 0, stars: 1.35, nebula: 1.2, arc: 2.2, arcAlpha: 1, orbit: 1.2, fibre: 1.6, pulse: 1.4, rate: 5.2 },
};
const STAGE_S = 1.4;
const LOOK_KEYS = Object.keys(LOOKS.calm) as (keyof Look)[];
/** Writes into `out` the look `k` of the way from calm (0) to hero (1); no allocation per frame. */
function lookAt(out: Look, k: number) {
  for (let i = 0; i < LOOK_KEYS.length; i++) { const key = LOOK_KEYS[i]!; out[key] = LOOKS.calm[key] + (LOOKS.hero[key] - LOOKS.calm[key]) * k; }
  return out;
}

/** How long the focus ring takes to come and go, and how much the other lights dim while one agent is focused. */
const FOCUS_S = 0.25, FOCUS_DIM = 0.42;
/** A reply arc's travelling dash takes this long; at most this many at once (half on a phone). */
const REPLY_S = 0.9, MAX_REPLIES = 6;
/** Each faction with at least this many members gets a faint nebula, this strong at full stage. */
const NEBULA_MIN = 3, NEBULA_A = 0.075;
/** How much a light's size breathes in and out (times the stage's `orbit`). */
const BREATH_SIZE = 0.1;
/**
 * The sky (its gradient, the aurora blobs, the nebulae and the reading band) is all smooth, so it is painted at a quarter
 * of the size and scaled up: one full-screen fill per frame instead of six, which matters at 60 fps on a large screen.
 */
const SKY_SCALE = 0.25;

/**
 * The network ("like neurons"): fibres between agents, faintest first. Links to nearby agents (so the field reads as one
 * network), ties within a faction, allies, and feuds (dashed). Alpha and width per kind, before the stage's `fibre`.
 */
const NEAR = 0, TIE = 1, ALLY = 2, FEUD = 3;
const FIBRE_ALPHA = [0.05, 0.065, 0.1, 0.09], FIBRE_WIDTH = [0.75, 0.9, 1, 1];
/** The pale blue of a link between neighbours, and of the signals that run along it. */
const NEURAL = '#A7B6E8', NEURAL_SIGNAL = '#D6E2FF';
/** At most this many fibres (half on a phone), of which at most this many feuds. */
const MAX_FIBRES = 600, MAX_FEUD_FIBRES = 60;
/** How far a fibre's bend sways (times the stage's `orbit`), as a share of its bend. */
const SWAY = 0.35;
/**
 * Signals: slots for idle and event pulses together, and the most of each at once (half on a phone; the two caps fit in
 * the slots). Speeds in px/s: idle signals amble, a real event's run fast.
 */
const PULSE_SLOTS = 28, IDLE_MAX = 10, EVENT_MAX = 16, IDLE_SPEED = 110, EVENT_SPEED = 330;
/** The chance an idle signal travels on from the light it reaches, so firing runs in short chains. */
const CASCADE = 0.35;
const FEUD_DASH = [2, 7], NO_DASH: number[] = [];

/** How long an agent that acted glows brighter. */
const AFTERGLOW_S = 20;
/**
 * The afterglow `age` seconds after an agent acted: fading from 1 to 0 over 20 s, read off the clock so a tab that comes
 * back late does not replay it. Under reduced motion it does not fade: on for 20 s, then off.
 */
export const afterglow = (age: number, reduced: boolean) => (age >= AFTERGLOW_S || !(age >= 0) ? 0 : reduced ? 1 : 1 - age / AFTERGLOW_S);
/** An agent that acted in the last minute is drawn larger, by up to RECENT_GROW. */
const RECENT_S = 60, RECENT_GROW = 0.6;
/** How much larger, `age` seconds after the agent acted: 1 shrinking to 0 over a minute (slowly at first). Under reduced motion: on for a minute, then off. */
export const recentGlow = (age: number, reduced: boolean) => (age >= RECENT_S || !(age >= 0) ? 0 : reduced ? 1 : 1 - (age / RECENT_S) ** 2);

/**
 * A light's brightness at time t: its mood glow, breathing on its own cycle (quicker and deeper when happier, never
 * for ghosts), plus the heat of an event that just touched it and the 20 s afterglow of having acted. Clamped to 0..1.
 */
export function nodeAlpha(n: { glow: number; ghost: boolean; breath: number; phase: number }, t: number, heat: number, recent: number) {
  const depth = 0.06 + 0.1 * ((6 - n.breath) / 3);
  const breath = n.ghost ? 0 : depth * Math.sin((2 * Math.PI * t) / n.breath + n.phase);
  return Math.min(1, Math.max(0, n.glow + heat * 0.5 + 0.25 * recent + breath));
}

/** Length of a quadratic curve, from eight chords: enough for a dash to travel along it evenly. */
function quadLength(ax: number, ay: number, qx: number, qy: number, bx: number, by: number) {
  let len = 0, x0 = ax, y0 = ay;
  for (let i = 1; i <= 8; i++) {
    const u = i / 8, iu = 1 - u, x = iu * iu * ax + 2 * iu * u * qx + u * u * bx, y = iu * iu * ay + 2 * iu * u * qy + u * u * by;
    len += Math.hypot(x - x0, y - y0); x0 = x; y0 = y;
  }
  return len;
}

/** What an animation is on: an agent, a coin of the model, or a normalised spot (where a coin launched since the coins were fetched will sit). */
type At = { node: number } | { coin: number } | { spot: Pt };
interface Streak { from: number; to: At; t0: number; dur: number; col: string; hit: boolean }
interface Ring { at: At; r0: number; r1: number; t0: number; dur: number; col: string; w: number }
/** A reply drawn as an arc from the replier's light to the light of the agent it answers, in the replier's hue. */
interface Reply { from: number; to: number; t0: number; col: string; hit: boolean }
/** A faction's nebula: its members and how widely they spread (normalised standard deviation per axis). */
interface Nebula { colour: string; members: number[]; sx: number; sy: number; ph: number }

/** Every faction with NEBULA_MIN members or more. Loners and ghosts share a colour but are no faction, so they have none. */
function nebulaeOf(m: SwarmModel): Nebula[] {
  const by = new Map<string, number[]>();
  m.nodes.forEach((n, i) => {
    if (n.colour === LONER || n.colour === GHOST) return;
    let list = by.get(n.colour);
    if (!list) by.set(n.colour, (list = []));
    list.push(i);
  });
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return [...by].filter(([, members]) => members.length >= NEBULA_MIN).map(([colour, members], k) => {
    const xs = members.map((i) => m.nodes[i]!.x), ys = members.map((i) => m.nodes[i]!.y), cx = mean(xs), cy = mean(ys);
    return { colour, members, sx: Math.sqrt(mean(xs.map((x) => (x - cx) ** 2))), sy: Math.sqrt(mean(ys.map((y) => (y - cy) ** 2))), ph: k * 1.7 };
  });
}

/**
 * Each light's own small orbit (x-revamp, "like neurons"): an ellipse of a few px on its own period (8 to 20 s) and tilt,
 * from its id, so the field is always alive and no two lights move together.
 */
interface Orbits { rx: Float32Array; ry: Float32Array; w: Float32Array; cos: Float32Array; sin: Float32Array; depth: Float32Array }
function orbitsOf(nodes: SwarmNode[]): Orbits {
  const n = nodes.length, o: Orbits = { rx: new Float32Array(n), ry: new Float32Array(n), w: new Float32Array(n), cos: new Float32Array(n), sin: new Float32Array(n), depth: new Float32Array(n) };
  nodes.forEach((node, i) => {
    const h = hash(`${node.id}~orbit`);
    o.rx[i] = 4 + ((h % 1000) / 1000) * 5; o.ry[i] = 2.5 + (((h >>> 10) % 1000) / 1000) * 4;
    o.w[i] = (2 * Math.PI) / (8 + (((h >>> 20) % 1000) / 1000) * 12);
    o.cos[i] = Math.cos(node.phase); o.sin[i] = Math.sin(node.phase);
    // How near the light sits, for the pointer parallax: near ones move most, far ones barely.
    o.depth[i] = 0.3 + (((h >>> 5) % 997) / 997) * 0.7;
  });
  return o;
}

/** A run of fibres drawn with one stroke: one kind and colour; `signal` is the colour of the idle signals on them. */
interface Run { kind: number; start: number; end: number; colour: string; signal: string }
/**
 * The network as typed arrays: fibre f joins lights a[f] and b[f], bent by bend[f] (a share of its length, signed) that
 * sways at sway[f] rad/s from phase ph[f]; run[f] is its run. Node i's fibres are adj[off[i]] .. adj[off[i + 1] - 1].
 */
interface Fibres { count: number; a: Int32Array; b: Int32Array; bend: Float32Array; sway: Float32Array; ph: Float32Array; run: Uint16Array; runs: Run[]; off: Int32Array; adj: Int32Array }
const NO_FIBRES: Fibres = { count: 0, a: new Int32Array(0), b: new Int32Array(0), bend: new Float32Array(0), sway: new Float32Array(0), ph: new Float32Array(0), run: new Uint16Array(0), runs: [], off: new Int32Array(1), adj: new Int32Array(0) };

/**
 * The fibres for a model: allies, feuds, then each agent's nearest fellow faction member and nearest neighbour of any
 * faction (on a desktop a second of each), deduplicated and capped (half on a phone). A fibre runs from the lower id to
 * the higher and takes its bend and sway from both ids, so a rebuilt network keeps its shape.
 */
function fibresOf(m: SwarmModel, lite: boolean, down: string): Fibres {
  const nodes = m.nodes, N = nodes.length, cap = lite ? MAX_FIBRES / 2 : MAX_FIBRES;
  const seen = new Set<number>();
  const list: { a: number; b: number; kind: number; colour: string }[] = [];
  const add = (a: number, b: number, kind: number, colour: string) => {
    if (a === b || list.length >= cap) return;
    if (nodes[a]!.id > nodes[b]!.id) [a, b] = [b, a];
    const key = a * N + b;
    if (seen.has(key)) return;
    seen.add(key);
    list.push({ a, b, kind, colour });
  };
  for (const [colour, pairs] of m.alliesByColour) for (const [a, b] of pairs) add(a, b, ALLY, colour);
  for (const [a, b] of m.feuds.slice(0, MAX_FEUD_FIBRES)) add(a, b, FEUD, down);
  // Squared distance on the layout's 16:10 canvas; the two nearest of `pool` within `max`.
  const d2 = (i: number, j: number) => (nodes[i]!.x - nodes[j]!.x) ** 2 + ((nodes[i]!.y - nodes[j]!.y) * 0.625) ** 2;
  const nearest2 = (i: number, pool: number[], max: number) => {
    let j1 = -1, j2 = -1, d1 = max, dd2 = max;
    for (const j of pool) {
      if (j === i) continue;
      const d = d2(i, j);
      if (d < d1) { j2 = j1; dd2 = d1; j1 = j; d1 = d; } else if (d < dd2) { j2 = j; dd2 = d; }
    }
    return [j1, j2];
  };
  const factions = new Map<string, number[]>();
  nodes.forEach((n, i) => {
    if (n.colour === LONER || n.colour === GHOST) return;
    let list = factions.get(n.colour);
    if (!list) factions.set(n.colour, (list = []));
    list.push(i);
  });
  const everyone = nodes.map((_, i) => i);
  const ties = nodes.map((n, i) => { const members = factions.get(n.colour); return members ? nearest2(i, members, Infinity) : [-1, -1]; });
  const near = nodes.map((_, i) => nearest2(i, everyone, 0.018));
  for (let pass = 0; pass < (lite ? 1 : 2); pass++) {
    for (let i = 0; i < N; i++) { const j = ties[i]![pass]!; if (j >= 0) add(i, j, TIE, nodes[i]!.colour); }
    for (let i = 0; i < N; i++) { const j = near[i]![pass]!; if (j >= 0) add(i, j, NEAR, NEURAL); }
  }
  list.sort((x, y) => x.kind - y.kind || (x.colour < y.colour ? -1 : x.colour > y.colour ? 1 : 0));
  const count = list.length;
  const f: Fibres = { count, a: new Int32Array(count), b: new Int32Array(count), bend: new Float32Array(count), sway: new Float32Array(count), ph: new Float32Array(count), run: new Uint16Array(count), runs: [], off: new Int32Array(N + 1), adj: new Int32Array(count * 2) };
  list.forEach((l, i) => {
    const h = hash(`${nodes[l.a]!.id}~${nodes[l.b]!.id}`);
    f.a[i] = l.a; f.b[i] = l.b;
    f.bend[i] = (h & 1 ? 1 : -1) * (0.08 + (((h >>> 1) % 1000) / 1000) * 0.14);
    f.sway[i] = 0.22 + (((h >>> 11) % 1000) / 1000) * 0.36;
    f.ph[i] = ((h >>> 21) % 628) / 100;
    const last = f.runs.at(-1);
    if (last && last.kind === l.kind && last.colour === l.colour) last.end = i + 1;
    else f.runs.push({ kind: l.kind, start: i, end: i + 1, colour: l.colour, signal: l.kind === NEAR ? NEURAL_SIGNAL : mixHex(l.colour, '#ffffff', 0.35) });
    f.run[i] = f.runs.length - 1;
    f.off[l.a + 1]!++; f.off[l.b + 1]!++;
  });
  for (let i = 0; i < N; i++) f.off[i + 1]! += f.off[i]!;
  const fill = f.off.slice(0, N);
  for (let i = 0; i < count; i++) { f.adj[fill[f.a[i]!]!++] = i; f.adj[fill[f.b[i]!]!++] = i; }
  return f;
}

export interface Renderer {
  resize(w: number, h: number, dpr: number): void;
  setModel(m: SwarmModel | null): void;
  setRegime(r: Regime | null): void;
  /** 'hero' or 'calm' (x-revamp §4): eased over STAGE_S; a still frame shows the new stage at once. */
  setStage(s: SwarmStage): void;
  /** The agent whose light answers a pointer on the page: an amber ring, the other lights dimmed a little. null lets go. */
  setFocus(agentId: string | null): void;
  /** Where an agent's light is now, in viewport pixels (the canvas is fixed at 0,0); null when it is not drawn or off screen. */
  locate(agentId: string): { x: number; y: number } | null;
  event(e: SwarmEvent): void;
  start(): void;
  stop(): void;
  destroy(): void;
  /** Average draw time in ms over the last 60 frames (dev performance check). */
  stats(): { drawMs: number };
}

/**
 * The Swarm backdrop on a 2D canvas: a living network of agents, always gently moving. Returns null when the browser
 * gives no 2D context. `lite` (phones) draws at about 30 fps with half the stars, fibres and signals, fainter nebulae
 * and fewer reply arcs at once. Reduced motion draws still frames of the network only.
 */
export function createRenderer(canvas: HTMLCanvasElement, opts: { reduced: boolean; lite?: boolean }): Renderer | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const c: CanvasRenderingContext2D = ctx; // non-null alias: narrowing of `ctx` does not reach the function declarations below
  const lite = opts.lite ?? false;
  const { up: UP, down: DOWN, amber: AMBER, white: WHITE, coin: COIN } = readColours();
  // The sky's own small canvas (SKY_SCALE); without a context for it the sky is painted straight onto the backdrop.
  const skyEl = document.createElement('canvas');
  const sc = skyEl.getContext('2d');
  const t0 = performance.now();
  const now = () => (performance.now() - t0) / 1000;
  const rnd = mulberry32(11);
  const stars = Array.from({ length: lite ? 60 : 120 }, () => ({ x: rnd(), y: rnd(), a: 0.08 + rnd() * 0.32, ph: rnd() * 6.28 }));
  const glowCache = new Map<string, HTMLCanvasElement>(), nebulaCache = new Map<string, HTMLCanvasElement>();
  const deadNow = new Set<string>();
  /** Coins launched since the model's coins were fetched, by mint: their creator, so trades on one streak to where it will sit. */
  const launched = new Map<string, string>();
  let W = 0, H = 0, D = 0, raf = 0, last = 0, running = false, drawAvg = 0;
  // The pointer, as -0.5..0.5 of the screen, and the eased parallax that follows it (desktop, full motion only).
  let parTX = 0, parTY = 0, parX = 0, parY = 0;
  const onPointer = (e: PointerEvent) => { if (e.pointerType === 'mouse' && W && H) { parTX = e.clientX / W - 0.5; parTY = e.clientY / H - 0.5; } };
  if (!opts.reduced && !lite && typeof window !== 'undefined') window.addEventListener('pointermove', onPointer, { passive: true });
  let model: SwarmModel | null = null;
  let px = new Float32Array(0), py = new Float32Array(0), hot = new Float32Array(0), pulse = new Float32Array(0);
  /** When each agent last acted (seconds on this renderer's clock), for its afterglow and size; -Infinity for never. */
  let actedAt = new Float64Array(0);
  /** When each agent's last post ring started: a post heard twice (post:live, then the timeline's bump with its text) rings once. */
  let ringAt = new Float64Array(0);
  let orbits = orbitsOf([]), F = NO_FIBRES;
  let glowTimer: ReturnType<typeof setTimeout> | undefined;
  let streaks: Streak[] = [], rings: Ring[] = [], replies: Reply[] = [], nebulae: Nebula[] = [];
  let from: Sky = SKIES.none, to: Sky = SKIES.none, fadeAt = -FADE_S;
  /** The sky's motion this frame, mixed between `from` and `to` while the weather changes. */
  let speedNow = SKIES.none.speed, jitterNow = 0, driftNow = SKIES.none.drift;
  /** The stage as a number (0 calm, 1 hero), eased from `stageFrom` to `stageTo` starting at `stageAt`. */
  let stageFrom = 0, stageTo = 0, stageAt = -STAGE_S;
  const look: Look = { ...LOOKS.calm };
  /** The zoom the lights were last placed with. */
  let Z = 1;
  /** The focused agent; `focusLast` keeps the ring on its light while it fades out. */
  let focusId: string | null = null, focusLast: string | null = null, focusMix = 0;
  // Signals in flight, one per slot: kind 0 free, 1 idle, 2 a real event's; fibre, direction (1 a→b, -1 b→a), start, length, colour.
  const pKind = new Uint8Array(PULSE_SLOTS), pFib = new Int32Array(PULSE_SLOTS), pDir = new Int8Array(PULSE_SLOTS);
  const pT0 = new Float64Array(PULSE_SLOTS), pDur = new Float32Array(PULSE_SLOTS), pCol = new Array<string>(PULSE_SLOTS).fill(WHITE);
  const idleMax = lite ? IDLE_MAX / 2 : IDLE_MAX, eventMax = lite ? EVENT_MAX / 2 : EVENT_MAX;
  let idleOn = 0, eventOn = 0, nextIdle = 0;
  const dashBuf = [0, 0];

  function glow(col: string) {
    let g = glowCache.get(col);
    if (g) return g;
    g = document.createElement('canvas'); g.width = g.height = 64;
    const x = g.getContext('2d');
    if (x) {
      // A white-hot centre, the colour, then a soft falloff: lights that read on the void.
      const grad = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, mixHex(col, '#ffffff', 0.55)); grad.addColorStop(0.09, col); grad.addColorStop(0.17, col); grad.addColorStop(0.36, hexA(col, 0.34)); grad.addColorStop(1, hexA(col, 0));
      x.fillStyle = grad; x.fillRect(0, 0, 64, 64);
    }
    glowCache.set(col, g);
    return g;
  }
  function nebula(col: string) {
    let g = nebulaCache.get(col);
    if (g) return g;
    g = document.createElement('canvas'); g.width = g.height = 64;
    const x = g.getContext('2d');
    if (x) {
      const grad = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, hexA(col, 1)); grad.addColorStop(0.45, hexA(col, 0.42)); grad.addColorStop(1, hexA(col, 0));
      x.fillStyle = grad; x.fillRect(0, 0, 64, 64);
    }
    nebulaCache.set(col, g);
    return g;
  }
  /** A soft radial sprite from `inner` at the centre to transparent at the edge (aurora blobs, the reading band). */
  function soft(inner: string) {
    const g = document.createElement('canvas'); g.width = g.height = 128;
    const x = g.getContext('2d');
    if (x) { const grad = x.createRadialGradient(64, 64, 0, 64, 64, 64); grad.addColorStop(0, inner); grad.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = grad; x.fillRect(0, 0, 128, 128); }
    return g;
  }
  // A sky's gradient and blob sprites, made once per sky (a mid-fade mix is a sky of its own) and per height.
  const skyArt = new WeakMap<Sky, { grad: CanvasGradient | null; h: number; blobs: HTMLCanvasElement[] }>();
  function artOf(sky: Sky, g: CanvasRenderingContext2D) {
    let art = skyArt.get(sky);
    if (!art) { art = { grad: null, h: 0, blobs: [soft(rgba(sky.a1)), soft(rgba(sky.a2)), soft(rgba(sky.a3))] }; skyArt.set(sky, art); }
    if (!art.grad || art.h !== H) {
      const grad = g.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, rgba(sky.top)); grad.addColorStop(1, rgba(sky.low));
      art.grad = grad; art.h = H;
    }
    return art;
  }
  let bandArt: HTMLCanvasElement | null = null;
  const mx = () => W * 0.04, my = () => H * 0.07;
  /** The zoom's fixed point: the middle, a little high, where the hero's world sits. */
  const zx = () => W / 2, zy = () => H * 0.45;
  /** On wide screens the network spreads sideways, past the reading column, so the gutters hold most of it. */
  const spreadX = () => clamp(W / Math.max(1, H) / 1.15, 1, 1.32);
  const toX = (x: number) => zx() + (mx() + (0.5 + (x - 0.5) * spreadX()) * (W - 2 * mx()) - zx()) * Z, toY = (y: number) => zy() + (my() + y * (H - 2 * my()) - zy()) * Z;
  const coinX = (i: number) => toX(model!.coins[i]!.x);
  const coinY = (i: number) => toY(model!.coins[i]!.y);
  const atX = (a: At) => ('node' in a ? px[a.node]! : 'coin' in a ? coinX(a.coin) : toX(a.spot.x));
  const atY = (a: At) => ('node' in a ? py[a.node]! : 'coin' in a ? coinY(a.coin) : toY(a.spot.y));
  const fadeK = (t: number) => clamp((t - fadeAt) / FADE_S, 0, 1);
  const skyNow = (t: number) => { const k = fadeK(t); return k >= 1 ? to : mixSky(from, to, k); };
  const stageMix = (t: number) => { const k = clamp((t - stageAt) / STAGE_S, 0, 1); return stageFrom + (stageTo - stageFrom) * k * k * (3 - 2 * k); };
  const focusIndex = () => { const id = focusId ?? (focusMix > 0 ? focusLast : null); return id === null ? null : model?.index.get(id) ?? null; };
  const tint = (hue: number) => hueHex(hue);

  /**
   * Every light's place at time t: its layout spot, moving on its own orbit (scaled by the weather and `amp`), then the
   * stage's zoom. The locator, the fibres and every animation read these.
   */
  function place(t: number, zoom: number, amp: number) {
    Z = zoom;
    if (!model) return;
    const nodes = model.nodes, x0 = mx(), y0 = my(), w = W - 2 * x0, h = H - 2 * y0, cx = zx(), cy = zy();
    const spread = spreadX();
    const spin = 0.6 + 0.8 * speedNow, r = driftNow * amp, j = opts.reduced ? 0 : jitterNow, o = orbits;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!, th = t * o.w[i]! * spin + n.phase, ox = Math.cos(th) * o.rx[i]! * r, oy = Math.sin(th) * o.ry[i]! * r;
      const dx = ox * o.cos[i]! - oy * o.sin[i]! + (j ? (Math.random() - 0.5) * j : 0), dy = ox * o.sin[i]! + oy * o.cos[i]! + (j ? (Math.random() - 0.5) * j : 0);
      // Near lights drift against the pointer more than far ones: the network has depth.
      const pd = o.depth[i]!;
      px[i] = cx + (x0 + (0.5 + (n.x - 0.5) * spread) * w - cx + dx) * zoom - parX * 34 * pd;
      py[i] = cy + (y0 + n.y * h - cy + dy) * zoom - parY * 22 * pd;
    }
  }

  /** The sky (fading between two weathers), the factions' nebulae and the reading band, at SKY_SCALE, then scaled up in one fill. */
  function paintSky(t: number, k: number) {
    const g = sc ?? c, big = Math.max(W, H), sp = speedNow;
    if (sc) sc.setTransform(skyEl.width / W, 0, 0, skyEl.height / H, 0, 0);
    const next = artOf(to, g), was = k < 1 ? artOf(from, g) : null;
    g.globalAlpha = 1;
    if (was) { g.fillStyle = was.grad!; g.fillRect(0, 0, W, H); g.globalAlpha = k; }
    g.fillStyle = next.grad!; g.fillRect(0, 0, W, H);
    const x1 = W * (0.26 + 0.12 * Math.sin(t * 0.05 * sp)), r1 = big * 0.5, x2 = W * (0.78 + 0.1 * Math.cos(t * 0.04 * sp)), r2 = big * 0.45, r3 = big * 0.55;
    for (let s = was ? 0 : 1; s < 2; s++) {
      const art = s === 0 ? was! : next;
      g.globalAlpha = was ? (s === 0 ? 1 - k : k) : 1;
      g.drawImage(art.blobs[0]!, x1 - r1, H * 0.2 - r1, 2 * r1, 2 * r1);
      g.drawImage(art.blobs[1]!, x2 - r2, H * 0.66 - r2, 2 * r2, 2 * r2);
      g.drawImage(art.blobs[2]!, W * 0.5 - r3, H * 1.05 - r3, 2 * r3, 2 * r3);
    }
    // Each faction a faint nebula around its members, following them as they drift and zoom.
    if (model && nebulae.length) {
      const sw = (W - 2 * mx()) * Z * 2.4, sh = (H - 2 * my()) * Z * 2.4;
      for (let n = 0; n < nebulae.length; n++) {
        const nb = nebulae[n]!, ms = nb.members;
        let x = 0, y = 0;
        for (let i = 0; i < ms.length; i++) { x += px[ms[i]!]!; y += py[ms[i]!]!; }
        x /= ms.length; y /= ms.length;
        const rx = clamp(nb.sx * sw, 70, W * 0.32), ry = clamp(nb.sy * sh, 56, H * 0.36);
        g.globalAlpha = NEBULA_A * look.nebula * (lite ? 0.5 : 1) * (opts.reduced ? 1 : 1 + 0.18 * Math.sin(t * 0.21 + nb.ph));
        g.drawImage(nebula(nb.colour), x - rx, y - ry, 2 * rx, 2 * ry);
      }
    }
    // A dark band behind the reading column keeps text legible over the brightest parts of the swarm; the hero has none.
    if (look.band > 0.01) {
      bandArt ??= soft('rgba(4,5,10,1)');
      const r = Math.max(420, W * 0.42);
      g.globalAlpha = look.band;
      g.drawImage(bandArt, W / 2 - r, H * 0.5 - r, 2 * r, 2 * r);
    }
    g.globalAlpha = 1;
    if (sc) c.drawImage(skyEl, 0, 0, W, H);
  }

  /** The network's fibres: one stroke per run, each a slightly curved line that sways with time and with the lights it joins. */
  function drawFibres(t: number, dim: number) {
    const sway = SWAY * look.orbit;
    for (let r = 0; r < F.runs.length; r++) {
      const run = F.runs[r]!;
      c.strokeStyle = run.colour; c.globalAlpha = FIBRE_ALPHA[run.kind]! * look.fibre * dim; c.lineWidth = FIBRE_WIDTH[run.kind]!;
      if (run.kind === FEUD) c.setLineDash(FEUD_DASH);
      c.beginPath();
      for (let f = run.start; f < run.end; f++) {
        const a = F.a[f]!, b = F.b[f]!, ax = px[a]!, ay = py[a]!, bx = px[b]!, by = py[b]!;
        const B = F.bend[f]! * (1 + sway * Math.sin(t * F.sway[f]! + F.ph[f]!));
        c.moveTo(ax, ay); c.quadraticCurveTo((ax + bx) / 2 - (by - ay) * B, (ay + by) / 2 + (bx - ax) * B, bx, by);
      }
      c.stroke();
      if (run.kind === FEUD) c.setLineDash(NO_DASH);
    }
    c.globalAlpha = 1;
  }

  /** Sends a signal along fibre f out of light `from`. Idle ones wait for room under their cap; a real event's takes the oldest event slot when full. */
  function fire(f: number, from: number, kind: 1 | 2, col: string, t: number) {
    let slot = -1;
    if (kind === 1 ? idleOn >= idleMax : eventOn >= eventMax) {
      if (kind === 1) return;
      for (let i = 0; i < PULSE_SLOTS; i++) if (pKind[i] === 2 && (slot < 0 || pT0[i]! < pT0[slot]!)) slot = i;
      if (slot >= 0) eventOn--;
    } else for (let i = 0; i < PULSE_SLOTS && slot < 0; i++) if (!pKind[i]) slot = i;
    if (slot < 0) return;
    const a = F.a[f]!, b = F.b[f]!, len = Math.hypot(px[b]! - px[a]!, py[b]! - py[a]!);
    pKind[slot] = kind; pFib[slot] = f; pDir[slot] = from === a ? 1 : -1; pT0[slot] = t; pCol[slot] = col;
    pDur[slot] = kind === 1 ? clamp(len / IDLE_SPEED, 0.45, 2.4) : clamp(len / EVENT_SPEED, 0.18, 0.8);
    if (kind === 1) idleOn++; else eventOn++;
  }
  function freePulse(i: number) { if (pKind[i] === 1) idleOn--; else if (pKind[i] === 2) eventOn--; pKind[i] = 0; }
  function clearPulses() { pKind.fill(0); idleOn = 0; eventOn = 0; }
  /** A fibre of light `node` other than `not`, at random; -1 when it has none. */
  function fibreOf(node: number, not = -1) {
    const start = F.off[node]!, deg = F.off[node + 1]! - start;
    if (deg < (not < 0 ? 1 : 2)) return -1;
    let j = (Math.random() * deg) | 0;
    if (F.adj[start + j] === not) j = (j + 1) % deg;
    return F.adj[start + j]!;
  }
  /** A real event: brighter, faster signals out of the agent's light along up to `n` of its fibres. */
  function fireFrom(node: number, n: number, col: string, t: number) {
    const start = F.off[node]!, deg = F.off[node + 1]! - start;
    if (!deg) return;
    const r = (Math.random() * deg) | 0;
    for (let k = 0; k < Math.min(n, deg); k++) fire(F.adj[start + ((r + k) % deg)]!, node, 2, col, t);
  }
  /** A signal reaches its light: a brief flare there, and an idle one sometimes travels on along another fibre. */
  function arrive(i: number, t: number) {
    const f = pFib[i]!, at = pDir[i]! > 0 ? F.b[f]! : F.a[f]!, idle = pKind[i] === 1, flare = idle ? 0.3 : 0.6;
    if (Math.abs(hot[at]!) < flare) hot[at] = flare;
    freePulse(i);
    if (idle && Math.random() < CASCADE) { const g = fibreOf(at, f); if (g >= 0) fire(g, at, 1, F.runs[F.run[g]!]!.signal, t); }
  }
  /** Signals in flight: a soft head with a short, fading tail, eased along the fibre's current curve. */
  function drawPulses(t: number, dim: number) {
    const sway = SWAY * look.orbit;
    for (let i = 0; i < PULSE_SLOTS; i++) {
      const kind = pKind[i]!;
      if (!kind) continue;
      const k = (t - pT0[i]!) / pDur[i]!;
      if (k >= 1) { arrive(i, t); continue; }
      if (k < 0) continue;
      const f = pFib[i]!, a = F.a[f]!, b = F.b[f]!, ax = px[a]!, ay = py[a]!, bx = px[b]!, by = py[b]!;
      const B = F.bend[f]! * (1 + sway * Math.sin(t * F.sway[f]! + F.ph[f]!)), qx = (ax + bx) / 2 - (by - ay) * B, qy = (ay + by) / 2 + (bx - ax) * B;
      const e = kind === 1 ? k * k * (3 - 2 * k) : 1 - (1 - k) * (1 - k), fwd = pDir[i]! > 0, sprite = glow(pCol[i]!);
      const size = (kind === 1 ? 7 : 12) * look.size, alpha = (kind === 1 ? 0.6 * look.pulse * Math.min(1, k * 5, (1 - k) * 5) : 0.95) * dim;
      for (let s = 0; s < (kind === 1 ? 2 : 3); s++) {
        const v = e - s * 0.075;
        if (v < 0) break;
        const u = fwd ? v : 1 - v, iu = 1 - u, x = iu * iu * ax + 2 * iu * u * qx + u * u * bx, y = iu * iu * ay + 2 * iu * u * qy + u * u * by, z = size * (1 - s * 0.28);
        c.globalAlpha = alpha * (1 - s * 0.38);
        c.drawImage(sprite, x - z / 2, y - z / 2, z, z);
      }
    }
    c.globalAlpha = 1;
  }

  /** A reply arc at progress k: the faint curve, and a dash that travels along it from the replier into the agent it answers. */
  function drawReply(r: Reply, k: number, t: number) {
    const ax = px[r.from]!, ay = py[r.from]!, bx = px[r.to]!, by = py[r.to]!;
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    if (k < 0 || len < 6) return;
    // Bent upward, like something tossed across.
    let nx = -dy / len, ny = dx / len;
    if (ny > 0) { nx = -nx; ny = -ny; }
    const bend = Math.min(160, len * 0.3), qx = (ax + bx) / 2 + nx * bend, qy = (ay + by) / 2 + ny * bend;
    const L = quadLength(ax, ay, qx, qy, bx, by), dash = Math.max(16, L * 0.3), head = (1 - (1 - k) ** 3) * (L + dash);
    const w = look.arc, a = look.arcAlpha;
    c.beginPath(); c.moveTo(ax, ay); c.quadraticCurveTo(qx, qy, bx, by);
    c.strokeStyle = r.col; c.lineCap = 'round';
    c.globalAlpha = 0.14 * a * (1 - k); c.lineWidth = w * 0.75; c.stroke();
    // The dash: [head - dash, head] along the curve, a soft wide stroke under a bright thin one.
    dashBuf[0] = dash; dashBuf[1] = L + dash * 2;
    c.setLineDash(dashBuf); c.lineDashOffset = dash - head;
    c.globalAlpha = 0.22 * a; c.lineWidth = w * 3.5; c.stroke();
    c.globalAlpha = 0.9 * a; c.lineWidth = w; c.stroke();
    c.setLineDash(NO_DASH); c.lineDashOffset = 0; c.lineCap = 'butt'; c.globalAlpha = 1;
    // The answered agent lights up as the dash reaches it.
    if (!r.hit && head >= L) { r.hit = true; hot[r.to] = Math.max(hot[r.to]!, 0.55); rings.push({ at: { node: r.to }, r0: 3, r1: 16, t0: t, dur: 0.7, col: r.col, w: 1 }); }
  }

  /** One frame. `still` (reduced motion, or a redraw while stopped) shows the network as it stands: no signals, no animations. */
  function frame(t: number, dt: number, still = false) {
    const begin = performance.now();
    if (!W || !H) return;
    const fk = fadeK(t);
    if (!still) { const k = Math.min(1, dt * 2.5); parX += (parTX - parX) * k; parY += (parTY - parY) * k; }
    speedNow = from.speed + (to.speed - from.speed) * fk; jitterNow = from.jitter + (to.jitter - from.jitter) * fk; driftNow = from.drift + (to.drift - from.drift) * fk;
    lookAt(look, still ? stageTo : stageMix(t));
    focusMix = still ? (focusId ? 1 : 0) : step(focusMix, focusId ? 1 : 0, dt / FOCUS_S);
    place(t, look.zoom, look.orbit);
    for (let i = 0; i < hot.length; i++) hot[i] = hot[i]! - Math.sign(hot[i]!) * Math.min(Math.abs(hot[i]!), dt * 0.7);
    paintSky(t, fk);
    // Stars sit far behind the world: the hero's zoom moves them a quarter as much.
    const zs = 1 + (look.zoom - 1) * 0.25, cx = zx(), cy = zy();
    c.fillStyle = '#fff';
    for (let i = 0; i < stars.length; i++) { const s = stars[i]!; c.globalAlpha = Math.min(1, s.a * look.stars * (0.6 + 0.4 * Math.sin(t * 0.8 + s.ph))); c.fillRect(cx + (s.x * W - cx) * zs, cy + (s.y * H - cy) * zs, 1, 1); }
    c.globalAlpha = 1;
    if (model) {
      const m = model, nodes = m.nodes, fi = focusIndex(), dim = fi === null ? 1 : 1 - FOCUS_DIM * focusMix;
      drawFibres(t, dim);
      // Coins are small quiet diamonds and never labelled: under the cards a $TICKER only clutters the text. Past the
      // busiest MAX_COINS a coin shows only while a trade or launch lights it, fading with its pulse.
      for (let i = 0; i < m.coins.length; i++) {
        const coin = m.coins[i]!, p = pulse[i]!;
        if (!coin.shown && !(p > 0)) continue;
        const x = coinX(i), y = coinY(i), dead = coin.dead || deadNow.has(coin.mint), half = 2.5 * Z;
        if (p > 0) { const s = (28 + p * 24) * Z; c.globalAlpha = 0.55; c.drawImage(glow(AMBER), x - s / 2, y - s / 2, s, s); pulse[i] = Math.max(0, p - dt * 1.4); }
        c.save(); c.translate(x, y); c.rotate(Math.PI / 4); c.globalAlpha = (dead ? 0.1 : 0.4) * (coin.shown ? 1 : p) * dim; c.fillStyle = dead ? WHITE : COIN; c.fillRect(-half, -half, 2 * half, 2 * half); c.restore();
      }
      c.globalAlpha = 1;
      // Idle firing: a few signals a second across the field (half on a phone), never more than the cap at once.
      if (!still && F.count && t >= nextIdle) {
        const f = (Math.random() * F.count) | 0;
        fire(f, Math.random() < 0.5 ? F.a[f]! : F.b[f]!, 1, F.runs[F.run[f]!]!.signal, t);
        nextIdle = t - Math.log(1 - Math.random()) / (look.rate * (lite ? 0.5 : 1));
      }
      if (!still) drawPulses(t, dim);
      // An agent that acted glows brighter for 20 s and larger for a minute, by the clock (a still frame passes a fixed t).
      // Every light breathes: its size and glow ease in and out on its own cycle.
      const wall = now(), grow = look.size * Z, breathe = BREATH_SIZE * look.orbit;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]!, heat = Math.abs(hot[i]!), age = wall - actedAt[i]!;
        const breath = n.ghost ? 1 : 1 + breathe * Math.sin((2 * Math.PI * t) / n.breath + n.phase);
        const size = n.r * (6 + heat * 5) * grow * breath * (1 + RECENT_GROW * recentGlow(age, opts.reduced));
        // Quieter than full strength in calm: the lights are a field behind the page, not content of their own.
        const a = look.light * nodeAlpha(n, t, heat, afterglow(age, opts.reduced));
        c.globalAlpha = i === fi ? a + (Math.max(a, 0.95) - a) * focusMix : a * dim;
        c.drawImage(glow(n.colour), px[i]! - size / 2, py[i]! - size / 2, size, size);
        // The viewer's own agent (RAISE): a thin amber ring, static, so it reads the same under reduced motion.
        if (n.own) { c.globalAlpha = 0.9; c.strokeStyle = AMBER; c.lineWidth = 1.5; c.beginPath(); c.arc(px[i]!, py[i]!, n.r * 3.2 * grow + 4, 0, Math.PI * 2); c.stroke(); }
      }
      // The focused agent (its post is under the pointer, or its light is): an amber ring with a soft halo. Shown under reduced motion too.
      if (fi !== null && focusMix > 0) {
        const r = nodes[fi]!.r * 3.2 * grow + 8;
        c.strokeStyle = AMBER;
        c.globalAlpha = 0.2 * focusMix; c.lineWidth = 5; c.beginPath(); c.arc(px[fi]!, py[fi]!, r, 0, Math.PI * 2); c.stroke();
        c.globalAlpha = 0.95 * focusMix; c.lineWidth = 1.5; c.beginPath(); c.arc(px[fi]!, py[fi]!, r, 0, Math.PI * 2); c.stroke();
      }
      c.globalAlpha = 1;
      if (!still) {
        // Finished animations are dropped in place: nothing is allocated per frame.
        let n = 0;
        for (let i = 0; i < replies.length; i++) { const r = replies[i]!; if (t - r.t0 < REPLY_S) replies[n++] = r; }
        replies.length = n;
        for (let i = 0; i < replies.length; i++) drawReply(replies[i]!, (t - replies[i]!.t0) / REPLY_S, t);
        n = 0;
        for (let i = 0; i < streaks.length; i++) { const s = streaks[i]!; if (t - s.t0 < s.dur) streaks[n++] = s; }
        streaks.length = n;
        for (let i = 0; i < streaks.length; i++) {
          const s = streaks[i]!, k = (t - s.t0) / s.dur, ax = px[s.from]!, ay = py[s.from]!, bx = atX(s.to), by = atY(s.to);
          const qx = (ax + bx) / 2 + (by - ay) * 0.18, qy = (ay + by) / 2 - (bx - ax) * 0.18;
          const u = Math.max(0, k - 0.16), iu = 1 - u, ik = 1 - k;
          const x = ik * ik * ax + 2 * ik * k * qx + k * k * bx, y = ik * ik * ay + 2 * ik * k * qy + k * k * by;
          c.strokeStyle = s.col; c.globalAlpha = 0.28; c.lineWidth = 1; c.beginPath();
          c.moveTo(iu * iu * ax + 2 * iu * u * qx + u * u * bx, iu * iu * ay + 2 * iu * u * qy + u * u * by); c.lineTo(x, y); c.stroke();
          c.globalAlpha = 0.55; c.drawImage(glow(s.col), x - 6, y - 6, 12, 12);
          if (k > 0.92 && !s.hit) { s.hit = true; if ('coin' in s.to) pulse[s.to.coin] = 1; else if ('node' in s.to) hot[s.to.node] = 0.6; }
        }
        n = 0;
        for (let i = 0; i < rings.length; i++) { const r = rings[i]!; if (t - r.t0 < r.dur) rings[n++] = r; }
        rings.length = n;
        for (let i = 0; i < rings.length; i++) {
          const r = rings[i]!, k = (t - r.t0) / r.dur;
          if (k < 0) continue;
          c.strokeStyle = r.col; c.globalAlpha = (1 - k) * 0.32; c.lineWidth = r.w * (1 - k) * 0.6 + 0.5;
          c.beginPath(); c.arc(atX(r.at), atY(r.at), r.r0 + (r.r1 - r.r0) * (1 - (1 - k) ** 3), 0, Math.PI * 2); c.stroke();
        }
        c.globalAlpha = 1;
      }
    }
    drawAvg = drawAvg * 0.95 + (performance.now() - begin) * 0.05;
  }

  const frameMs = lite ? LITE_FRAME_MS : FRAME_MS;
  function loop(ts: number) {
    raf = requestAnimationFrame(loop);
    if (ts - last < frameMs) return;
    const dt = last ? Math.min(0.1, (ts - last) / 1000) : 1 / 60;
    last = ts;
    frame(now(), dt);
  }
  const still = () => {
    if (!W || !H) return;
    frame(STILL_T, 0, true);
    // A still frame shows who acted lately (brighter for 20 s, larger for a minute); it is redrawn as each of those ends.
    clearTimeout(glowTimer);
    const wall = now();
    let next = Infinity;
    for (let i = 0; i < actedAt.length; i++) {
      const at = actedAt[i]!;
      if (at + AFTERGLOW_S > wall) next = Math.min(next, at + AFTERGLOW_S);
      else if (at + RECENT_S > wall) next = Math.min(next, at + RECENT_S);
    }
    if (next < Infinity) glowTimer = setTimeout(still, (next - wall) * 1000 + 50);
  };
  /** Redraws now: a resized buffer is blank until the next frame. */
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
      skyEl.width = Math.max(1, Math.ceil(w * SKY_SCALE)); skyEl.height = Math.max(1, Math.ceil(h * SKY_SCALE));
      redraw();
    },
    setModel(m) {
      const old = model;
      model = m;
      const n = m?.nodes.length ?? 0, nc = m?.coins.length ?? 0;
      const oldHot = hot, oldPulse = pulse, oldActed = actedAt, oldRing = ringAt;
      px = new Float32Array(n); py = new Float32Array(n); hot = new Float32Array(n); pulse = new Float32Array(nc);
      actedAt = new Float64Array(n).fill(-Infinity); ringAt = new Float64Array(n).fill(-Infinity);
      // A coins refresh keeps the agents (the same nodes): their orbits, the network and the signals on it stay.
      if (!m || m.nodes !== old?.nodes) { orbits = orbitsOf(m?.nodes ?? []); F = m ? fibresOf(m, lite, DOWN) : NO_FIBRES; clearPulses(); }
      if (old && m) {
        // Animations in flight follow their agent and coin into the new model (by id and mint); those whose target is gone end.
        for (const [id, i] of m.index) {
          const o = old.index.get(id);
          if (o === undefined) continue;
          hot[i] = oldHot[o] ?? 0; actedAt[i] = oldActed[o] ?? -Infinity; ringAt[i] = oldRing[o] ?? -Infinity;
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
        replies = replies.flatMap((r) => { const f = node(r.from), to = node(r.to); return f === undefined || to === undefined ? [] : [{ ...r, from: f, to }]; });
      } else { streaks = []; rings = []; replies = []; }
      nebulae = m ? nebulaeOf(m) : [];
      // Every light has a place at once, so the locator never answers from an empty array before the next frame.
      if (W && H) place(opts.reduced || !running ? STILL_T : now(), Z, look.orbit);
      if (opts.reduced || !running) still();
    },
    setRegime(r) {
      const target = SKIES[r ?? 'none'];
      if (target === to) return;
      const t = opts.reduced ? STILL_T : now();
      from = opts.reduced ? target : skyNow(t); to = target; fadeAt = opts.reduced ? -FADE_S : t;
      if (opts.reduced || !running) still();
    },
    setStage(s) {
      const target = s.stage === 'hero' ? 1 : 0;
      if (target === stageTo) return;
      const t = now();
      stageFrom = opts.reduced || !running ? target : stageMix(t); stageTo = target; stageAt = t;
      if (opts.reduced || !running) still();
    },
    setFocus(id) {
      if (id === focusId) return;
      focusId = id;
      if (id) focusLast = id;
      if (opts.reduced || !running) still();
    },
    locate(id) {
      const i = model?.index.get(id);
      if (i === undefined || !W || !H) return null;
      const x = px[i]!, y = py[i]!;
      // On a phone the canvas is as tall as the largest viewport: below the visible one a light is off screen.
      const vh = Math.min(H, window.innerHeight || H);
      return x >= 0 && x <= W && y >= 0 && y <= vh ? { x, y } : null;
    },
    event(e) {
      if (!model) return;
      const m = model, tg = targetsFor(m, e);
      if (e.kind === 'rug' && tg.coin !== null) deadNow.add(m.coins[tg.coin]!.mint);
      if (e.kind === 'launch' && e.mint && tg.coin === null) {
        launched.set(e.mint, e.agentId);
        if (launched.size > 64) launched.delete(launched.keys().next().value as string);
      }
      // Who acted glows brighter and larger; set before the still-frame return, so the still frame shows it too.
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
      if (tg.from !== null) {
        hot[tg.from] = e.kind === 'transfer' ? 0.6 : e.kind === 'buy' || e.kind === 'sell' ? 0.8 : 1;
        // Real activity fires brighter, faster signals out along the agent's fibres, on top of the idle firing.
        const col = e.kind === 'buy' ? UP : e.kind === 'sell' || e.kind === 'rug' ? DOWN : e.kind === 'transfer' ? WHITE : e.kind === 'launch' ? AMBER : tint(m.nodes[tg.from]!.hue);
        fireFrom(tg.from, (lite ? 1 : 2) + (e.kind === 'post' || e.kind === 'launch' ? 1 : 0), col, t);
      }
      switch (e.kind) {
        case 'buy': case 'sell': {
          const to = coinAt();
          if (tg.from !== null && to) streaks.push({ from: tg.from, to, t0: t, dur: 1.1, col: e.kind === 'buy' ? UP : DOWN, hit: false });
          break;
        }
        case 'transfer':
          if (tg.from !== null && tg.toNode !== null) streaks.push({ from: tg.from, to: { node: tg.toNode }, t0: t, dur: 1.3, col: WHITE, hit: false });
          break;
        case 'post': {
          if (tg.from === null) break;
          // A post rings in its author's hue (heard twice, it rings once); a reply also arcs to the agent it answers.
          const col = tint(m.nodes[tg.from]!.hue);
          if (t - ringAt[tg.from]! > 1.5) { ringAt[tg.from] = t; ring({ node: tg.from }, 22, col, 1, 1.2); }
          if (tg.toNode !== null && tg.toNode !== tg.from) {
            replies.push({ from: tg.from, to: tg.toNode, t0: t, col, hit: false });
            if (replies.length > (lite ? MAX_REPLIES / 2 : MAX_REPLIES)) replies.shift();
          }
          break;
        }
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
    // A still frame's glow timer stops once frames run again: it would draw one frame at the still frame's time.
    start() { if (running || opts.reduced) return; running = true; last = 0; clearTimeout(glowTimer); raf = requestAnimationFrame(loop); },
    stop() { running = false; cancelAnimationFrame(raf); },
    destroy() { running = false; cancelAnimationFrame(raf); clearTimeout(glowTimer); model = null; window.removeEventListener('pointermove', onPointer); },
    stats: () => ({ drawMs: Math.round(drawAvg * 100) / 100 }),
  };
}
