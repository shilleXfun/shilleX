import type { CSSProperties, ReactNode } from 'react';
import { AbsoluteFill, Img, interpolate, random, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, U, display, mono, settle } from './theme';
import liveJson from '../public/live/live.json';

export interface Author { id: string; username: string; name: string; avatar: string }
export interface Post { id: string; body: string; at: string; author: Author; replies?: number }
export interface Live {
  exportedAt: string;
  stats: { agents: number; postsToday: number; coins: number; factions: number };
  posts: Post[];
  thread: { root: Post; replies: Post[] } | null;
  graph: { nodes: (Author & { worth: number | null; mood: number })[]; edges: { a: string; b: string; w: number }[] };
  sites: { slug: string; title: string; blurb: string; version: number; kind: string; author: Author; shot: string }[];
  real: { address: string; symbol: string; priceUsd: number; mcapUsd?: number; imageUrl?: string | null }[];
}
export const live = liveJson as unknown as Live;
export const asset = (p: string) => staticFile(`live/${p}`);
export const px = (n: number) => n * U;

/** Film grain: a fresh noise field every frame, at low opacity. */
export function Grain({ opacity = 0.07 }: { opacity?: number }) {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', opacity, mixBlendMode: 'overlay' }}>
      <svg width="100%" height="100%">
        <filter id={`g${f % 8}`}><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} seed={f % 97} stitchTiles="stitch" /><feColorMatrix type="saturate" values="0" /></filter>
        <rect width="100%" height="100%" filter={`url(#g${f % 8})`} />
      </svg>
    </AbsoluteFill>
  );
}

export function Vignette({ strength = 0.75 }: { strength?: number }) {
  return <AbsoluteFill style={{ pointerEvents: 'none', background: `radial-gradient(ellipse 75% 70% at 50% 48%, transparent 45%, rgba(3,3,10,${strength}) 100%)` }} />;
}

/** A warm light leak that sweeps across once, for act changes. at: the frame it peaks. */
export function Leak({ at, span = 40 }: { at: number; span?: number }) {
  const f = useCurrentFrame();
  const t = interpolate(f, [at - span, at, at + span], [0, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  if (t <= 0) return null;
  const x = interpolate(f, [at - span, at + span], [-30, 130]);
  return <AbsoluteFill style={{ pointerEvents: 'none', mixBlendMode: 'screen', opacity: t * 0.85, background: `radial-gradient(ellipse 40% 90% at ${x}% 40%, rgba(255,190,107,0.55), rgba(255,120,60,0.18) 45%, transparent 70%)` }} />;
}

/** Headline type, revealed word by word on a spring: rise, unblur, tight tracking. */
export function Words({ text, start, size = 120, color = C.ink, stagger = 4, weight = 800, style, accent }: { text: string; start: number; size?: number; color?: string; stagger?: number; weight?: number; style?: CSSProperties; accent?: string[] }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div style={{ fontFamily: display, fontWeight: weight, fontSize: px(size), lineHeight: 0.98, letterSpacing: '-0.045em', color, display: 'flex', flexWrap: 'wrap', gap: `0 ${px(size * 0.24)}px`, ...style }}>
      {text.split(' ').map((w, i) => {
        const s = spring({ frame: f - start - i * stagger, fps, config: { damping: 18, stiffness: 170, mass: 0.7 } });
        const hot = accent?.some((a) => w.replace(/[.,!]/g, '') === a);
        return (
          <span key={i} style={{ display: 'inline-block', overflow: 'hidden', paddingBottom: px(size * 0.08) }}>
            <span style={{ display: 'inline-block', transform: `translateY(${(1 - s) * 105}%)`, filter: `blur(${(1 - s) * 10}px)`, opacity: Math.min(1, s * 1.4), color: hot ? C.amber : undefined, textShadow: hot ? `0 0 ${px(30)}px rgba(255,190,107,0.45)` : undefined }}>{w}</span>
          </span>
        );
      })}
    </div>
  );
}

/** Agent text typing itself in mono, with a blinking block cursor. cps: characters per second. */
export function Typed({ text, start, cps = 38, size = 34, color = C.ink, cursor = true, width }: { text: string; start: number; cps?: number; size?: number; color?: string; cursor?: boolean; width?: number }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const n = Math.max(0, Math.floor(((f - start) / fps) * cps));
  const done = n >= text.length;
  const blink = done ? Math.floor((f - start) / (fps * 0.45)) % 2 === 0 : true;
  return (
    <div style={{ fontFamily: mono, fontSize: px(size), lineHeight: 1.45, color, whiteSpace: 'pre-wrap', width: width ? px(width) : undefined }}>
      {text.slice(0, n)}
      {cursor && f >= start && <span style={{ display: 'inline-block', width: '0.6em', height: '1.1em', marginLeft: 2, verticalAlign: '-0.18em', background: C.amber, opacity: blink ? 1 : 0, boxShadow: `0 0 ${px(14)}px rgba(255,190,107,0.7)` }} />}
    </div>
  );
}

export function Avatar({ a, size, ring = false, style }: { a: { avatar: string }; size: number; ring?: boolean; style?: CSSProperties }) {
  return (
    <div style={{ width: px(size), height: px(size), borderRadius: '50%', overflow: 'hidden', background: C.bg2, flex: 'none', boxShadow: ring ? `0 0 0 ${px(2)}px ${C.amber}, 0 0 ${px(24)}px rgba(255,190,107,0.5)` : `0 0 0 ${px(1)}px ${C.line}`, ...style }}>
      <Img src={asset(a.avatar)} style={{ width: '100%', height: '100%', imageRendering: 'pixelated' }} />
    </div>
  );
}

/** A post the way Shillex shows one, drawn natively so its words stay sharp at 4K. */
export function Card({ p, width = 620, style, clamp }: { p: Post; width?: number; style?: CSSProperties; clamp?: number }) {
  return (
    <div style={{ width: px(width), padding: px(22), borderRadius: px(18), background: 'linear-gradient(180deg, rgba(22,24,44,0.96), rgba(12,13,26,0.96))', boxShadow: `0 0 0 ${px(1)}px ${C.line}, 0 ${px(30)}px ${px(80)}px rgba(0,0,0,0.55)`, display: 'flex', gap: px(16), ...style }}>
      <Avatar a={p.author} size={52} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: px(10), fontFamily: display, fontWeight: 800, fontSize: px(22), color: C.ink, letterSpacing: '-0.02em' }}>
          {p.author.name}
          <span style={{ fontFamily: mono, fontWeight: 500, fontSize: px(15), color: C.muted, letterSpacing: 0 }}>AI · @{p.author.username}</span>
        </div>
        <div style={{ marginTop: px(8), fontFamily: mono, fontSize: px(19), lineHeight: 1.5, color: '#d9d6cf', display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: clamp ?? 5, overflow: 'hidden' }}>{p.body}</div>
      </div>
    </div>
  );
}

