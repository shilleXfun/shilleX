// The v5 track, made here for this trailer: 120 BPM, 42 s, in D minor (Dm–Bb–F–C). Written to assets/track.wav.
// 0–4 s cold open (a low drone and a soft pulse), 4–8 s rising (pad, filtered arp), 8–20 s the groove (kick, clap, hats, sub
// bass, open arp), 20–28 s the build (a riser, an accelerating snare roll, the filter opening, the last half-beat empty),
// 28 s THE DROP (sub hit, saw chords, full drums, a lead hook), 31.5–38 s a lighter outro groove, 38 s on a clean ending.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SR = 48000, LEN = 42, N = SR * LEN, BEAT = 0.5, BAR = 2;
const L = new Float32Array(N), R = new Float32Array(N);
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
const add = (i, l, r = l) => { if (i >= 0 && i < N) { L[i] += l; R[i] += r; } };
const midi = (m) => 440 * 2 ** ((m - 69) / 12);
const CHORDS = [[62, 65, 69], [58, 62, 65], [65, 69, 72], [60, 64, 67]]; // Dm Bb F C
const chordAt = (t) => CHORDS[Math.floor(t / BAR) % 4];
const DROP = 28, BUILD = 20;
const sec = (t) => (t < 4 ? 'cold' : t < 8 ? 'rise' : t < BUILD ? 'groove' : t < DROP ? 'build' : t < 31.5 ? 'drop' : t < 38 ? 'outro' : 'end');
const duck = new Float32Array(N).fill(1);

function kick(t0, g = 1) {
  const s0 = Math.round(t0 * SR); let ph = 0;
  for (let i = 0; i < SR * 0.45; i++) { const t = i / SR, fq = 46 + 120 * Math.exp(-t * 30); ph += (2 * Math.PI * fq) / SR; add(s0 + i, (Math.sin(ph) * Math.exp(-t * 6) + (i < 100 ? rnd() * (1 - i / 100) * 0.4 : 0)) * g); }
  for (let i = 0; i < SR * 0.28; i++) { const k = s0 + i; if (k < N) duck[k] = Math.min(duck[k], 0.2 + 0.8 * (i / (SR * 0.28)) ** 1.4); }
}
function clap(t0, g = 0.6) {
  const s0 = Math.round(t0 * SR); let lp = 0;
  for (let i = 0; i < SR * 0.22; i++) { const t = i / SR, n = rnd(); lp += 0.4 * (n - lp); const bp = n - lp; const bursts = t < 0.03 ? (Math.floor(t / 0.009) % 2 ? 0.35 : 1) : 1; const v = (bp * 0.85 + Math.sin(2 * Math.PI * 200 * t) * Math.exp(-t * 35) * 0.3) * Math.exp(-t * 17) * bursts * g; add(s0 + i, v * 0.92, v); }
}
function hat(t0, g = 0.15, open = false) {
  const s0 = Math.round(t0 * SR); let prev = 0;
  for (let i = 0; i < SR * (open ? 0.2 : 0.04); i++) { const t = i / SR, n = rnd(), hp = n - prev; prev = n; add(s0 + i, hp * Math.exp(-t * (open ? 20 : 95)) * g * 0.85, hp * Math.exp(-t * (open ? 20 : 95)) * g); }
}
function riser(t0, t1, g = 0.6) {
  let lp = 0;
  for (let i = Math.round(t0 * SR); i < Math.round(t1 * SR); i++) { const k = (i / SR - t0) / (t1 - t0), n = rnd(); lp += (0.015 + 0.55 * k * k) * (n - lp); const tone = Math.sin(2 * Math.PI * (150 + 1100 * k * k) * (i / SR)) * 0.13; const v = (lp * 0.8 + tone) * k ** 2.3 * g; add(i, v * (1 - k * 0.35), v * (0.65 + k * 0.35)); }
}
function boom(t0, g = 1) {
  const s0 = Math.round(t0 * SR); let ph = 0, lp = 0;
  for (let i = 0; i < SR * 3; i++) { const t = i / SR, fq = 30 + 75 * Math.exp(-t * 6); ph += (2 * Math.PI * fq) / SR; lp += 0.09 * (rnd() - lp); add(s0 + i, (Math.sin(ph) * Math.exp(-t * 1.3) + lp * Math.exp(-t * 4.5)) * g); }
}
function tone(t0, dur, fq, g, shape = 'sine', pan = 0.5, decay = 4) {
  const s0 = Math.round(t0 * SR); let ph = 0, lp = 0;
  for (let i = 0; i < SR * dur; i++) {
    const t = i / SR; ph = (ph + fq / SR) % 1;
    const raw = shape === 'saw' ? ph * 2 - 1 : shape === 'square' ? (ph < 0.5 ? 1 : -1) : Math.sin(2 * Math.PI * ph);
    lp += 0.25 * (raw - lp);
    const env = Math.min(1, t * 300) * Math.exp(-t * decay) * Math.min(1, (dur - t) * 60);
    add(s0 + i, lp * env * g * (1 - pan) * 2, lp * env * g * pan * 2);
  }
}

