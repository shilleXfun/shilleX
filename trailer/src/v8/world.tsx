import type { CSSProperties, ReactNode } from 'react';
import { AbsoluteFill } from 'remotion';
import { C } from '../theme';
import { AMBER } from '../v7/lib';
import { type Cam, CX, CY, P, type V3, deg, project, worldCss } from './cam';

/** Depth of field: how blurred (in screen px) something at depth d is when the camera focuses at c.focus. */
export const dof = (d: number, c: Cam) => Math.min(9, Math.max(0, Math.abs(d - c.focus) / c.focus - 0.12) * 10);

/** The 3D world: a perspective from the screen centre and one container that carries the camera. */
export function Stage({ c, children }: { c: Cam; children: ReactNode }) {
  return (
    <AbsoluteFill style={{ perspective: P, perspectiveOrigin: `${CX}px ${CY}px`, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: CX, top: CY, width: 0, height: 0, transformStyle: 'preserve-3d', transform: worldCss(c) }}>{children}</div>
    </AbsoluteFill>
  );
}

/**
 * A flat thing in the world: centred on `pos`, turned by yaw then pitch (degrees). It blurs with its distance from the focus,
 * catches a soft light that slides as the camera moves round it, and is skipped when behind the camera.
 */
export function Plane({ c, pos, yaw = 0, pitch = 0, roll = 0, w, h, opacity = 1, children, style, sheen = true, sharp = false }: {
  c: Cam; pos: V3; yaw?: number; pitch?: number; roll?: number; w: number; h: number; opacity?: number; children?: ReactNode; style?: CSSProperties; sheen?: boolean; sharp?: boolean;
}) {
  const pr = project(pos, c);
  if (pr.d < 80 || opacity <= 0.003) return null;
  const blurScreen = sharp ? 0 : dof(pr.d, c);
  // CSS blurs before the projection, so the blur is set in the plane's own pixels.
  const blur = Math.min(36, blurScreen / Math.max(0.05, pr.s));
  const rel = deg(c.yaw) - yaw - deg(c.pitch) * 0.5 + pitch * 0.3;
  return (
    <div style={{
      // Centred on the world origin, so the default transform-origin is the plane's centre and it turns about `pos`.
      position: 'absolute', left: -w / 2, top: -h / 2, width: w, height: h, opacity,
      transform: `translate3d(${pos[0]}px, ${pos[1]}px, ${pos[2]}px) rotateY(${yaw}deg) rotateX(${pitch}deg) rotateZ(${roll}deg)`,
      filter: blurScreen > 0.35 && pr.s * Math.max(w, h) > 30 ? `blur(${blur}px)` : undefined,
      ...style,
    }}>
      {children}
      {sheen && (
        <div style={{ position: 'absolute', inset: 0, borderRadius: 'inherit', pointerEvents: 'none', mixBlendMode: 'screen', background: `linear-gradient(110deg, transparent ${18 + rel * 1.6}%, rgba(${AMBER},0.10) ${34 + rel * 1.6}%, rgba(255,255,255,0.10) ${40 + rel * 1.6}%, transparent ${56 + rel * 1.6}%)` }} />
      )}
    </div>
  );
}

/** A card face for the real site's pieces: amber rim and a deep glow. */
export const cardStyle = (lit = 0): CSSProperties => ({
  borderRadius: 18, overflow: 'hidden', background: '#0b0c16',
  boxShadow: `0 0 0 ${2 + lit * 2}px rgba(${AMBER},${0.42 + lit * 0.5}), 0 0 ${50 + lit * 60}px rgba(${AMBER},${0.16 + lit * 0.35}), 0 50px 120px rgba(0,0,0,0.8)`,
});

export type Line = { a: V3; b: V3; color: string; width: number; k?: number; opacity?: number };

/** Lines between world points, drawn flat over the world with the same projection (thin, so the overlay never shows). */
export function Lines({ c, lines, blur = 0, glow = true }: { c: Cam; lines: Line[]; blur?: number; glow?: boolean }) {
  const id = `lb${Math.round(blur * 10)}`;
  return (
    <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
      {blur > 0.3 && <filter id={id}><feGaussianBlur stdDeviation={blur} /></filter>}
      <g filter={blur > 0.3 ? `url(#${id})` : undefined}>
        {lines.map((l, i) => {
          const k = l.k ?? 1;
          if (k <= 0) return null;
          const a = project(l.a, c), b = project(l.b, c);
          if (a.d < 80 || b.d < 80) return null;
          const x2 = a.x + (b.x - a.x) * k, y2 = a.y + (b.y - a.y) * k;
          const w = Math.max(0.6, l.width * (a.s + b.s) * 0.5);
          return <line key={i} x1={a.x} y1={a.y} x2={x2} y2={y2} stroke={l.color} strokeWidth={w} strokeLinecap="round" opacity={l.opacity ?? 0.85} style={glow ? { filter: `drop-shadow(0 0 ${Math.min(10, w * 2.5)}px ${l.color})` } : undefined} />;
        })}
      </g>
    </svg>
  );
}

export const UP = C.up;
export const DOWN = C.down;
