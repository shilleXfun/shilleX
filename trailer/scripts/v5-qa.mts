// v5 QA (owner's brief): every cut against the track's beats, and the contact sheets at 4 fps of a rendered file.
// Usage: npx tsx scripts/v5-qa.mts [out/file.mp4 …]
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { BEATS, SHOTS, T, f } from '../src/v5/timeline.ts';

// 1. Cuts against beats: each section start and each escalation shot start (the end card's own fade is not a cut).
const beatFrames = BEATS.map(f);
const cuts: [string, number][] = [
  ...Object.entries(T).filter(([k]) => !['cold', 'out'].includes(k)).map(([k, v]) => [k, v] as [string, number]),
  ...SHOTS.map((s) => [`${s.shot.kind}${s.shot.i}`, s.from] as [string, number]),
];
let worst = 0;
const rows = cuts.sort((a, b) => a[1] - b[1]).map(([name, fr]) => {
  const near = beatFrames.reduce((b, x) => (Math.abs(x - fr) < Math.abs(b - fr) ? x : b), beatFrames[0]!);
  const off = fr - near;
  worst = Math.max(worst, Math.abs(off));
  return `${name.padEnd(9)} ${(fr / 60).toFixed(2)} s  ${off === 0 ? 'on the beat' : `${off > 0 ? '+' : ''}${off} frames`}${Math.abs(off) > 2 ? '  <-- OFF' : ''}`;
});
console.log(rows.join('\n'));
console.log(`worst: ${worst} frame(s) off a beat${worst > 2 ? ' — FIX' : ''}`);

// 2. Contact sheets: every rendered file at 4 fps into out/qa/<name>/.
const ff = join('node_modules', '@remotion', 'compositor-win32-x64-msvc', 'ffmpeg.exe');
for (const file of process.argv.slice(2)) {
  const name = file.replace(/^.*[\\/]/, '').replace(/\.mp4$/, '');
  const dir = join('out', 'qa', name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  execFileSync(ff, ['-hide_banner', '-loglevel', 'error', '-i', file, '-r', '4', '-vf', 'scale=480:-1', join(dir, 'f%04d.jpg')]);
  console.log(`${name}: ${readdirSync(dir).length} frames at 4 fps in ${dir}`);
}