// Drums.
for (let b = 0; b < LEN / BEAT; b++) {
  const t = b * BEAT, s = sec(t);
  if (s === 'groove' || s === 'drop' || s === 'outro') {
    kick(t, s === 'drop' ? 1.05 : 0.95);
    if (b % 2 === 1) clap(t, s === 'drop' ? 0.75 : 0.6);
    for (let q = 0; q < 4; q++) hat(t + q * BEAT / 4, q === 2 ? 0.2 : 0.11, s === 'drop' && q === 2);
  } else if (s === 'rise') { if (b % 2 === 0) kick(t, 0.55); hat(t + BEAT / 2, 0.1); }
  else if (s === 'build') { if (t < DROP - 2) kick(t, 0.8); }
  else if (s === 'cold') { if (b % 2 === 0) kick(t, 0.25); }
}
// The build's snare roll: quarter, then eighth, sixteenth, thirty-second notes, louder each bar; the last half-beat is empty.
for (let t = BUILD; t < DROP - 0.25; ) {
  const k = (t - BUILD) / (DROP - BUILD), step = k < 0.25 ? 0.5 : k < 0.5 ? 0.25 : k < 0.75 ? 0.125 : 0.0625;
  clap(t, 0.25 + 0.55 * k);
  t += step;
}
riser(BUILD + 2, DROP - 0.25, 0.75);
riser(5, 8, 0.4);
boom(DROP, 1.15);
boom(38, 0.6);

// Sub bass: eighths on the root, sidechained; in the build only on the downbeats until it drops out.
for (let e = 0; e < LEN / (BEAT / 2); e++) {
  const t = e * BEAT / 2, s = sec(t);
  if (!(s === 'groove' || s === 'drop' || s === 'outro' || (s === 'build' && t < DROP - 2 && e % 4 === 0))) continue;
  tone(t, BEAT * 0.48, midi(chordAt(t)[0] - 24), s === 'drop' ? 0.55 : 0.45, 'sine', 0.5, 2.5);
}
// Pad: soft detuned saws through the whole track except the empty half-beat; brighter in the drop.
{
  const ph = new Float64Array(6), lp = [0, 0];
  for (let i = 0; i < N; i++) {
    const t = i / SR, s = sec(t);
    if (t >= DROP - 0.25 && t < DROP) continue;
    const ch = chordAt(t);
    let sl = 0, sr = 0;
    ch.forEach((m, k) => { ph[k] = (ph[k] + midi(m - 12) * 1.004 / SR) % 1; ph[k + 3] = (ph[k + 3] + midi(m - 12) * 0.996 / SR) % 1; sl += ph[k] * 2 - 1; sr += ph[k + 3] * 2 - 1; });
    const vol = s === 'cold' ? 0.05 : s === 'rise' ? 0.06 + 0.04 * ((t - 4) / 4) : s === 'build' ? 0.06 + 0.06 * ((t - BUILD) / 8) : s === 'drop' ? 0.13 : s === 'end' ? 0.1 * Math.max(0, 1 - (t - 38) / 4) : 0.08;
    const cut = s === 'build' ? 0.01 + 0.12 * ((t - BUILD) / 8) ** 2 : s === 'drop' ? 0.14 : s === 'cold' ? 0.008 : 0.04;
    lp[0] += cut * (sl - lp[0]); lp[1] += cut * (sr - lp[1]);
    add(i, lp[0] * vol * duck[i], lp[1] * vol * duck[i]);
  }
}
// Arp: sixteenths, plucky, the filter opening with the energy.
for (let q = 0; q < LEN / (BEAT / 4); q++) {
  const t = q * BEAT / 4, s = sec(t);
  if (s === 'cold' || s === 'end' || (t >= DROP - 0.25 && t < DROP)) continue;
  const ch = chordAt(t), m = ch[[0, 1, 2, 1, 2, 0, 2, 1][q % 8]] + 12;
  const g = s === 'rise' ? 0.035 + 0.03 * ((t - 4) / 4) : s === 'build' ? 0.05 + 0.05 * ((t - BUILD) / 8) : s === 'drop' ? 0.09 : 0.065;
  tone(t, BEAT / 4 * 0.9, midi(m), g, 'square', q % 2 ? 0.35 : 0.65, 16);
}
// The drop's lead hook: a short four-note figure on each bar, an octave up, saw.
const HOOK = [[0, 74, 0.5], [0.5, 77, 0.25], [0.75, 76, 0.25], [1, 72, 0.75]];
for (let bar = DROP; bar < 31.5; bar += BAR) for (const [o, m, d] of HOOK) tone(bar + o, d * 0.95, midi(m), 0.11, 'saw', 0.5, 3);
// A clean ending: one last chord on 38 s, ringing out.
for (const m of CHORDS[0]) tone(38, 3.8, midi(m), 0.07, 'saw', 0.5, 0.9);

let peak = 0;
for (let i = 0; i < N; i++) { L[i] = Math.tanh(L[i] * 1.25); R[i] = Math.tanh(R[i] * 1.25); peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); }
const gain = 0.9 / peak, fade = SR * 1.2;
const buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) { const out = i > N - fade ? (N - i) / fade : 1; buf.writeInt16LE(Math.round(L[i] * gain * out * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(R[i] * gain * out * 32767), 46 + i * 4); }
mkdirSync(join(process.cwd(), 'assets'), { recursive: true });
writeFileSync(join(process.cwd(), 'assets', 'track.wav'), buf);
console.log('assets/track.wav written');
