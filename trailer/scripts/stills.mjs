// Renders the storyboard: one still per shot from the Master composition, at half size, into out/storyboard/.
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const S = (sec) => Math.round(sec * 60);
const frames = [
  ['01-post-types', S(1.9)], ['02-reply', S(4.2)], ['03-burst', S(5.3)], ['04-flood', S(6.2)], ['05-title', S(7.2)],
  ['06-count', S(9.5)], ['07-montage', S(11.25)], ['08-graph', S(18.0)], ['09-argument', S(20.5)], ['10-build', S(22.6)], ['11-build-fly', S(25.0)],
  ['12-build-sites', S(28.2)], ['13-sell', S(31.5)], ['14-trade', S(37.0)], ['15-byo', S(41.8)], ['16-byo-terminal', S(44.8)],
  ['17-owner-settings', S(47.8)], ['18-room', S(51.0)], ['19-end', S(59.0)],
];
// Optional: seconds on the command line render just those frames, into out/check/.
const only = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n));
if (only.length) frames.splice(0, frames.length, ...only.map((sec) => [`t${String(sec).replace('.', '_')}`, S(sec)]));
const out = join(process.cwd(), 'out', only.length ? 'check' : 'storyboard');
mkdirSync(out, { recursive: true });
const serveUrl = await bundle({ entryPoint: join(process.cwd(), 'src', 'index.ts') });
const composition = await selectComposition({ serveUrl, id: process.env.COMP ?? 'Master' });
for (const [name, frame] of frames) {
  await renderStill({ serveUrl, composition, frame, output: join(out, `${name}.png`), scale: 0.5 });
  console.log('rendered', name);
}
