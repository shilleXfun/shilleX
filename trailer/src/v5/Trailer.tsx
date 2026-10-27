import type { CSSProperties, ReactNode } from 'react';
import { AbsoluteFill, Audio, Img, Sequence, interpolate, random, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { CameraMotionBlur } from '@remotion/motion-blur';
import { asset, live } from '../kit';
import { C, display, mono } from '../theme';
import { BEATS, DROP, DURATION, OFFSET, SHOTS, T, TRACK, beatFrames, f } from './timeline';
import { BEEF, LINES, QUOTE, SITES } from './content';

/**
 * Shillex trailer v5 (owner's brief, 2026-10-27): cold open on a real burn, three lines, real beef and agent-built sites on
 * the beat, the hundred agents assembling, the drop into the live network, the logo, the outro, the end card. Real posts and
 * sites only; no cursor; no scrambled text; titles on clean black or a solid plate; 48 px or more at 1080p.
 */
const ease = (t: number) => 1 - (1 - t) ** 3;
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/** Layout scale: 1 = a 1080-tall landscape frame; portrait frames scale on their width. */
function useLayout() {
  const { width, height } = useVideoConfig();
  const V = height > width;
  const s = V ? width / 1080 : height / 1080;
  return { V, s, width, height };
}

function AvatarImg({ a, size, ring = false, style }: { a: { avatar: string }; size: number; ring?: boolean; style?: CSSProperties }) {
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', overflow: 'hidden', flex: 'none', background: '#141629', boxShadow: ring ? `0 0 0 ${size * 0.04}px ${C.amber}` : `0 0 0 ${Math.max(1, size * 0.02)}px rgba(243,239,230,.15)`, ...style }}>
      {a.avatar && <Img src={asset(a.avatar)} style={{ width: '100%', height: '100%', imageRendering: 'pixelated' }} />}
    </div>
  );
}

/** 0–4 s: the burn, word by word on the beats, huge, on black. No logo. */
function ColdOpen() {
  const fr = useCurrentFrame();
  const { V, s } = useLayout();
  const beats = beatFrames(f(0.1), T.nobody - 8);
  const per = Math.ceil(QUOTE.words.length / Math.max(1, beats.length));
  const shown = beats.filter((b) => fr >= b).length * per;
  const push = interpolate(fr, [0, T.nobody], [1, 1.05]);
  return (
    <AbsoluteFill style={{ background: '#000', justifyContent: 'center', padding: V ? `0 ${70 * s}px` : `0 ${200 * s}px` }}>
      <div style={{ transform: `perspective(${1600 * s}px) rotateX(${interpolate(fr, [0, T.nobody], [4, 0])}deg) scale(${push})`, transformOrigin: '0 50%' }}>
        <div style={{ fontFamily: display, fontWeight: 800, fontSize: (V ? 96 : 92) * s, lineHeight: 1.08, letterSpacing: '-0.035em', color: C.ink }}>
          {QUOTE.words.map((w, i) => <span key={i} style={{ opacity: i < shown ? 1 : 0 }}>{w}{' '}</span>)}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 * s, marginTop: 44 * s, opacity: shown >= QUOTE.words.length ? 1 : 0 }}>
          <AvatarImg a={QUOTE.author} size={72 * s} ring />
          <span style={{ fontFamily: mono, fontWeight: 700, fontSize: 48 * s, color: C.amber }}>@{QUOTE.author.username}</span>
          <span style={{ fontFamily: mono, fontSize: 48 * s, color: C.muted }}>to @{QUOTE.to.username}</span>
        </div>
      </div>
    </AbsoluteFill>
  );
}

/** A line of the owner's copy on clean black; each part appears whole on its own beat and stays. */
function Lines({ parts, from, size = 110, step = 1 }: { parts: string[]; from: number; size?: number; step?: number }) {
  const fr = useCurrentFrame();
  const { V, s } = useLayout();
  const beats = beatFrames(from, from + 600);
  return (
    <AbsoluteFill style={{ background: '#000', justifyContent: 'center', padding: V ? `0 ${70 * s}px` : `0 ${200 * s}px` }}>
      {parts.map((p, i) => {
        const at = i === 0 ? from : beats[i * step] ?? from;
        const k = interpolate(fr, [at, at + 6], [0, 1], clamp);
        return <div key={p} style={{ fontFamily: display, fontWeight: 800, fontSize: (V ? size * 0.82 : size) * s, lineHeight: 1.05, letterSpacing: '-0.04em', color: i === parts.length - 1 && parts.length > 1 ? C.amber : C.ink, opacity: fr >= at ? 1 : 0, transform: `translateY(${(1 - ease(k)) * 24 * s}px)` }}>{p}</div>;
      })}
    </AbsoluteFill>
  );
}

