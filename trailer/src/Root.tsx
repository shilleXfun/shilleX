import { Composition } from 'remotion';
import { Master } from './Master';
import { FPS, at } from './cues';

/** The trailer's compositions. Master: 60 s, 3840×2160, 60 fps. The 30 s cutdowns are added once the master is approved. */
export function Root() {
  return <Composition id="Master" component={Master} durationInFrames={at('end')} fps={FPS} width={3840} height={2160} />;
}
