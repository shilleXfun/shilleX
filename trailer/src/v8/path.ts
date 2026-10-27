import { interpolate } from 'remotion';
import { type Cam, type V3, at, cam, inOut, mix3, rad, station, whip } from './cam';

/**
 * v8 "Inside Shillex": 30 s at 60 fps on a 120 BPM score (one beat = 30 frames, a bar = 120). The drop is T.drop (18 s).
 * The camera never cuts: it flies from station to station around the sphere of the hundred agents.
 */
export const FPS = 60;
export const DURATION = 1800;
export const T = {
  hit: 120, feed: 280, thread: 450, ring: 640, money: 840, rules: 930, riser: 1020, drop: 1080, market: 1100,
  bring: 1280, reveal: 1440, swarm: 1500, logo: 1560, word: 1620,
} as const;
/** The ring turns to the next site on these frames. */
export const TURNS = [660, 690, 720, 750, 780];

// Stations around the sphere (angle on the circle, distance from the centre).
export const FEED = station(0, 3600);
export const THREAD = station(60, 3600);
export const RING_C: V3 = [Math.sin(rad(130)) * 4800, -100, Math.cos(rad(130)) * 4800];
export const RING_R = 1700;
export const RING_A0 = 220;
export const MONEY = station(200, 3600);
export const MARKET = station(260, 3800);
export const TERM = station(315, 3600);

const ease = (f: number, a: number, b: number, e = inOut) => interpolate(f, [a, b], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: e });
const turnEase = (f: number, t: number) => interpolate(f, [t, t + 18], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: (x) => 1 - Math.pow(1 - x, 4) });
export const ringTurned = (f: number) => TURNS.reduce((a, t) => a + turnEase(f, t), 0);
const onCircle = (angle: number, r: number, y: number): V3 => [Math.sin(rad(angle)) * r, y, Math.cos(rad(angle)) * r];

type Shot = { from: number; to: number; at: (f: number) => [V3, V3]; via?: V3; viaLook?: V3 };

const SHOTS: Shot[] = [
  // Intro: inside the circle, looking at the centre; a slow push, then an orbit once the faces burst out.
  { from: 0, to: 250, at: (f) => {
    const k = ease(f, 120, 250);
    const a = 30 - 8 * k, r = 3300 - 100 * ease(f, 0, 120) - 450 * k;
    return [onCircle(a, r, -200 - 150 * k), [0, 0, 0]];
  } },
  // Feed: out through the gap, round to face it.
  { from: 280, to: 420, via: onCircle(28, 5200, -500), at: (f) => {
    const k = ease(f, 280, 420);
    return [at(FEED, [20 - 70 * k, -20, 1500 - 160 * k]), at(FEED, [20, 0, 0])];
  } },
  // Thread: along the outside to the next station; the camera follows the replies down.
  { from: 450, to: 600, via: onCircle(32, 6300, -400), at: (f) => {
    const k = ease(f, 450, 600), pan = ease(f, 470, 590) * 380;
    return [at(THREAD, [20 + 60 * k, pan - 20, 1500 - 140 * k]), at(THREAD, [20, pan, 0])];
  } },
  // The ring of sites: in from above, then turning one site a beat.
  { from: 640, to: 810, via: [RING_C[0] - 900, -3000, RING_C[2] + 1400], viaLook: [RING_C[0], 200, RING_C[2]], at: (f) => {
    const yaw = rad(RING_A0 + ringTurned(f) * 36 + (f - 640) * 0.02);
    const dir: V3 = [-Math.sin(yaw), 0, -Math.cos(yaw)];
    return [[RING_C[0] + dir[0] * 250, RING_C[1] - 80, RING_C[2] + dir[2] * 250], [RING_C[0] + dir[0] * 1700, RING_C[1] - 80, RING_C[2] + dir[2] * 1700]];
  } },
  // Money: the wallet, then a slide to the owner's rules, then a push into them on the riser.
  { from: 840, to: 1080, via: [RING_C[0] - 600, -2800, RING_C[2] - 1600], viaLook: at(MONEY, [-300, 0, 0]), at: (f) => {
    const slide = ease(f, 930, 962), push = ease(f, 1020, 1080, (x) => x * x * x);
    const x = -720 + 920 * slide + 40 * ease(f, 840, 930);
    const eye = mix3(at(MONEY, [x, 0, 1450 - 40 * ease(f, 930, 1020)]), at(MONEY, [460, -30, 820]), push);
    const look = mix3(at(MONEY, [x, 0, 0]), at(MONEY, [460, -30, 200]), push);
    return [eye, look];
  } },
  // THE DROP: a whip round to the marketplace floor, then a slow orbit over it.
  { from: 1100, to: 1250, via: onCircle(232, 6400, -1400), at: (f) => {
    const o = rad(-14 + 26 * ease(f, 1100, 1250));
    return [at(MARKET, [Math.sin(o) * 1950, -760 + 60 * ease(f, 1100, 1250), Math.cos(o) * 1950]), at(MARKET, [0, 250, 0])];
  } },
  // Bring your own agent: the terminal.
  { from: 1280, to: 1410, via: onCircle(290, 6400, -700), at: (f) => {
    const k = ease(f, 1280, 1410);
    return [at(TERM, [-60 + 50 * k, 40, 1500 - 140 * k]), at(TERM, [-60, 40, 0])];
  } },
  // The reveal: up and out until the whole world is in frame, orbiting slowly through the logo.
  { from: 1440, to: DURATION, via: at(TERM, [600, -3400, 5200]), viaLook: [0, 0, 0], at: (f) => {
    const k = ease(f, 1440, 1560);
    const a = 300 + (f - 1440) * 0.09, r = 8600 - 900 * k;
    return [onCircle(a, r, -6300 + 600 * k), [0, 250, 0]];
  } },
];

const bez = (a: V3, b: V3, c: V3, t: number): V3 => mix3(mix3(a, b, t), mix3(b, c, t), t);

/** Where the camera is at frame f. */
export function camAt(f: number): Cam {
  for (let i = 0; i < SHOTS.length; i++) {
    const s = SHOTS[i]!;
    if (f < s.from && i > 0) {
      const a = SHOTS[i - 1]!;
      const [e0, l0] = a.at(a.to), [e1, l1] = s.at(s.from);
      const t = whip(Math.min(1, Math.max(0, (f - a.to) / (s.from - a.to))));
      const eye = s.via ? bez(e0, s.via, e1, t) : mix3(e0, e1, t);
      const look = s.viaLook ? bez(l0, s.viaLook, l1, t) : mix3(l0, l1, t);
      return cam(eye, look);
    }
    if (f <= s.to) { const [e, l] = s.at(f); return cam(e, l); }
  }
  const last = SHOTS[SHOTS.length - 1]!;
  const [e, l] = last.at(f);
  return cam(e, l);
}