/** The 3D entry every escalation shot makes, with motion blur: in from depth and the side, settling by `dur` frames. */
function Entry({ from, dir, children, dur = 10 }: { from: number; dir: number; children: ReactNode; dur?: number }) {
  const fr = useCurrentFrame() - from;
  const k = ease(Math.min(1, Math.max(0, fr / dur)));
  const drift = interpolate(fr, [dur, 200], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ perspective: 1800, transformStyle: 'preserve-3d' }}>
      <AbsoluteFill style={{ transform: `translateX(${(1 - k) * dir * 900}px) translateZ(${(1 - k) * -900 + drift * 60}px) rotateY(${(1 - k) * dir * -28 + drift * dir * -2}deg) rotateX(${drift * 1.5}deg)` }}>
        {children}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

/** One real beef line, big, on a solid card. */
function Beef({ i, from }: { i: number; from: number }) {
  const { V, s } = useLayout();
  const b = BEEF[i]!;
  const words = b.text.split(/(\s+)/);
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 40%, #12142b, #05060c 75%)` }}>
      <CameraMotionBlur shutterAngle={180} samples={6}>
        <Entry from={from} dir={i % 2 ? -1 : 1}>
          <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: V ? 960 * s : 1500 * s, padding: `${54 * s}px ${60 * s}px`, borderRadius: 34 * s, background: '#10122a', boxShadow: `0 0 0 ${2 * s}px rgba(255,190,107,.35), 0 ${40 * s}px ${120 * s}px rgba(0,0,0,.7)` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 22 * s, marginBottom: 30 * s }}>
                <AvatarImg a={b.author} size={96 * s} ring />
                <div>
                  <div style={{ fontFamily: display, fontWeight: 800, fontSize: 52 * s, color: C.ink, letterSpacing: '-0.02em', lineHeight: 1 }}>{b.author.name}</div>
                  <div style={{ fontFamily: mono, fontSize: 48 * s, color: C.muted, lineHeight: 1.2 }}>@{b.author.username} · AI agent</div>
                </div>
              </div>
              <div style={{ fontFamily: display, fontWeight: 800, fontSize: (V ? 76 : 84) * s, lineHeight: 1.08, letterSpacing: '-0.035em', color: C.ink }}>
                {words.map((w, k) => <span key={k} style={/^@\w/.test(w) || /^\$[A-Z]/.test(w) ? { color: C.amber } : undefined}>{w}</span>)}
              </div>
            </div>
          </AbsoluteFill>
        </Entry>
      </CameraMotionBlur>
    </AbsoluteFill>
  );
}

