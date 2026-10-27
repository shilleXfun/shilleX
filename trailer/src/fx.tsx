import type { CSSProperties, ReactNode } from 'react';
import { AbsoluteFill, Img, interpolate, random, staticFile, useCurrentFrame } from 'remotion';
import filmIndex from './film-index.json';
import { C, mono } from './theme';

/**
 * The trailer's motion kit (v3, owner: "fast, animated, tricks, real input"). Real filmed sessions with the real cursor,
 * decoding type, impact shake, colour split, flash frames, light streaks and embers. Everything is driven by the frame.
 */
type Film = { width: number; height: number; frames: { file: string; t: number }[]; mouse: { t: number; x: number; y: number; down: boolean }[] };
const films = filmIndex as unknown as Record<string, Film>;
export type FilmName = keyof typeof filmIndex;

/** The film's frame at `ms`, and the cursor there (null before it first moved). */
function filmAt(f: Film, ms: number) {
  let lo = 0, hi = f.frames.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (f.frames[mid]!.t <= ms) lo = mid; else hi = mid - 1; }
  const m = f.mouse;
  let cur: { x: number; y: number } | null = null;
  for (let i = 0; i < m.length; i++) {
    if (m[i]!.t > ms) { const a = m[i - 1]; if (a) { const b = m[i]!; const k = (ms - a.t) / Math.max(1, b.t - a.t); cur = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }; } break; }
    cur = { x: m[i]!.x, y: m[i]!.y };
  }
  const clicks = m.filter((p) => p.down && p.t <= ms && ms - p.t < 450).map((p) => ({ x: p.x, y: p.y, age: (ms - p.t) / 450 }));
  return { frame: f.frames[lo]!, cur, clicks };
}

/**
 * A filmed session played back: `ms(frame)` maps the composition's frame to the film's time, so a shot can speed-ramp. The real
 * cursor is drawn where it was, with a ripple on each click. Sized to `w`×`h` (it keeps the film's 16:10).
 */
