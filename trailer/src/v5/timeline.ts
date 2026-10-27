import track from '../beats-track.json';

/**
 * v5's timeline, all from the track's beats (scripts/beats.py → src/beats-track.json). The track is shifted so its drop lands
 * at DROP_AT seconds of the trailer; every cut is a beat. Sections follow the owner's story (docs in trailer/PLAN-v5.md).
 */
export const FPS = 60;
const DROP_AT = 28;
/** Seconds of the track before the trailer starts (negative: the music starts after a short silence). */
export const OFFSET = track.drop - DROP_AT;
/** Beat times in trailer seconds. */
export const BEATS: number[] = track.beats.map((b) => b - OFFSET).filter((b) => b >= 0);
export const f = (sec: number) => Math.round(sec * FPS);
/** The beat nearest to `sec` (trailer seconds), as a frame. */
export const snap = (sec: number) => f(BEATS.reduce((best, b) => (Math.abs(b - sec) < Math.abs(best - sec) ? b : best), BEATS[0] ?? sec));
/** The n-th beat after the beat nearest to `sec`. */
export const beatsAfter = (sec: number, n: number) => {
  const i = BEATS.findIndex((b) => f(b) >= snap(sec));
  return f(BEATS[Math.min(BEATS.length - 1, i + n)] ?? sec + n * 0.5);
};
export const DROP = f(DROP_AT);
const beatLen = 60 / track.tempo;
/** The n-th detected beat after the drop (counted on the tempo only where the tracker found no more beats, e.g. a silent tail). */
const after = (n: number) => {
  const i = BEATS.findIndex((b) => f(b) >= DROP);
  const b = BEATS[i + n];
  return b !== undefined ? f(b) : f((BEATS[BEATS.length - 1] ?? DROP_AT) + (i + n - (BEATS.length - 1)) * beatLen);
};

/** Every section's first frame. */
export const T = {
  cold: 0,
  nobody: snap(4),
  anAi: snap(5.4),
  esc: snap(8.0),
  build: snap(DROP_AT - 8),
  drop: DROP,
  logo: after(4),
  outro1: after(7),
  outro2: after(12),
  end: after(20),
  out: after(20) + f(2.4),
};
export const DURATION = T.out;

/** The escalation's shots: real beef and the three sites, each on its own beats. kind, then how many beats it holds. */
export type Shot = { kind: 'beef'; i: number } | { kind: 'site'; i: number };
const PLAN: [Shot, number][] = [
  [{ kind: 'beef', i: 0 }, 4], [{ kind: 'site', i: 0 }, 3], [{ kind: 'beef', i: 1 }, 4], [{ kind: 'site', i: 1 }, 3],
  [{ kind: 'beef', i: 2 }, 4], [{ kind: 'site', i: 2 }, 3], [{ kind: 'beef', i: 3 }, 4],
];
/** The escalation's shots with their frames, fitted to the beats between T.esc and T.build. */
export const SHOTS: { shot: Shot; from: number; to: number }[] = (() => {
  const startI = BEATS.findIndex((b) => f(b) >= T.esc);
  const out: { shot: Shot; from: number; to: number }[] = [];
  let i = startI;
  for (const [shot, n] of PLAN) {
    const from = f(BEATS[i]!), to = Math.min(T.build, f(BEATS[Math.min(BEATS.length - 1, i + n)]!));
    if (from >= T.build) break;
    out.push({ shot, from, to });
    i += n;
  }
  if (out.length) out[out.length - 1]!.to = T.build;
  return out;
})();
/** Beat frames inside [a, b). */
export const beatFrames = (a: number, b: number) => BEATS.map(f).filter((x) => x >= a && x < b);
export const TRACK = track;
