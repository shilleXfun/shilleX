import type { CSSProperties, ReactNode } from 'react';
import { AbsoluteFill, Img, interpolate, random, spring, useCurrentFrame } from 'remotion';
import { C, display } from '../theme';
import { AMBER, FPS, lerp } from './lib';

export const Vignette = ({ strength = 0.75 }: { strength?: number }) => (
  <AbsoluteFill style={{ background: `radial-gradient(ellipse 75% 70% at 50% 50%, transparent 50%, rgba(0,0,0,${strength}) 100%)`, pointerEvents: 'none' }} />
);

export const Center = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => (
  <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', ...style }}>{children}</AbsoluteFill>
);

export type Seg = { t: string; accent?: boolean };

/**
 * Kinetic headline: each word rises out of a blur with a 3D flip; `slam` words punch in from large instead.
 * `times` sets each word's start frame; otherwise words follow `at` + i × `stagger`.
 */
export function Words({ segs, at = 0, stagger = 6, times, size, align = 'center', slam = [], style }: {
  segs: Seg[]; at?: number; stagger?: number; times?: number[]; size: number; align?: 'center' | 'flex-start'; slam?: number[]; style?: CSSProperties;
}) {
  const f = useCurrentFrame();
  let i = 0;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: align, alignItems: 'baseline', columnGap: size * 0.24, perspective: 1400, ...style }}>
      {segs.flatMap((seg) => seg.t.split(' ').map((w) => {
        const k = i++;
        const start = times?.[k] ?? at + k * stagger;
        const hard = slam.includes(k);
        const p = spring({ frame: f - start, fps: FPS, config: hard ? { damping: 11, mass: 0.6, stiffness: 190 } : { damping: 19, mass: 0.75, stiffness: 140 } });
        const o = interpolate(p, [0, 0.35], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
        // Slammed words land with a red/cyan split that closes as they settle.
        const ca = hard && f >= start ? Math.max(0, 1 - p) * 18 + Math.abs(1 - p) * 6 : 0;
        const float = Math.sin((f + k * 9) / 15) * size * 0.018 * Math.min(1, Math.max(0, p));
        const split = ca > 0.4 ? `${-ca}px 0 rgba(255,50,90,0.8), ${ca}px 0 rgba(50,220,255,0.8), ` : '';
        return (
          <span key={k} style={{
            display: 'inline-block', fontFamily: display, fontWeight: 800, fontSize: size, letterSpacing: '-0.045em', lineHeight: 1.02, paddingBottom: size * 0.06,
            color: seg.accent ? C.amber : C.ink,
            textShadow: split + (seg.accent ? `0 0 ${size * 0.35}px rgba(${AMBER},0.55), 0 ${size * 0.05}px ${size * 0.2}px rgba(0,0,0,0.6)` : `0 ${size * 0.05}px ${size * 0.25}px rgba(0,0,0,0.7)`),
            opacity: o,
            transform: hard ? `translateY(${float}px) scale(${1 + (1 - p) * 0.9})` : `translateY(${(1 - p) * size * 0.55 + float}px) rotateX(${(1 - p) * -75}deg)`,
            transformOrigin: '50% 100%',
            filter: `blur(${Math.max(0, (1 - p) * (hard ? 26 : 16))}px)`,
          }}>{w}</span>
        );
      }))}
    </div>
  );
}

/** A diagonal light sweep across its parent, for a glint on cards. */
export function Glint({ at, dur = 26, radius = 18 }: { at: number; dur?: number; radius?: number }) {
  const f = useCurrentFrame();
  if (f < at || f > at + dur) return null;
  const p = lerp(f, [at, at + dur], [-0.3, 1.3]);
  return (
    <div style={{ position: 'absolute', inset: 0, borderRadius: radius, overflow: 'hidden', pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', top: '-50%', bottom: '-50%', width: '26%', left: `${p * 100}%`, transform: 'rotate(18deg)', background: `linear-gradient(90deg, transparent, rgba(${AMBER},0.28), rgba(255,255,255,0.22), transparent)`, mixBlendMode: 'screen' }} />
    </div>
  );
}

/** Short horizontal lens streak. */
export function Streak({ at, y, dur = 34 }: { at: number; y: number; dur?: number }) {
  const f = useCurrentFrame();
  if (f < at || f > at + dur) return null;
  const p = lerp(f, [at, at + dur], [0, 1]);
  const o = Math.sin(Math.PI * p);
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top: y, height: 0 }}>
      <div style={{ position: 'absolute', left: `${-40 + p * 80}%`, width: '80%', top: -1, height: 3, background: `linear-gradient(90deg, transparent, rgba(${AMBER},1), #fff, rgba(${AMBER},1), transparent)`, opacity: o }} />
      <div style={{ position: 'absolute', left: `${-40 + p * 80}%`, width: '80%', top: -30, height: 60, background: `radial-gradient(closest-side, rgba(${AMBER},0.45), transparent)`, opacity: o, filter: 'blur(8px)' }} />
    </div>
  );
}

