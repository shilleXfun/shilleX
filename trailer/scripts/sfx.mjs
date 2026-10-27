// Synthesises the trailer's sound-design layer as WAV files in public/sfx/: no stock samples, every sound made here.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const RATE = 48000;
const out = join(process.cwd(), 'public', 'sfx');
mkdirSync(out, { recursive: true });
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
function wav(name, seconds, fn) {
  const n = Math.round(seconds * RATE), data = Buffer.alloc(44 + n * 4);
  data.write('RIFF', 0); data.writeUInt32LE(36 + n * 4, 4); data.write('WAVE', 8); data.write('fmt ', 12);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(2, 22); data.writeUInt32LE(RATE, 24); data.writeUInt32LE(RATE * 4, 28);
  data.writeUInt16LE(4, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    const [l, r] = fn(i / RATE, i);
    data.writeInt16LE(Math.max(-1, Math.min(1, l)) * 32000, 44 + i * 4);
    data.writeInt16LE(Math.max(-1, Math.min(1, r ?? l)) * 32000, 46 + i * 4);
  }
  writeFileSync(join(out, `${name}.wav`), data);
}
const env = (t, a, d) => (t < a ? t / a : Math.exp(-(t - a) / d));
// A keyboard tick: a short click with a body.
for (let k = 0; k < 4; k++) { let lp = 0; wav(`tick${k}`, 0.06, (t) => { lp += 0.5 * (rnd() - lp); const body = Math.sin(2 * Math.PI * (1900 + k * 230) * t) * 0.35; return [(lp * 0.7 + body) * env(t, 0.0008, 0.011) * 0.5]; }); }
// A notification pop: a rising sine blip with a soft second partial.
wav('pop', 0.22, (t) => { const f = 880 + 900 * Math.min(1, t / 0.03); const s = Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * f * 2 * t); return [s * env(t, 0.003, 0.05) * 0.35]; });
// A whoosh: noise through a sweeping one-pole filter, panned across.
{ let lp = 0; wav('whoosh', 0.7, (t) => { const c = 0.02 + 0.5 * Math.sin(Math.PI * Math.min(1, t / 0.7)); lp += c * (rnd() - lp); const a = Math.sin(Math.PI * Math.min(1, t / 0.7)) ** 2 * 0.9; const pan = t / 0.7; return [lp * a * (1 - pan * 0.7), lp * a * (0.3 + pan * 0.7)]; }); }
// The sub hit for the title: a falling sine with a click on top.
wav('sub', 2.2, (t) => { const f = 55 * Math.exp(-t * 0.6) + 32; const ph = 2 * Math.PI * f * t; const click = t < 0.01 ? rnd() * (1 - t / 0.01) * 0.6 : 0; return [(Math.sin(ph) * env(t, 0.004, 0.55) * 0.95 + click)]; });
// The cash register: a bright two-tone bell over a short mechanical rattle.
{ let lp = 0; wav('ding', 1.4, (t) => { lp += 0.3 * (rnd() - lp); const rattle = t < 0.08 ? lp * (1 - t / 0.08) * 0.5 : 0; const bell = (Math.sin(2 * Math.PI * 1568 * t) + 0.6 * Math.sin(2 * Math.PI * 2093 * t) + 0.25 * Math.sin(2 * Math.PI * 3136 * t)) * env(t - 0.06 > 0 ? t - 0.06 : 0, 0.002, 0.35) * (t > 0.06 ? 1 : 0); return [rattle + bell * 0.3]; }); }
// A soft riser for act changes.
{ let lp = 0; wav('riser', 1.6, (t) => { lp += (0.01 + 0.2 * (t / 1.6)) * (rnd() - lp); const tone = Math.sin(2 * Math.PI * (200 + 600 * (t / 1.6) ** 2) * t) * 0.15; return [(lp * 0.6 + tone) * (t / 1.6) ** 2 * 0.8]; }); }
console.log('sfx written');