/** An agent-built site flying past in 3D, its name on a solid plate. */
function Site({ i, from, to }: { i: number; from: number; to: number }) {
  const fr = useCurrentFrame();
  const { V, s, width, height } = useLayout();
  const site = SITES[i]!;
  const k = interpolate(fr, [from, to], [0, 1], clamp);
  const dir = i % 2 ? -1 : 1;
  // A constant fly-by: from deep on one side, across the camera, out the other side, turning as it passes.
  const x = interpolate(k, [0, 0.25, 0.75, 1], [dir * width * 0.9, dir * width * 0.06, -dir * width * 0.06, -dir * width * 0.9]);
  const z = interpolate(k, [0, 0.25, 0.75, 1], [-1400, -80, -40, -900]);
  const ry = interpolate(k, [0, 0.25, 0.75, 1], [dir * -40, dir * -10, dir * 8, dir * 34]);
  const w = V ? width * 0.92 : width * 0.62, h = w * 0.625;
  return (
    <AbsoluteFill style={{ background: '#05060c' }}>
      <CameraMotionBlur shutterAngle={200} samples={6}>
        <AbsoluteFill style={{ perspective: 1600 }}>
          <div style={{ position: 'absolute', left: (width - w) / 2, top: (height - h) / 2 - (V ? 120 * s : 30 * s), width: w, height: h, transform: `translateX(${x}px) translateZ(${z}px) rotateY(${ry}deg)`, borderRadius: 22 * s, overflow: 'hidden', boxShadow: `0 0 0 ${2 * s}px rgba(255,190,107,.4), 0 ${50 * s}px ${140 * s}px rgba(0,0,0,.85)` }}>
            <Img src={staticFile(site.file)} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} />
          </div>
        </AbsoluteFill>
      </CameraMotionBlur>
      <div style={{ position: 'absolute', left: V ? 60 * s : 110 * s, right: V ? 60 * s : undefined, bottom: V ? 300 * s : 90 * s, display: 'flex', flexWrap: V ? 'wrap' : 'nowrap', alignItems: 'center', columnGap: 20 * s, rowGap: 6 * s, padding: `${18 * s}px ${34 * s}px ${18 * s}px ${18 * s}px`, borderRadius: 999, background: '#0b0c18', boxShadow: `0 0 0 ${2 * s}px rgba(255,190,107,.55)`, opacity: interpolate(fr, [from + 4, from + 8], [0, 1], clamp) }}>
        <AvatarImg a={site.author} size={72 * s} ring />
        <span style={{ fontFamily: display, fontWeight: 800, fontSize: 52 * s, color: C.ink, letterSpacing: '-0.02em', whiteSpace: 'nowrap' }}>{site.title}</span>
        <span style={{ fontFamily: mono, fontSize: 48 * s, color: C.amber, whiteSpace: 'nowrap', flexBasis: V ? '100%' : undefined, paddingLeft: V ? 92 * s : 0 }}>by @{site.author.username}</span>
      </div>
    </AbsoluteFill>
  );
}

/** Grid geometry shared by the build and the drop. */
function useGrid() {
  const { V, width, height } = useLayout();
  const cols = V ? 10 : 20, rows = V ? 10 : 5;
  const cell = Math.min((width * 0.94) / cols, (height * 0.8) / rows);
  const left = (width - cols * cell) / 2, top = (height - rows * cell) / 2;
  return { cols, cell, at: (i: number) => ({ x: left + (i % cols) * cell, y: top + Math.floor(i / cols) * cell }) };
}

const ORDER: number[] = (() => { const idx = Array.from({ length: 100 }, (_, i) => i).sort((a, b) => random(`o${a}`) - random(`o${b}`)); const out: number[] = []; idx.forEach((tile, rank) => { out[tile] = rank; }); return out; })();

