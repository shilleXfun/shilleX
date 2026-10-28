import { AbsoluteFill, Html5Audio, random, staticFile, useCurrentFrame } from 'remotion';
import { Sparks, Vignette, Whip } from '../v7/fx';
import { shake } from '../v7/lib';
import { fromCam, project } from './cam';
import { Copy } from './copy';
import HITS from './hits.json';
import { T, camAt } from './path';
import { Feed, Market, Money, NewAgent, Ring, Sphere, SphereLines, Terminal, Thread, ThreadLines } from './stations';
import { Stage } from './world';

// [frame, peak, decay]: light on the moments that matter; the drop is the big one.
const FLASHES: [number, number, number][] = [
  [T.hit, 0.24, 6], [T.feed, 0.08, 5], [T.thread, 0.08, 5], [T.ring, 0.12, 5], [T.money, 0.1, 5], [T.rules, 0.08, 5],
  [T.drop, 0.95, 6], [T.bring, 0.1, 5], [T.reveal, 0.12, 6], [T.logo, 0.35, 6], [T.word, 0.55, 7],
];

function Flash() {
  const f = useCurrentFrame();
  const o = FLASHES.reduce((a, [t, peak, decay]) => {
    if (f >= t - 2 && f < t) return Math.max(a, peak * ((f - (t - 2)) / 2) * 0.6);
    if (f >= t) return Math.max(a, peak * Math.exp(-(f - t) / decay));
    return a;
  }, 0);
  if (o < 0.002) return null;
  return <AbsoluteFill style={{ background: 'radial-gradient(circle at 55% 55%, #ffffff, #fff1dc 60%, #ffcf8f)', opacity: o, mixBlendMode: 'screen' }} />;
}

/** How far the world slid on screen since the last frame (at the focus distance): the motion blur follows it. */
function motion(f: number): [number, number] {
  if (f < 1) return [0, 0];
  const c1 = camAt(f), c0 = camAt(f - 1);
  let sx = 0, sy = 0, n = 0;
  for (const [x, y] of [[0, 0], [520, 0], [-520, 0], [0, 300], [0, -300]] as const) {
    const w = fromCam([x, y, -c1.focus], c1);
    const a = project(w, c0), b = project(w, c1);
    if (a.d < 80) continue;
    sx += Math.abs(b.x - a.x); sy += Math.abs(b.y - a.y); n++;
  }
  return n ? [sx / n, sy / n] : [0, 0];
}

const ring = (list: number[], f: number, decay: number) => list.reduce((a, t) => (f >= t && f - t < 24 ? a + Math.exp(-(f - t) / decay) : a), 0);

/** v8 "Inside Shillex", 1920×1080 at 60 fps on pure black: one camera flight through the world of the hundred agents. */
export function V8() {
  const f = useCurrentFrame();
  const c = camAt(f);
  const [mx, my] = motion(f);
  const bx = Math.min(30, mx * 0.42), by = Math.min(30, my * 0.42);
  const a = shake(f, T.hit, 9, 8), b = shake(f, T.drop, 16, 10), w = shake(f, T.word, 10, 9);
  const loud = f >= T.drop && f < T.reveal ? 1.6 : 1;
  const kick = ring(HITS.kick, f, 5) * loud, clap = ring(HITS.snare, f, 4) * loud;
  const jx = (random(`cx${f}`) * 2 - 1) * clap * 5, jy = (random(`cy${f}`) * 2 - 1) * clap * 5;
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <svg width={0} height={0} style={{ position: 'absolute' }}>
        <filter id="mb8" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation={`${bx.toFixed(2)} ${by.toFixed(2)}`} /></filter>
      </svg>
      <AbsoluteFill style={{ transform: `translate(${a.x + b.x + w.x + jx}px, ${a.y + b.y + w.y + jy}px) scale(${1 + kick * 0.014}) rotate(${Math.sin(f / 70) * 0.3}deg)`, filter: kick > 0.05 ? `brightness(${1 + kick * 0.1})` : undefined }}>
        <AbsoluteFill style={{ filter: bx + by > 0.8 ? 'url(#mb8)' : undefined }}>
          <Stage c={c}>
            <Sphere c={c} />
            <Feed c={c} />
            <Thread c={c} />
            <Ring c={c} />
            <Money c={c} />
            <Market c={c} />
            <Terminal c={c} />
            <NewAgent c={c} />
          </Stage>
          <SphereLines c={c} />
          <ThreadLines c={c} />
        </AbsoluteFill>
        <Sparks at={T.hit} x={960} y={560} count={40} power={0.9} seed="hit" />
        <Sparks at={T.drop} x={960} y={160} count={64} power={1.2} seed="drop" />
        <Sparks at={T.logo} x={960} y={500} count={50} power={1} seed="x" />
        <Sparks at={T.word} x={960} y={500} count={60} power={1.2} seed="word" />
        <Copy />
      </AbsoluteFill>
      <Whip at={265} />
      <Whip at={435} />
      <Whip at={825} dir={-1} />
      <Whip at={1265} />
      <Flash />
      <Vignette strength={0.45} />
      {f >= 1764 && <AbsoluteFill style={{ background: '#000', opacity: Math.min(1, (f - 1764) / 32) }} />}
      <Html5Audio src={staticFile('v8/score.wav')} />
    </AbsoluteFill>
  );
}
