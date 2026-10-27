import type { CSSProperties, ReactNode } from 'react';
import { AbsoluteFill, Img, interpolate, random, spring, useCurrentFrame } from 'remotion';
import { C, display } from '../theme';
import { AMBER, FPS, lerp } from './lib';

/** The stage under every scene: night, an amber glow and slow rays, halftone dots, a grid floor and drifting embers. */
export function Backdrop({ glow = 1, grid = 0.3 }: { glow?: number; grid?: number }) {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: C.bg, overflow: 'hidden' }}>
      <AbsoluteFill style={{ background: `radial-gradient(1300px 820px at 50% 58%, rgba(255,150,60,${0.34 * glow}) 0%, rgba(${AMBER},${0.12 * glow}) 38%, rgba(8,9,20,0) 75%)` }} />
      <AbsoluteFill
        style={{
          background: `repeating-conic-gradient(from ${f * 0.07}deg at 50% 58%, rgba(${AMBER},${0.045 * glow + 0.01}) 0deg 7deg, transparent 7deg 14deg)`,
          WebkitMaskImage: 'radial-gradient(circle at 50% 58%, black 15%, transparent 70%)',
          maskImage: 'radial-gradient(circle at 50% 58%, black 15%, transparent 70%)',
        }}
      />
      <AbsoluteFill style={{ backgroundImage: `radial-gradient(rgba(${AMBER},0.08) 1.6px, transparent 2.2px)`, backgroundSize: '28px 28px' }} />
      <div
        style={{
          position: 'absolute', left: -1040, top: 600, width: 4000, height: 1400,
          transform: 'perspective(700px) rotateX(74deg)', transformOrigin: '50% 0%',
          backgroundImage: `linear-gradient(rgba(${AMBER},0.5) 2px, transparent 2px), linear-gradient(90deg, rgba(${AMBER},0.5) 2px, transparent 2px)`,
          backgroundSize: '90px 90px', backgroundPosition: `0px ${f * 2.4}px`, opacity: grid,
          WebkitMaskImage: 'linear-gradient(180deg, transparent 0%, black 35%, black 60%, transparent 100%)',
          maskImage: 'linear-gradient(180deg, transparent 0%, black 35%, black 60%, transparent 100%)',
        }}
      />
      {Array.from({ length: 70 }, (_, i) => {
        const x = random(`dx${i}`) * 1920;
        const y = (random(`dy${i}`) * 1080 - f * (0.2 + random(`dv${i}`) * 0.6) + 2160) % 1080;
        const s = 1.5 + random(`ds${i}`) * 2.5;
        const tw = 0.35 + 0.65 * Math.abs(Math.sin(f / 30 + i));
        return <div key={i} style={{ position: 'absolute', left: x, top: y, width: s, height: s, borderRadius: 9, background: i % 4 === 0 ? '#ffffff' : C.amber, opacity: 0.45 * tw }} />;
      })}
    </AbsoluteFill>
  );
}

export const Vignette = ({ strength = 0.75 }: { strength?: number }) => (
  <AbsoluteFill style={{ background: `radial-gradient(ellipse 75% 70% at 50% 50%, transparent 50%, rgba(4,5,11,${strength}) 100%)`, pointerEvents: 'none' }} />
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
        return (
          <span key={k} style={{
            display: 'inline-block', fontFamily: display, fontWeight: 800, fontSize: size, letterSpacing: '-0.045em', lineHeight: 1.02, paddingBottom: size * 0.06,
            color: seg.accent ? C.amber : C.ink,
            textShadow: seg.accent ? `0 0 ${size * 0.35}px rgba(${AMBER},0.55), 0 ${size * 0.05}px ${size * 0.2}px rgba(0,0,0,0.6)` : `0 ${size * 0.05}px ${size * 0.25}px rgba(0,0,0,0.7)`,
            opacity: o,
            transform: hard ? `scale(${1 + (1 - p) * 0.9})` : `translateY(${(1 - p) * size * 0.55}px) rotateX(${(1 - p) * -75}deg)`,
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
  return (
    <div style={{ fontFamily: display, fontSize: 36, fontWeight: 600, color: 'rgba(243,239,230,0.78)', letterSpacing: '-0.01em', opacity: lerp(f, [at, at + 14], [0, 1]), transform: `translateY(${lerp(f, [at, at + 18], [16, 0])}px)`, ...style }}>
      {children}
    </div>
  );
}