/** A shot of the real site as a floating card: amber rim, deep shadow, a glint when it lands. */
export function Shot({ src, w, h, glint, style, fit = 'cover' }: { src: string; w: number; h?: number; glint?: number; style?: CSSProperties; fit?: 'cover' | 'contain' }) {
  return (
    <div style={{ position: 'absolute', width: w, height: h, borderRadius: 18, overflow: 'hidden', background: '#0b0c16', boxShadow: `0 0 0 2px rgba(${AMBER},0.42), 0 0 50px rgba(${AMBER},0.16), 0 50px 120px rgba(0,0,0,0.75)`, ...style }}>
      <Img src={src} style={{ display: 'block', width: '100%', height: h ? '100%' : 'auto', objectFit: fit, objectPosition: 'top' }} />
      {glint !== undefined && <Glint at={glint} />}
    </div>
  );
}

/** One agent's face: the pixel PFP in a round frame with an amber ring. */
export function Face({ src, size, style, ring = true }: { src: string; size: number; style?: CSSProperties; ring?: boolean }) {
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', overflow: 'hidden', background: '#151830', boxShadow: ring ? `0 0 0 ${Math.max(2, size * 0.06)}px ${C.amber}, 0 0 ${size * 0.5}px rgba(${AMBER},0.35)` : undefined, ...style }}>
      <Img src={src} style={{ width: '100%', height: '100%', imageRendering: 'pixelated' }} />
    </div>
  );
}

/** A small mono caption under a headline. */
export function Caption({ children, at, style }: { children: ReactNode; at: number; style?: CSSProperties }) {
  const f = useCurrentFrame();
  // Plain-text captions type on, fast, with a caret while they type.
  if (typeof children === 'string') {
    const n = Math.max(0, Math.min(children.length, Math.floor((f - at) * 2.6)));
    return (
      <div style={{ fontFamily: display, fontSize: 36, fontWeight: 600, color: 'rgba(243,239,230,0.82)', letterSpacing: '-0.01em', ...style }}>
        {children.slice(0, n)}{n > 0 && n < children.length && <span style={{ color: C.amber }}>▍</span>}
        <span style={{ opacity: 0 }}>{children.slice(n)}</span>
      </div>
    );
  }
  return (
    <div style={{ fontFamily: display, fontSize: 36, fontWeight: 600, color: 'rgba(243,239,230,0.78)', letterSpacing: '-0.01em', opacity: lerp(f, [at, at + 14], [0, 1]), transform: `translateY(${lerp(f, [at, at + 18], [16, 0])}px)`, ...style }}>
      {children}
    </div>
  );
}

/** Embers thrown out from (x, y) on a hit: fast streaks that slow, fall and burn out. */
export function Sparks({ at, x, y, count = 46, power = 1, seed = 's' }: { at: number; x: number; y: number; count?: number; power?: number; seed?: string }) {
  const f = useCurrentFrame();
  const t = f - at;
  if (t < 0 || t > 80) return null;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {Array.from({ length: count }, (_, i) => {
        const life = 1 - t / (36 + random(`${seed}l${i}`) * 40);
        if (life <= 0) return null;
        const a = random(`${seed}a${i}`) * Math.PI * 2;
        const v = (14 + random(`${seed}v${i}`) * 30) * power;
        const drag = Math.exp(-t / 16);
        const d = v * 16 * (1 - drag);
        const vx = Math.cos(a) * v * drag, vy = Math.sin(a) * v * drag * 0.7 + 0.16 * t;
        const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d * 0.7 + 0.08 * t * t;
        const len = 6 + Math.hypot(vx, vy) * 1.6;
        return <div key={i} style={{ position: 'absolute', left: px - len / 2, top: py - 1.5, width: len, height: 3, borderRadius: 2, background: i % 3 ? C.amber : '#fff', boxShadow: `0 0 10px rgba(${AMBER},0.9)`, opacity: Math.min(1, life * 1.5), transform: `rotate(${Math.atan2(vy, vx)}rad)` }} />;
      })}
    </AbsoluteFill>
  );
}

/** Speed lines across the frame for a few frames around a cut: the whip. */
export function Whip({ at, dir = 1 }: { at: number; dir?: 1 | -1 }) {
  const f = useCurrentFrame();
  const t = f - at;
  if (t < -8 || t > 8) return null;
  const o = Math.exp(-(t * t) / 18);
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', opacity: o }}>
      {Array.from({ length: 16 }, (_, i) => {
        const y = random(`wy${at}${i}`) * 1080;
        const w = 300 + random(`ww${at}${i}`) * 900;
        const x = ((random(`wx${at}${i}`) * 2400 + (t + 8) * 260 * dir) % 2700) - 400;
        return <div key={i} style={{ position: 'absolute', left: dir > 0 ? x : 1920 - x - w, top: y, width: w, height: 2 + random(`wh${at}${i}`) * 3, background: `linear-gradient(90deg, transparent, rgba(${AMBER},0.7), rgba(255,255,255,0.8), transparent)` }} />;
      })}
    </AbsoluteFill>
  );
}
