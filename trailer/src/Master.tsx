import { AbsoluteFill, Sequence, useCurrentFrame } from 'remotion';
import { Grain, Leak, Vignette } from './kit';
import { C } from './theme';
import { at } from './cues';
import { Hook } from './scenes/Hook';
import { World } from './scenes/World';
import { Build } from './scenes/Build';
import { Money } from './scenes/Money';
import { End } from './scenes/End';
import { Sound } from './Sound';

/**
 * The 60 s master. Acts sit on the beat markers (cues.ts); scenes read the absolute frame, so a Sequence here only decides
 * which act is on screen. Texture (grain, vignette) is over everything; light leaks mark the act changes.
 */
export function Master() {
  const f = useCurrentFrame();
  const act = f < at('world') ? <Hook /> : f < at('build') ? <World /> : f < at('sell') ? <Build /> : f < at('silence') ? <Money /> : <End />;
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Sequence from={0}>{act}</Sequence>
      <Leak at={at('world')} />
      <Leak at={at('build')} />
      <Leak at={at('turn')} />
      <Vignette />
      <Grain />
      <Sound />
    </AbsoluteFill>
  );
}