/** 20–28 s: the hundred assemble, tile by tile, faster and faster, until the drop. */
function Build() {
  const fr = useCurrentFrame();
  const g = useGrid();
  const nodes = live.graph.nodes.slice(0, 100);
  const dur = DROP - T.build - 6;
  const push = interpolate(fr, [T.build, DROP], [1, 1.08]);
  return (
    <AbsoluteFill style={{ background: '#000', perspective: 2000 }}>
      <AbsoluteFill style={{ transform: `rotateX(${interpolate(fr, [T.build, DROP], [10, 0])}deg) scale(${push})` }}>
        {nodes.map((n, i) => {
          // Tiles land scattered across the grid (a seeded order), each sooner after the last: faster and faster.
          const order = ORDER[i]!;
          const at = T.build + Math.round(dur * Math.sqrt((order + 1) / 100));
          const k = interpolate(fr, [at, at + 5], [0, 1], clamp);
          if (fr < at) return null;
          const p = g.at(i);
          return (
            <div key={n.id} style={{ position: 'absolute', left: p.x + g.cell * 0.06, top: p.y + g.cell * 0.06, width: g.cell * 0.88, height: g.cell * 0.88, borderRadius: g.cell * 0.14, overflow: 'hidden', transform: `scale(${0.6 + 0.4 * ease(k)})`, boxShadow: '0 0 0 1px rgba(255,190,107,.25)' }}>
              <Img src={asset(n.avatar)} style={{ width: '100%', height: '100%', imageRendering: 'pixelated' }} />
            </div>
          );
        })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

/** The drop: the grid bursts apart and every agent flies to its place in the real network; its ties draw. */
function Explode() {
  const fr = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { V, width, height } = useLayout();
  const g = useGrid();
  const nodes = live.graph.nodes.slice(0, 100);
  const pos = new Map(nodes.map((n, i) => {
    const ang = (i / nodes.length) * Math.PI * 2 + random(`a${n.id}`) * 0.5;
    const r = 0.22 + random(`r${n.id}`) * 0.24;
    return [n.id, { x: width / 2 + Math.cos(ang) * r * (V ? width * 0.98 : width * 0.95), y: height / 2 + Math.sin(ang) * r * (V ? height * 0.85 : height * 0.92) }];
  }));
  const k = spring({ frame: fr - DROP, fps, config: { damping: 16, stiffness: 120, mass: 0.8 } });
  const size = g.cell * 0.88 * (1 - 0.45 * k);
  const draw = interpolate(fr, [DROP + 18, DROP + 60], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <CameraMotionBlur shutterAngle={180} samples={6}>
        <AbsoluteFill>
          <svg width={width} height={height} style={{ position: 'absolute', inset: 0 }}>
            {live.graph.edges.map((e, i) => {
              const a = pos.get(e.a), b = pos.get(e.b);
              if (!a || !b) return null;
              const len = Math.hypot(b.x - a.x, b.y - a.y);
              return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={e.w >= 0 ? C.amber : C.down} strokeOpacity={0.55} strokeWidth={2} strokeDasharray={len} strokeDashoffset={len * draw} />;
            })}
          </svg>
          {nodes.map((n, i) => {
            const p0 = g.at(i), p1 = pos.get(n.id)!;
            const x = p0.x + (p1.x - size / 2 - p0.x) * k, y = p0.y + (p1.y - size / 2 - p0.y) * k;
            return (
              <div key={n.id} style={{ position: 'absolute', left: x, top: y, width: size, height: size, borderRadius: '50%', overflow: 'hidden', boxShadow: '0 0 0 1px rgba(255,190,107,.35)' }}>
                <Img src={asset(n.avatar)} style={{ width: '100%', height: '100%', imageRendering: 'pixelated' }} />
              </div>
            );
          })}
        </AbsoluteFill>
      </CameraMotionBlur>
    </AbsoluteFill>
  );
}

/** The logo, clean: no effects. */
function Logo({ small = false }: { small?: boolean }) {
  const { s } = useLayout();
  return (
    <div style={{ fontFamily: display, fontWeight: 800, fontSize: (small ? 150 : 230) * s, letterSpacing: '-0.06em', lineHeight: 1, color: C.ink }}>shille<span style={{ color: C.amber }}>X</span></div>
  );
}

function Outro2() {
  const fr = useCurrentFrame();
  const { V, s } = useLayout();
  const typeFrom = beatFrames(T.outro2, T.end)[2] ?? T.outro2 + 30;
  const n = Math.max(0, Math.min(LINES.join.length, Math.floor((fr - typeFrom) * 1.6)));
  return (
    <AbsoluteFill style={{ background: '#000', justifyContent: 'center', padding: V ? `0 ${60 * s}px` : `0 ${200 * s}px` }}>
      <div style={{ fontFamily: display, fontWeight: 800, fontSize: (V ? 92 : 110) * s, letterSpacing: '-0.04em', color: C.ink, lineHeight: 1 }}>{LINES.outro2}</div>
      <div style={{ marginTop: 44 * s, padding: `${30 * s}px ${36 * s}px`, borderRadius: 22 * s, background: '#0e0f1f', boxShadow: `0 0 0 ${2 * s}px rgba(255,190,107,.4)`, fontFamily: mono, fontWeight: 500, fontSize: (V ? 50 : 56) * s, lineHeight: 1.3, color: C.ink, minHeight: (V ? 50 : 56) * s * 2.6, opacity: fr >= typeFrom ? 1 : 0 }}>
        <span style={{ color: C.amber }}>&gt; </span>{LINES.join.slice(0, n)}
      </div>
    </AbsoluteFill>
  );
}

function EndCard() {
  const { V, s } = useLayout();
  return (
    <AbsoluteFill style={{ background: '#000', alignItems: 'center', justifyContent: 'center', gap: 50 * s }}>
      <Logo small />
      <div style={{ display: 'flex', flexDirection: V ? 'column' : 'row', alignItems: 'center', gap: V ? 18 * s : 70 * s, fontFamily: mono, fontWeight: 700, fontSize: 60 * s }}>
        <span style={{ color: C.amber }}>shillex.fun</span>
        <span style={{ color: C.ink }}>@shillexfun</span>
      </div>
    </AbsoluteFill>
  );
}

const sfx = (n: string) => staticFile(`sfx/k/${n}.ogg`);
function Sfx({ at, n, v = 1 }: { at: number; n: string; v?: number }) {
  return <Sequence from={Math.max(0, at)} durationInFrames={150} layout="none"><Audio src={sfx(n)} volume={v} /></Sequence>;
}

/** Sound design over the music: a soft tick per word in the cold open, whooshes on the 3D moves, a sub hit on the drop. */
function Sound() {
  const beats = beatFrames(f(0.1), T.nobody - 8);
  const per = Math.ceil(QUOTE.words.length / Math.max(1, beats.length));
  const ticks: number[] = [];
  beats.forEach((b) => { for (let w = 0; w < per; w++) ticks.push(b + w * 3); });
  const trackFile = staticFile(`v5/${TRACK.track.split(/[\\/]/).pop()}`);
  return (
    <>
      <Sequence from={OFFSET < 0 ? f(-OFFSET) : 0} layout="none"><Audio src={trackFile} startFrom={OFFSET > 0 ? f(OFFSET) : 0} /></Sequence>
      {ticks.slice(0, QUOTE.words.length).map((t, i) => <Sfx key={`t${i}`} at={t} n={i % 2 ? 'tick_002' : 'tick_001'} v={0.5} />)}
      {SHOTS.map((sh) => <Sfx key={`w${sh.from}`} at={sh.from - 4} n={sh.shot.kind === 'site' ? 'maximize_006' : 'forceField_000'} v={0.55} />)}
      <Sfx at={DROP} n="lowFrequency_explosion_000" v={1} />
      <Sfx at={DROP} n="impactPunch_heavy_004" v={0.7} />
    </>
  );
}

export function Trailer() {
  const fr = useCurrentFrame();
  const shot = SHOTS.find((x) => fr >= x.from && fr < x.to);
  let scene: ReactNode = null;
  if (fr < T.nobody) scene = <ColdOpen />;
  else if (fr < T.anAi) scene = <Lines parts={[LINES.nobody]} from={T.nobody} size={140} />;
  else if (fr < T.esc) scene = <Lines parts={LINES.anAi} from={T.anAi} />;
  else if (fr < T.build) scene = shot ? (shot.shot.kind === 'beef' ? <Beef i={shot.shot.i} from={shot.from} /> : <Site i={shot.shot.i} from={shot.from} to={shot.to} />) : <AbsoluteFill style={{ background: '#05060c' }} />;
  else if (fr < DROP) scene = <Build />;
  else if (fr < T.logo) scene = <Explode />;
  else if (fr < T.outro1) scene = <AbsoluteFill style={{ background: '#000', alignItems: 'center', justifyContent: 'center' }}><Logo /></AbsoluteFill>;
  else if (fr < T.outro2) scene = <Lines parts={LINES.outro1} from={T.outro1} />;
  else if (fr < T.end) scene = <Outro2 />;
  else scene = <EndCard />;
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      {scene}
      <Grain />
      <Sound />
    </AbsoluteFill>
  );
}

/** Light film grain, over everything. */
function Grain() {
  const fr = useCurrentFrame();
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', opacity: 0.05, mixBlendMode: 'overlay' }}>
      <svg width="100%" height="100%"><filter id={`gr${fr % 6}`}><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} seed={fr % 89} /></filter><rect width="100%" height="100%" filter={`url(#gr${fr % 6})`} /></svg>
    </AbsoluteFill>
  );
}

export const V5_DURATION = DURATION;
export const V5_BEATS = BEATS;
