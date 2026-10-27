import type { ReactNode } from 'react';
import { AbsoluteFill, Audio, Img, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { ThreeCanvas } from '@remotion/three';
import { asset } from '../kit';
import { C, display, mono } from '../theme';
import { DROP, DURATION, OFFSET, SHOTS, T, TRACK, beatFrames, f } from '../v5/timeline';
import { LINES, SITES } from '../v5/content';
import { useAssets } from './assets';
import { World } from './World';

/**
 * v6 "Inside Shillex": the 3D world (World.tsx) under the few lines a viewer must read, each on a dark blurred plate, never on
 * the moving picture itself. Landscape and portrait share the world; the type scales with the frame.
 */
const cl = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

function useS() {
  const { width, height } = useVideoConfig();
  const V = height > width;
  return { V, s: V ? width / 1080 : height / 1080 };
}

function Plate({ children, at, until, align = 'center' }: { children: ReactNode; at: number; until: number; align?: 'center' | 'left' }) {
  const fr = useCurrentFrame();
  const { V, s } = useS();
  if (fr < at || fr >= until) return null;
  const k = interpolate(fr, [at, at + 8], [0, 1], cl), out = interpolate(fr, [until - 6, until], [1, 0], cl);
  return (
    <AbsoluteFill style={{ alignItems: align === 'center' ? 'center' : 'flex-start', justifyContent: 'center', padding: V ? `0 ${56 * s}px` : `0 ${150 * s}px`, opacity: Math.min(k, out) }}>
      <div style={{ padding: `${40 * s}px ${56 * s}px`, borderRadius: 30 * s, background: 'rgba(4,5,12,.74)', backdropFilter: `blur(${22 * s}px)`, boxShadow: `0 0 0 ${2 * s}px rgba(255,190,107,.28), 0 ${30 * s}px ${90 * s}px rgba(0,0,0,.6)`, transform: `translateY(${(1 - k) * 20 * s}px) scale(${0.97 + 0.03 * k})` }}>
        {children}
      </div>
    </AbsoluteFill>
  );
}

const big = (s: number, V: boolean, size = 104) => ({ fontFamily: display, fontWeight: 800, fontSize: (V ? size * 0.8 : size) * s, letterSpacing: '-0.04em', lineHeight: 1.04, color: C.ink } as const);

function Copy() {
  const fr = useCurrentFrame();
  const { V, s } = useS();
  const beats = (a: number) => beatFrames(a, a + 400);
  const stack = (parts: string[], from: number) => parts.map((p, i) => {
    const at = i === 0 ? from : beats(from)[i] ?? from;
    return <div key={p} style={{ ...big(s, V), color: i === parts.length - 1 ? C.amber : C.ink, opacity: fr >= at ? 1 : 0 }}>{p}</div>;
  });
  const typeFrom = beatFrames(T.outro2, T.end)[2] ?? T.outro2 + 30;
  const n = Math.max(0, Math.min(LINES.join.length, Math.floor((fr - typeFrom) * 1.6)));
  const site = SHOTS.find((x) => x.shot.kind === 'site' && fr >= x.from + 10 && fr < x.to);
  return (
    <>
      <Plate at={T.nobody} until={T.anAi}><div style={big(s, V, 128)}>{LINES.nobody}</div></Plate>
      <Plate at={T.anAi} until={T.esc}>{stack(LINES.anAi, T.anAi)}</Plate>
      {site && (() => {
        const st = SITES[site.shot.i]!;
        return (
          <div style={{ position: 'absolute', left: V ? 56 * s : 110 * s, right: V ? 56 * s : undefined, bottom: V ? 300 * s : 80 * s, display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 20 * s, rowGap: 4 * s, padding: `${16 * s}px ${30 * s}px ${16 * s}px ${16 * s}px`, borderRadius: 999, background: 'rgba(4,5,12,.86)', backdropFilter: `blur(${16 * s}px)`, boxShadow: `0 0 0 ${2 * s}px rgba(255,190,107,.5)` }}>
            <div style={{ width: 70 * s, height: 70 * s, borderRadius: '50%', overflow: 'hidden', boxShadow: `0 0 0 ${3 * s}px ${C.amber}` }}><Img src={asset(st.author.avatar)} style={{ width: '100%', height: '100%', imageRendering: 'pixelated' }} /></div>
            <span style={{ fontFamily: display, fontWeight: 800, fontSize: 52 * s, color: C.ink, whiteSpace: 'nowrap' }}>{st.title}</span>
            <span style={{ fontFamily: mono, fontWeight: 500, fontSize: 48 * s, color: C.amber, whiteSpace: 'nowrap' }}>built by @{st.author.username}</span>
          </div>
        );
      })()}
      <Plate at={T.outro1} until={T.outro2} align="left">{stack(LINES.outro1, T.outro1)}</Plate>
      <Plate at={T.outro2} until={T.end} align="left">
        <div style={big(s, V, 96)}>{LINES.outro2}</div>
        <div style={{ marginTop: 30 * s, fontFamily: mono, fontWeight: 500, fontSize: (V ? 46 : 52) * s, lineHeight: 1.3, color: C.ink, maxWidth: V ? 900 * s : 1450 * s, minHeight: 52 * s * 2.6, opacity: fr >= typeFrom ? 1 : 0 }}>
          <span style={{ color: C.amber }}>&gt; </span>{LINES.join.slice(0, n)}
        </div>
      </Plate>
    </>
  );
}

/** The logo: a hard cut to it on clean black, no effects (owner). */
function LogoCut() {
  const fr = useCurrentFrame();
  const { s } = useS();
  if (fr < T.logo || fr >= T.outro1) return null;
  return (
    <AbsoluteFill style={{ background: '#04050b', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ fontFamily: display, fontWeight: 800, fontSize: 230 * s, letterSpacing: '-0.06em', lineHeight: 1, color: C.ink }}>shille<span style={{ color: C.amber }}>X</span></div>
    </AbsoluteFill>
  );
}

function EndCard() {
  const fr = useCurrentFrame();
  const { V, s } = useS();
  if (fr < T.end) return null;
  return (
    <AbsoluteFill style={{ background: '#04050b', alignItems: 'center', justifyContent: 'center', gap: 46 * s }}>
      <div style={{ fontFamily: display, fontWeight: 800, fontSize: 170 * s, letterSpacing: '-0.06em', lineHeight: 1, color: C.ink }}>shille<span style={{ color: C.amber }}>X</span></div>
      <div style={{ display: 'flex', flexDirection: V ? 'column' : 'row', alignItems: 'center', gap: V ? 16 * s : 70 * s, fontFamily: mono, fontWeight: 700, fontSize: 60 * s }}>
        <span style={{ color: C.amber }}>shillex.fun</span><span style={{ color: C.ink }}>@shillexfun</span>
      </div>
    </AbsoluteFill>
  );
}

const sfx = (n: string) => staticFile(`sfx/k/${n}.ogg`);
const Sfx = ({ at, n, v = 1 }: { at: number; n: string; v?: number }) => <Sequence from={Math.max(0, at)} durationInFrames={150} layout="none"><Audio src={sfx(n)} volume={v} /></Sequence>;

function Sound() {
  const trackFile = staticFile(`v5/${TRACK.track.split(/[\\/]/).pop()}`);
  return (
    <>
      <Sequence from={OFFSET < 0 ? f(-OFFSET) : 0} layout="none"><Audio src={trackFile} startFrom={OFFSET > 0 ? f(OFFSET) : 0} /></Sequence>
      <Sfx at={T.nobody - 6} n="forceField_002" v={0.6} />
      {SHOTS.map((sh) => <Sfx key={sh.from} at={sh.from - 6} n={sh.shot.kind === 'site' ? 'maximize_006' : 'forceField_000'} v={0.5} />)}
      <Sfx at={T.build} n="spaceEngineLow_001" v={0.35} />
      <Sfx at={DROP} n="lowFrequency_explosion_000" v={1} />
      <Sfx at={DROP} n="impactPunch_heavy_004" v={0.7} />
      <Sfx at={T.logo} n="impactMetal_heavy_001" v={0.45} />
    </>
  );
}

export function Inside() {
  const { width, height } = useVideoConfig();
  const a = useAssets(height > width);
  return (
    <AbsoluteFill style={{ background: '#04050b' }}>
      {a && (
        <ThreeCanvas width={width} height={height} gl={{ preserveDrawingBuffer: true, antialias: false, powerPreference: 'high-performance' }} camera={{ fov: 50, position: [0, 0, 4.6] }}>
          <World a={a} />
        </ThreeCanvas>
      )}
      <Copy />
      <LogoCut />
      <EndCard />
      <Sound />
    </AbsoluteFill>
  );
}
export const V6_DURATION = DURATION;
