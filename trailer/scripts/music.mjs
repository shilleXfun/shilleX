// Writes the trailer's score, public/music/score.wav: 60 s at 120 BPM (a beat = 30 frames at 60 fps, a bar = 2 s), synthesised
// here so every cut can sit exactly on the grid. Am–F–C–G. Intro (0–8 s): pad, a filtered arp, a riser into the drop. Drop at
// 8 s: kick, clap, hats, sidechained sub bass, open arp. Breakdown 40–46 s, riser, full again 46–52 s, six silent frames at 52 s,
// the final hit and a long tail to 60 s.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SR = 48000, LEN = 60, N = SR * LEN, BPM = 120, BEAT = 60 / BPM;
const L = new Float32Array(N), R = new Float32Array(N);
let seed = 11;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
const add = (i, l, r = l) => { if (i >= 0 && i < N) { L[i] += l; R[i] += r; } };
const midi = (m) => 440 * 2 ** ((m - 69) / 12);
// Am, F, C, G (root notes for the bass, triads for the pad and arp), one chord a bar.
const CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
const chordAt = (t) => CHORDS[Math.floor(t / (BEAT * 4)) % 4];

const SECTIONS = { intro: [0, 8], drop: [8, 40], breakdown: [40, 46], drop2: [46, 52], silence: [52, 52.1], tail: [52.1, 60] };
const inS = (t, s) => t >= SECTIONS[s][0] && t < SECTIONS[s][1];
const beatFull = (t) => inS(t, 'drop') || inS(t, 'drop2');

// Sidechain: the kick ducks the bass and the pad.
const duck = new Float32Array(N).fill(1);

function kick(t0, gain = 1) {
  const s0 = Math.round(t0 * SR);
  let ph = 0;
  for (let i = 0; i < SR * 0.45; i++) {
    const t = i / SR, f = 48 + 110 * Math.exp(-t * 28);
    ph += (2 * Math.PI * f) / SR;
    const env = Math.exp(-t * 6.5), click = i < 120 ? rnd() * (1 - i / 120) * 0.35 : 0;
    add(s0 + i, (Math.sin(ph) * env * 0.95 + click) * gain);
  }
  for (let i = 0; i < SR * 0.3; i++) { const k = s0 + i; if (k < N) duck[k] = Math.min(duck[k], 0.25 + 0.75 * Math.min(1, i / (SR * 0.3)) ** 1.5); }
}
function clap(t0, gain = 0.6) {
  const s0 = Math.round(t0 * SR);
  let bp = 0, lp = 0;
  for (let i = 0; i < SR * 0.25; i++) {
    const t = i / SR, n = rnd();
    lp += 0.35 * (n - lp); bp = n - lp; // a crude band
    const bursts = t < 0.03 ? (Math.floor(t / 0.01) % 2 === 0 ? 1 : 0.4) : 1;
    const env = Math.exp(-t * 18) * bursts, tone = Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t * 30) * 0.3;
    add(s0 + i, (bp * 0.8 + tone) * env * gain * 0.9, (bp * 0.8 + tone) * env * gain);
  }
}
function hat(t0, gain = 0.18, open = false) {
  const s0 = Math.round(t0 * SR);
  let prev = 0;
  for (let i = 0; i < SR * (open ? 0.18 : 0.045); i++) {
    const t = i / SR, n = rnd(), hp = n - prev; prev = n;
    const env = Math.exp(-t * (open ? 22 : 90));
    add(s0 + i, hp * env * gain * 0.8, hp * env * gain);
  }
}
function riser(t0, t1, gain = 0.5) {
  let lp = 0;
  for (let i = Math.round(t0 * SR); i < Math.round(t1 * SR); i++) {
    const k = (i / SR - t0) / (t1 - t0), n = rnd();
    lp += (0.02 + 0.5 * k * k) * (n - lp);
    const tone = Math.sin(2 * Math.PI * (180 + 900 * k * k) * (i / SR)) * 0.12;
    const v = (lp * 0.8 + tone) * k ** 2.2 * gain;
    add(i, v * (1 - k * 0.3), v * (0.7 + k * 0.3));
  }
}
function impact(t0, gain = 1) {
  const s0 = Math.round(t0 * SR);
  let ph = 0, lp = 0;
  for (let i = 0; i < SR * 2.6; i++) {
    const t = i / SR, f = 32 + 70 * Math.exp(-t * 7);
    ph += (2 * Math.PI * f) / SR; lp += 0.08 * (rnd() - lp);
    add(s0 + i, (Math.sin(ph) * Math.exp(-t * 1.6) + lp * Math.exp(-t * 5) * 0.9) * gain);
  }
}