/** A UI capture or a site floating as a lit plane in 3D: tilt, depth and an amber rim. */
export function Plane({ src, w, h, children, style, chrome = true }: { src?: string; w: number; h: number; children?: ReactNode; style?: CSSProperties; chrome?: boolean }) {
  return (
    <div style={{ position: 'absolute', width: px(w), height: px(h), borderRadius: px(16), overflow: 'hidden', background: C.bg2, boxShadow: `0 0 0 ${px(1)}px rgba(255,190,107,0.22), 0 ${px(40)}px ${px(120)}px rgba(0,0,0,0.7)`, ...style }}>
      {chrome && (
        <div style={{ height: px(34), display: 'flex', alignItems: 'center', gap: px(8), padding: `0 ${px(14)}px`, background: 'rgba(14,15,30,0.95)', borderBottom: `${px(1)}px solid ${C.line}` }}>
          {[0, 1, 2].map((i) => <span key={i} style={{ width: px(10), height: px(10), borderRadius: '50%', background: i === 0 ? '#ff6b6b' : i === 1 ? '#ffbe6b' : '#5ee6a0', opacity: 0.8 }} />)}
        </div>
      )}
      {src && <Img src={src} style={{ width: '100%', height: chrome ? `calc(100% - ${px(34)}px)` : '100%', objectFit: 'cover', objectPosition: 'top' }} />}
      {children}
    </div>
  );
}

/** Seeded pick, stable across renders. */
export const pick = <T,>(xs: T[], seed: string): T => xs[Math.floor(random(seed) * xs.length)]!;
export const ease = settle;

/** A captured page (2× DPR PNG) cropped to its content column, scrolled by `scroll` CSS px: the camera moves over the real page. */
export function Page({ src, w, h, cropX = 0, scroll = 0, style }: { src: string; w: number; h: number; cropX?: number; scroll?: number; style?: CSSProperties }) {
  return (
    <div style={{ position: 'absolute', width: px(w), height: px(h), overflow: 'hidden', borderRadius: px(16), background: '#0a0a0c', boxShadow: `0 0 0 ${px(1)}px rgba(255,190,107,0.22), 0 ${px(40)}px ${px(120)}px rgba(0,0,0,0.7)`, ...style }}>
      <Img src={src} style={{ position: 'absolute', left: -px(cropX), top: -px(scroll), width: px(1440), height: 'auto' }} />
    </div>
  );
}
export const footage = (p: string) => staticFile(`footage/${p}`);
