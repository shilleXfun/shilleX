import { Audio, Sequence, staticFile } from 'remotion';
import beats from './beats.json';
import { at } from './cues';
import { live } from './kit';

/**
 * The sound: the licensed track (beats.json "track", in public/) when there is one, and the sound-design layer made by
 * scripts/sfx.mjs, every hit placed on a cue. Typing ticks follow the hook's characters; the burst pops; act changes whoosh;
 * the title and the logo land on a sub hit; the real wallet gets the register.
 */
const sfx = (n: string) => staticFile(`sfx/${n}.wav`);
function Hit({ at: from, name, volume = 1 }: { at: number; name: string; volume?: number }) {
  return <Sequence from={Math.max(0, from)} durationInFrames={150} layout="none"><Audio src={sfx(name)} volume={volume} /></Sequence>;
}

/** Ticks for text typed at `cps` from `start`, one every few characters, cycling the four tick samples. */
function Typing({ start, chars, cps }: { start: number; chars: number; cps: number }) {
  const every = 3, out = [];
  for (let c = 0; c < chars; c += every) out.push(<Hit key={c} at={start + Math.round((c / cps) * 60)} name={`tick${(c / every) % 4}`} volume={0.45} />);
  return <>{out}</>;
}

export function Sound() {
  const first = Math.min(132, live.thread?.root.body.length ?? 120), second = Math.min(110, live.thread?.replies[0]?.body.length ?? 100);
  return (
    <>
      {beats.track && <Audio src={staticFile(beats.track)} />}
      <Typing start={at('hookPost') + 8} chars={first} cps={64} />
      <Typing start={at('hookReply') + 6} chars={second} cps={72} />
      {Array.from({ length: 16 }, (_, i) => <Hit key={i} at={at('burst') + i * 3 + (i % 3)} name="pop" volume={0.5 - i * 0.02} />)}
      <Hit at={at('title') - 96} name="riser" volume={0.6} />
      <Hit at={at('title') - 34} name="whoosh" volume={0.7} />
      <Hit at={at('title')} name="sub" />
      {(['world', 'montage', 'graph', 'argument', 'build', 'sell', 'trade', 'turn'] as const).map((c) => <Hit key={c} at={at(c) - 6} name="whoosh" volume={0.55} />)}
      <Hit at={at('trade') + 46} name="ding" volume={0.8} />
      <Hit at={at('turn') + 160} name="pop" volume={0.4} />
      {/* Ends exactly where the six silent frames begin. */}
      <Hit at={at('silence') - 96} name="riser" volume={0.5} />
      <Hit at={at('logo')} name="sub" />
    </>
  );
}
