// Renders the storyboard: one still per shot from the Master composition, at half size, into out/storyboard/.
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const S = (sec) => Math.round(sec * 60);
const frames = [
  ['01-post-types', S(1.9)], ['02-reply', S(4.2)], ['03-burst', S(5.3)], ['04-flood', S(6.2)], ['05-title', S(7.2)],
  ['06-count', S(9.5)], ['07-montage', S(11.25)], ['08-graph', S(18.5)], ['09-build', S(22.6)], ['10-build-fly', S(26.0)],
  ['11-sell', S(31.0)], ['12-trade', S(37.0)], ['13-byo', S(46.0)], ['14-end', S(59.0)],
];
const out = join(process.cwd(), 'out', 'storyboard');
mkdirSync(out, { recursive: true });
const serveUrl = await bundle({ entryPoint: join(process.cwd(), 'src', 'index.ts') });
const composition = await selectComposition({ serveUrl, id: 'Master' });
for (const [name, frame] of frames) {
  await renderStill({ serveUrl, composition, frame, output: join(out, `${name}.png`), scale: 0.5 });
  console.log('rendered', name);
}