export function FilmClip({ name, ms, w, h, style, cursor = true }: { name: FilmName; ms: (frame: number) => number; w: number; h: number; style?: CSSProperties; cursor?: boolean }) {
  const frame = useCurrentFrame();
  const f = films[name];
  if (!f) return null;
  const t = Math.max(0, Math.min(f.frames.at(-1)!.t, ms(frame)));
  const { frame: fr, cur, clicks } = filmAt(f, t);
  const sx = w / f.width, sy = h / f.height;
  return (
    <div style={{ position: 'absolute', width: w, height: h, overflow: 'hidden', background: '#0a0a0c', ...style }}>
      <Img src={staticFile(`footage/film/${name}/${fr.file}`)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      {cursor && clicks.map((c, i) => (
        <div key={i} style={{ position: 'absolute', left: c.x * sx, top: c.y * sy, width: 120 * sx * (0.3 + c.age), height: 120 * sx * (0.3 + c.age), marginLeft: -60 * sx * (0.3 + c.age), marginTop: -60 * sx * (0.3 + c.age), borderRadius: '50%', border: `${3 * sx}px solid ${C.amber}`, opacity: 1 - c.age, boxShadow: `0 0 ${30 * sx}px ${C.amber}` }} />
      ))}
      {cursor && cur && (
        <svg width={26 * sx * 1.6} height={36 * sx * 1.6} viewBox="0 0 26 36" style={{ position: 'absolute', left: cur.x * sx, top: cur.y * sy, filter: 'drop-shadow(0 2px 6px rgba(0,0,0,.6))' }}>
          <path d="M2 2 L2 28 L9 21 L14 33 L19 31 L14 19 L24 19 Z" fill="#fff" stroke="#000" strokeWidth="2" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  );
}

const GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789$@#%&*+=<>/';
/** Text that decodes: each letter scrambles through glyphs until its turn, left to right, `per` frames apart. */
export function Decode({ text, start, per = 1.2, settle = 6, style }: { text: string; start: number; per?: number; settle?: number; style?: CSSProperties }) {
  const f = useCurrentFrame() - start;
  if (f < 0) return null;
  return (
    <span style={style}>
      {[...text].map((ch, i) => {
        const reveal = i * per + settle;
        if (ch === ' ') return ' ';
        if (f >= reveal) return <span key={i}>{ch}</span>;
        if (f < i * per * 0.4) return <span key={i} style={{ opacity: 0 }}>{ch}</span>;
        return <span key={i} style={{ color: C.amber, opacity: 0.85 }}>{GLYPHS[Math.floor(random(`${i}:${Math.floor(f / 2)}`) * GLYPHS.length)]}</span>;
      })}
    </span>
  );
}

/** A camera shake that decays after each hit. hits: frames (relative to the composition) where something lands. */
export function useShake(hits: number[], strength = 22) {
  const f = useCurrentFrame();
  let x = 0, y = 0, r = 0;
  for (const h of hits) {
    const k = f - h;
    if (k < 0 || k > 14) continue;
    const a = strength * Math.exp(-k / 4);
    x += (random(`sx${h}:${k}`) - 0.5) * a; y += (random(`sy${h}:${k}`) - 0.5) * a; r += (random(`sr${h}:${k}`) - 0.5) * a * 0.04;
  }
  return `translate(${x}px, ${y}px) rotate(${r}deg)`;
}

/** Colour split for `frames` frames after each hit (a CSS filter on the layer). */
export function splitFilter(frame: number, hits: number[], px = 14, frames = 6): string {
  const h = hits.find((x) => frame >= x && frame < x + frames);
  if (h === undefined) return 'none';
  const k = 1 - (frame - h) / frames, d = px * k;
  return `drop-shadow(${d}px 0 0 rgba(255,40,90,.75)) drop-shadow(${-d}px 0 0 rgba(40,220,255,.75))`;
}

/** A white-hot flash over everything, 1 frame bright then gone. */
export function Flash({ at, color = '#fff4e2', dur = 5 }: { at: number; color?: string; dur?: number }) {
  const f = useCurrentFrame();
  const o = interpolate(f, [at, at + 1, at + dur], [0, 0.9, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return o > 0 ? <AbsoluteFill style={{ background: color, opacity: o, pointerEvents: 'none' }} /> : null;
}

/** A light streak that tears across the frame on a hit. */
export function Streak({ at, y = 0.5, dur = 14 }: { at: number; y?: number; dur?: number }) {
  const f = useCurrentFrame();
  const k = (f - at) / dur;
  if (k < 0 || k > 1) return null;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', mixBlendMode: 'screen' }}>
      <div style={{ position: 'absolute', top: `${y * 100}%`, left: `${-60 + k * 160}%`, width: '60%', height: 6, marginTop: -3, background: `linear-gradient(90deg, transparent, ${C.amber}, #fff, ${C.amber}, transparent)`, boxShadow: `0 0 40px 10px rgba(255,190,107,.5)`, opacity: 1 - Math.abs(k - 0.5) * 1.6 }} />
    </AbsoluteFill>
  );
}

/** Embers drifting up through the frame, a few dozen, seeded. */
export function Embers({ n = 40, from = 0, color = C.amber }: { n?: number; from?: number; color?: string }) {
  const f = useCurrentFrame() - from;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {Array.from({ length: n }, (_, i) => {
        const speed = 0.6 + random(`es${i}`) * 1.6, x = random(`ex${i}`) * 100, y = (100 + random(`ey${i}`) * 100 - f * speed * 0.35) % 110;
        const size = 2 + random(`ez${i}`) * 5;
        return <div key={i} style={{ position: 'absolute', left: `${x + Math.sin((f + i * 20) / 30) * 1.5}%`, top: `${y}%`, width: size, height: size, borderRadius: '50%', background: color, opacity: 0.25 + random(`eo${i}`) * 0.5, boxShadow: `0 0 ${size * 3}px ${color}` }} />;
      })}
    </AbsoluteFill>
  );
}

/** A label stamped on screen, mono caps with a bracket, for quick captions between cuts. */
export function Tag({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div style={{ fontFamily: mono, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: C.amber, ...style }}>[ {children} ]</div>;
}
