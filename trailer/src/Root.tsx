import { AbsoluteFill, Composition, Sequence } from 'remotion';
import { Master } from './Master';
import { FPS, at, type Cue } from './cues';
import { C } from './theme';
import { OPEN_FRAMES, Open } from './scenes/Open';
import { B, Rest } from './scenes/V4';
import { Audio, staticFile } from 'remotion';
import brand from './brand';
import { Grain, Vignette } from './kit';

/**
 * The trailer's compositions. Master: 60 s, 3840×2160, 60 fps. The 30 s cutdowns are windows of the master laid end to end
 * (each window plays the master's own frames, sound included), so they re-time with the master and its beat markers.
 */
type Window = [Cue, number]; // a cue, and how many seconds to play from it
const CUT30: Window[] = [['hookPost', 8], ['montage', 3], ['graph', 2.5], ['build', 6], ['trade', 4.5], ['silence', 6]];
const frames = (ws: Window[]) => ws.reduce((n, [, s]) => n + Math.round(s * FPS), 0);

/** Plays the chosen windows of the master one after another. */
function Windows({ ws, children }: { ws: Window[]; children: React.ReactNode }) {
  let t = 0;
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      {ws.map(([cue, s], i) => {
        const len = Math.round(s * FPS), from = t;
        t += len;
        return (
          <Sequence key={i} from={from} durationInFrames={len}>
            <Sequence from={-at(cue)}>{children}</Sequence>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}

function Cut30() { return <Windows ws={CUT30}><Master /></Windows>; }

/**
 * 9:16 for X: the 16:9 frame at full width in the middle, its own picture blown up and blurred behind it, so the
 * vertical frame stays full and the type stays as large as the phone allows.
 */
function Vertical30() {
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <AbsoluteFill style={{ transform: 'scale(1.9)', filter: 'blur(60px) brightness(0.45)' }}>
        <div style={{ position: 'absolute', width: 3840, height: 2160, left: (2160 - 3840) / 2, top: (3840 - 2160) / 2 }}><Cut30 /></div>
      </AbsoluteFill>
      <div style={{ position: 'absolute', width: 3840, height: 2160, left: 0, top: (3840 - 2160 * 0.5625) / 2, transform: 'scale(0.5625)', transformOrigin: '0 0', boxShadow: '0 0 0 2px rgba(255,190,107,0.25)' }}>
        <Cut30 />
      </div>
    </AbsoluteFill>
  );
}

/** v3: the new opening on its own, for the owner to judge the style before the rest is rebuilt. */
/** v4: the whole 60 s on the 120 BPM score: the opening, then Rest (scenes/V4.tsx). */
function Master4() {
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Sequence durationInFrames={B(20)}><Open /></Sequence>
      <Sequence from={0}><Rest url={brand.url} x={brand.x} /></Sequence>
      <Vignette strength={0.55} />
      <Grain opacity={0.05} />
      <Audio src={staticFile('music/score.wav')} />
    </AbsoluteFill>
  );
}

function Open10() { return <AbsoluteFill><Open /><Vignette strength={0.6} /><Grain opacity={0.06} /></AbsoluteFill>; }

export function Root() {
  return (
    <>
      <Composition id="Master4" component={Master4} durationInFrames={B(120)} fps={FPS} width={3840} height={2160} />
      <Composition id="Open10" component={Open10} durationInFrames={OPEN_FRAMES} fps={FPS} width={3840} height={2160} />
      <Composition id="Master" component={Master} durationInFrames={at('end')} fps={FPS} width={3840} height={2160} />
      <Composition id="Cut30" component={Cut30} durationInFrames={frames(CUT30)} fps={FPS} width={3840} height={2160} />
      <Composition id="Vertical30" component={Vertical30} durationInFrames={frames(CUT30)} fps={FPS} width={2160} height={3840} />
    </>
  );
}