// Drums on the grid.
for (let b = 0; b < LEN / BEAT; b++) {
  const t = b * BEAT;
  if (beatFull(t)) {
    kick(t);
    if (b % 2 === 1) clap(t);
    for (let s = 0; s < 4; s++) hat(t + (s * BEAT) / 4, s === 2 ? 0.22 : 0.12, s === 2 && b % 4 === 3);
  } else if (inS(t, 'intro') && t >= 4) hat(t, 0.1);
  else if (inS(t, 'breakdown') && b % 2 === 0) hat(t + BEAT / 2, 0.08);
}
// Drop fills: a snare roll into each drop.
for (const end of [8, 46]) for (let i = 0; i < 16; i++) clap(end - 1 + i / 16, 0.25 + 0.5 * (i / 16));
riser(5, 8, 0.55); riser(43, 46, 0.6); riser(49.5, 52, 0.7);
impact(8, 0.9); impact(46, 0.7); impact(52.1, 1.1);

// Sub bass: eighth notes on the chord root, an octave down, sidechained.
for (let e = 0; e < LEN / (BEAT / 2); e++) {
  const t = e * (BEAT / 2);
  if (!beatFull(t)) continue;
  const f = midi(chordAt(t)[0] - 12), s0 = Math.round(t * SR);
  for (let i = 0; i < SR * BEAT * 0.48; i++) {
    const tt = i / SR, env = Math.min(1, tt * 200) * Math.exp(-tt * 3);
    const v = (Math.sin(2 * Math.PI * f * tt) + 0.25 * Math.sin(4 * Math.PI * f * tt)) * env * 0.42;
    add(s0 + i, v);
  }
}
// Pad: detuned saws through a slow low-pass, whole song except the silence.
{
  const lpL = [0, 0], st = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    if (inS(t, 'silence')) continue;
    const ch = chordAt(t), vol = inS(t, 'intro') ? 0.09 + 0.05 * (t / 8) : inS(t, 'breakdown') ? 0.13 : inS(t, 'tail') ? 0.12 * Math.max(0, 1 - (t - 52.1) / 8) : 0.07;
    let sL = 0, sR = 0;
    ch.forEach((m, k) => {
      const f = midi(m);
      st[k] = (st[k] + f * 1.003 / SR) % 1; st[k + 3] = (st[k + 3] + f * 0.997 / SR) % 1;
      sL += st[k] * 2 - 1; sR += st[k + 3] * 2 - 1;
    });
    const cut = 0.02 + 0.03 * (0.5 + 0.5 * Math.sin(t * 0.7));
    lpL[0] += cut * (sL - lpL[0]); lpL[1] += cut * (sR - lpL[1]);
    add(i, lpL[0] * vol * duck[i], lpL[1] * vol * duck[i]);
  }
}
// Arp: sixteenths over the chord, a plucky square; filtered shut in the intro, open in the drops.
for (let s = 0; s < LEN / (BEAT / 4); s++) {
  const t = s * (BEAT / 4);
  if (inS(t, 'silence') || t >= 52.1) continue;
  const ch = chordAt(t), m = ch[[0, 1, 2, 1, 2, 0, 1, 2][s % 8]] + 12, f = midi(m), s0 = Math.round(t * SR);
  const open = beatFull(t) ? 0.35 : inS(t, 'intro') ? 0.04 + 0.12 * (t / 8) : 0.12;
  let lp = 0;
  for (let i = 0; i < SR * BEAT * 0.24; i++) {
    const tt = i / SR, sq = Math.sin(2 * Math.PI * f * tt) > 0 ? 1 : -1;
    lp += open * (sq - lp);
    const v = lp * Math.exp(-tt * 14) * 0.09, pan = s % 2 ? 0.7 : 1;
    add(s0 + i, v * pan, v * (1.7 - pan));
  }
}
// Master: soft clip and normalise; the six frames at 52 s stay silent.
let peak = 0;
for (let i = 0; i < N; i++) { L[i] = Math.tanh(L[i] * 1.3); R[i] = Math.tanh(R[i] * 1.3); peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); }
const g = 0.92 / peak;
const sil0 = Math.round(52 * SR), sil1 = Math.round(52.1 * SR);
const buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  const mute = i >= sil0 && i < sil1 ? 0 : 1;
  buf.writeInt16LE(Math.round(L[i] * g * mute * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(R[i] * g * mute * 32767), 46 + i * 4);
}
mkdirSync(join(process.cwd(), 'public', 'music'), { recursive: true });
writeFileSync(join(process.cwd(), 'public', 'music', 'score.wav'), buf);
console.log('score.wav written, peak', peak.toFixed(2));
