import { AbsoluteFill, Html5Audio, Sequence, random, staticFile, useCurrentFrame } from 'remotion';
import { Sparks, Vignette, Whip } from './fx';
import HITS from './hits.json';
import { AT, shake } from './lib';
import { Crowd, Intro, Talk, Build } from './scenes-a';
import { Bring, End, Market, Money, Wall } from './scenes-b';

// [frame, peak, decay]: white flashes on the cuts that matter; the drop (840) is the big one.
const FLASHES: [number, number, number][] = [
  [AT.hit, 0.24, 6], [AT.talk, 0.14, 5], [AT.build, 0.18, 5], [AT.money, 0.16, 5], [AT.rules, 0.12, 5],
  [AT.market, 0.95, 6], [AT.bring, 0.18, 5], [AT.wall, 0.14, 5], [AT.end, 0.6, 7],
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

/** How hard the last drum hits in `list` still ring at frame f (written by scripts/score-v7.mjs). */
const ring = (list: number[], f: number, decay: number) => list.reduce((a, t) => (f >= t && f - t < 24 ? a + Math.exp(-(f - t) / decay) : a), 0);

/** v7, landscape 1920×1080 at 60 fps, on pure black: what Shillex is and what its agents do, each shown with the real site. */
export function V7() {
  const f = useCurrentFrame();
  const a = shake(f, AT.hit, 9, 8), b = shake(f, AT.market, 14, 10), c = shake(f, AT.end, 10, 9);
  // The picture moves with the music: a push on every kick, a jolt on every clap, and a slow sway underneath.
  const drop = f >= AT.market && f < AT.end ? 1.6 : 1;
  const kick = ring(HITS.kick, f, 5) * drop;
  const clap = ring(HITS.snare, f, 4) * drop;
  const jx = (random(`cx${f}`) * 2 - 1) * clap * 5, jy = (random(`cy${f}`) * 2 - 1) * clap * 5;
  const zoom = 1 + kick * 0.014;
  const sway = Math.sin(f / 70) * 0.35;
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <AbsoluteFill style={{ transform: `translate(${a.x + b.x + c.x + jx}px, ${a.y + b.y + c.y + jy}px) scale(${zoom}) rotate(${sway}deg)`, filter: kick > 0.05 ? `brightness(${1 + kick * 0.12})` : undefined }}>
        <Sequence from={AT.intro} durationInFrames={96}><Intro /></Sequence>
        <Sequence from={AT.crowd} durationInFrames={100}><Crowd /></Sequence>
        <Sequence from={AT.talk} durationInFrames={250}><Talk /></Sequence>
        <Sequence from={AT.build} durationInFrames={190}><Build /></Sequence>
        <Sequence from={AT.money} durationInFrames={250}><Money /></Sequence>
        <Sequence from={AT.market} durationInFrames={190}><Market /></Sequence>
        <Sequence from={AT.bring} durationInFrames={190}><Bring /></Sequence>
        <Sequence from={AT.wall} durationInFrames={130}><Wall /></Sequence>
        <Sequence from={AT.end} durationInFrames={180}><End /></Sequence>
        <Sparks at={AT.hit} x={960} y={560} count={40} power={0.9} seed="hit" />
        <Sparks at={AT.market} x={960} y={150} count={60} power={1.2} seed="drop" />
        <Sparks at={AT.end} x={960} y={500} count={56} power={1.1} seed="end" />
      </AbsoluteFill>
      <Whip at={AT.talk} />
      <Whip at={AT.build} dir={-1} />
      <Whip at={AT.money} />
      <Whip at={AT.bring} dir={-1} />
      <Whip at={AT.wall} />
      <Flash />
      <Vignette strength={0.5} />
      <Html5Audio src={staticFile('v7/score.wav')} />
    </AbsoluteFill>
  );
}
