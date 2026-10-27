// v7's own score, written in code for this edit: a dark phonk beat (808s, a tuned cowbell riff, hard drums), 120 BPM, 25 s, A minor. Synth engine from the narrativepad trailer's score.mjs.
// One beat = 30 frames at 60 fps; every hit below is placed on a picture frame from src/v7 (f(frame)).
//   node scripts/score-v7.mjs  ->  public/v7/score.wav
import { mkdirSync, writeFileSync } from "node:fs";

const SR = 48000;
const DUR = 25;
const N = SR * DUR;
const bus = () => [new Float32Array(N), new Float32Array(N)];
const DRY = bus(); // drums, hits, fx
const MUS = bus(); // pads, bass, arp: ducked by the kick
const REV = bus(); // reverb send
const DLY = bus(); // delay send

let seed = 1234567;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
const f = (frame) => frame / 60; // video frame -> seconds

/** Writes fn(i, t) into a bus from t0 for len seconds, with equal-power pan and sends. */
function add(target, t0, len, fn, { pan = 0, gain = 1, rev = 0, dly = 0 } = {}) {
  const s0 = Math.round(t0 * SR);
  const n = Math.round(len * SR);
  const gl = Math.cos(((pan + 1) * Math.PI) / 4) * gain;
  const gr = Math.sin(((pan + 1) * Math.PI) / 4) * gain;
  for (let i = 0; i < n; i++) {
    const k = s0 + i;
    if (k < 0) continue;
    if (k >= N) break;
    const v = fn(i, i / SR);
    target[0][k] += v * gl;
    target[1][k] += v * gr;
    if (rev) (REV[0][k] += v * gl * rev), (REV[1][k] += v * gr * rev);
    if (dly) (DLY[0][k] += v * gl * dly), (DLY[1][k] += v * gr * dly);
  }
}

class SVF {
  ic1 = 0;
  ic2 = 0;
  run(x, fc, q, mode) {
    const g = Math.tan((Math.PI * Math.min(Math.max(fc, 20), SR * 0.45)) / SR);
    const k = 1 / q;
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;
    const v3 = x - this.ic2;
    const v1 = a1 * this.ic1 + a2 * v3;
    const v2 = this.ic2 + a2 * this.ic1 + a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    return mode === "lp" ? v2 : mode === "bp" ? v1 : x - k * v1 - v2;
  }
}

const blep = (t, dt) => {
  if (t < dt) return (t /= dt), t + t - t * t - 1;
  if (t > 1 - dt) return (t = (t - 1) / dt), t * t + t + t + 1;
  return 0;
};
class Saw {
  p = (rnd() + 1) / 2;
  next(freq) {
    const dt = freq / SR;
    const v = 2 * this.p - 1 - blep(this.p, dt);
    this.p += dt;
    if (this.p >= 1) this.p -= 1;
    return v;
  }
}

// ---- instruments ------------------------------------------------------------------------------
function kick(t0, vel = 1) {
  let ph = 0;
  add(DRY, t0, 0.55, (i, t) => {
    ph += (2 * Math.PI * (44 + 120 * Math.exp(-t * 32))) / SR;
    const click = t < 0.005 ? rnd() * (1 - t / 0.005) * 0.45 : 0;
    return (Math.sin(ph) * Math.exp(-t * 6.5) + click) * vel;
  });
}
function clap(t0, vel = 1) {
  const bp = new SVF();
  add(DRY, t0, 0.35, (i, t) => {
    const bursts = [0, 0.011, 0.023].reduce((a, s) => a + (t >= s ? Math.exp(-(t - s) / 0.006) : 0), 0);
    const env = Math.min(1, bursts) * 0.8 + (t > 0.023 ? Math.exp(-(t - 0.023) * 16) * 0.55 : 0);
    return bp.run(rnd(), 1450, 1.1, "bp") * env * 1.6 * vel;
  }, { rev: 0.35, pan: 0.05 });
}
function hat(t0, open = false, vel = 1, pan = 0.2) {
  const hp = new SVF();
  add(DRY, t0, open ? 0.3 : 0.06, (i, t) => hp.run(rnd(), 8200, 0.8, "hp") * Math.exp(-t * (open ? 11 : 70)) * 0.35 * vel, { pan });
}
function snare(t0, vel = 1) {
  const bp = new SVF();
  let ph = 0;
  add(DRY, t0, 0.2, (i, t) => {
    ph += (2 * Math.PI * 190) / SR;
    return (bp.run(rnd(), 2300, 0.7, "bp") * Math.exp(-t * 24) * 1.2 + Math.sin(ph) * Math.exp(-t * 32) * 0.35) * vel;
  }, { rev: 0.25 });
}
function boom(t0, { from = 120, to = 32, k = 7, decay = 1.6, len = 2.6, vel = 1, noise = 0.6 } = {}) {
  let ph = 0;
  const lp = new SVF();
  add(DRY, t0, len, (i, t) => {
    ph += (2 * Math.PI * (to + (from - to) * Math.exp(-t * k))) / SR;
    const sub = Math.sin(ph) * Math.exp(-t * decay);
    const n = lp.run(rnd(), 900 + 5000 * Math.exp(-t * 9), 0.7, "lp") * Math.exp(-t * 5) * noise;
    return (sub + n) * vel;
  }, { rev: 0.4 });
}
function metal(t0, vel = 0.25) {
  const partials = [182, 411, 733, 1129, 1687, 2390];
  add(DRY, t0, 2.2, (i, t) => partials.reduce((a, p, j) => a + Math.sin(2 * Math.PI * p * t + j) * Math.exp(-t * (3 + j)), 0) * vel / 3, { rev: 0.7 });
}
function whoosh(t0, len, { up = true, vel = 1, pan = [-0.7, 0.7] } = {}) {
  const bp = new SVF();
  add(DRY, t0, len, (i, t) => {
    const u = t / len;
    const fc = up ? 350 * Math.pow(18, u) : 6000 * Math.pow(1 / 15, u);
    const env = Math.pow(Math.sin(Math.PI * Math.min(1, u * (up ? 1.15 : 1))), 2);
    return bp.run(rnd(), fc, 1.4, "bp") * env * 1.3 * vel;
  }, { rev: 0.3, pan: (pan[0] + pan[1]) / 2 });
}
function riser(t0, len) {
  const bp = new SVF();
  let ph = 0;
  add(DRY, t0, len, (i, t) => {
    const u = t / len;
    ph += (2 * Math.PI * 220 * Math.pow(8, u)) / SR;
    return bp.run(rnd(), 300 * Math.pow(24, u), 1.2, "bp") * Math.pow(u, 2.2) * 1.4 + Math.sin(ph) * Math.pow(u, 2) * 0.12;
  }, { rev: 0.3 });
  // Snare roll: 8ths, 16ths, then 32nds.
  for (let t = 0; t < len - 0.01; ) {
    const u = t / len;
    snare(t0 + t, 0.25 + u * 0.75);
    t += u < 0.4 ? 0.125 : u < 0.75 ? 0.0625 : 0.03125;
  }
}
function bell(t0, freq, vel = 0.18, pan = 0) {
  add(DRY, t0, 1.2, (i, t) => (Math.sin(2 * Math.PI * freq * t) + 0.3 * Math.sin(2 * Math.PI * freq * 2.76 * t) * Math.exp(-t * 6)) * Math.exp(-t * 6) * vel, { rev: 0.55, pan });
}
function click(t0) {
  const hp = new SVF();
  add(DRY, t0, 0.06, (i, t) => hp.run(rnd(), 4000, 0.7, "hp") * Math.exp(-t * 400) * 0.9 + Math.sin(2 * Math.PI * 1500 * t) * Math.exp(-t * 90) * 0.25, { rev: 0.15 });
}
function bassNote(t0, freq, len = 0.24, vel = 1, open = 0.5) {
  const s = new Saw();
  const lp = new SVF();
  add(MUS, t0, len, (i, t) => {
    const env = Math.min(1, t / 0.003) * Math.min(1, (len - t) / 0.02);
    const fc = 180 + open * 1400 * Math.exp(-t * 14);
    return (lp.run(s.next(freq), fc, 1.1, "lp") * 0.55 + Math.sin(2 * Math.PI * freq * t) * 0.45) * env * vel;
  });
}
function pad(t0, len, tones, { vel = 1, cutoff = 1500, attack = 0.35, release = 0.8 } = {}) {
  tones.forEach((freq, j) => {
    [-7, 0, 7].forEach((cents, v) => {
      const s = new Saw();
      const lp = new SVF();
      const fr = freq * Math.pow(2, cents / 1200);
      add(MUS, t0, len + release, (i, t) => {
        const env = Math.min(1, t / attack) * (t > len ? Math.exp(-(t - len) / (release / 4)) : 1);
        return lp.run(s.next(fr), cutoff, 0.7, "lp") * env * 0.045 * vel;
      }, { pan: (v - 1) * 0.6 + (j % 2 ? 0.1 : -0.1), rev: 0.45 });
    });
  });
}
function arpNote(t0, freq, vel = 1) {
  const a = new Saw();
  const b = new Saw();
  const lp = new SVF();
  add(MUS, t0, 0.16, (i, t) => lp.run(a.next(freq) - b.next(freq * 1.004), 3200, 0.9, "lp") * Math.exp(-t * 16) * 0.12 * vel, { dly: 0.45, rev: 0.2, pan: 0.15 });
}
function shimmer(t0, len, tones, vel = 0.05) {
  tones.forEach((freq, j) => {
    add(DRY, t0, len, (i, t) => Math.sin(2 * Math.PI * freq * t) * Math.min(1, t / 0.4) * Math.exp(-t * 0.9) * (0.75 + 0.25 * Math.sin(2 * Math.PI * (4 + j) * t)) * vel, { rev: 0.9, pan: j % 2 ? 0.5 : -0.5 });
  });
}


// ---- phonk kit ---------------------------------------------------------------------------------
const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);
/** An 808: a sine with a pitch punch, soft-clipped, held for `len`; it can glide to another note in its second half. */
function sub808(t0, freq, len, vel = 1, { glide = 0, drive = 2.4 } = {}) {
  let ph = 0;
  add(DRY, t0, len + 0.04, (i, t) => {
    let fr = freq * (1 + 0.9 * Math.exp(-t * 38));
    if (glide) fr *= Math.pow(glide / freq, Math.min(1, Math.max(0, (t - len * 0.45) / (len * 0.35))));
    ph += (2 * Math.PI * fr) / SR;
    const env = Math.min(1, t / 0.003) * (0.55 + 0.45 * Math.exp(-t * 1.6)) * Math.min(1, (len + 0.04 - t) / 0.04);
    return (Math.tanh(Math.sin(ph) * drive) / Math.tanh(drive)) * env * vel * 0.62;
  });
}
/** The 808 cowbell, tuned: two square waves a fifth-ish apart through a band-pass, short and bright. */
function cowbell(t0, midi, vel = 1, pan = 0) {
  const f1 = midiHz(midi), f2 = f1 * 1.4815;
  const bp = new SVF();
  let p1 = 0, p2 = 0;
  add(MUS, t0, 0.42, (i, t) => {
    p1 = (p1 + f1 / SR) % 1; p2 = (p2 + f2 / SR) % 1;
    const sq = (p1 < 0.5 ? 1 : -1) + (p2 < 0.5 ? 1 : -1) * 0.8;
    const env = Math.min(1, t / 0.0015) * (0.6 * Math.exp(-t * 30) + 0.4 * Math.exp(-t * 8));
    return bp.run(sq, f1 * 2.3, 1.4, 'bp') * env * 0.3 * vel;
  }, { pan, dly: 0.22, rev: 0.18 });
}
function crash(t0, vel = 0.5) {
  const hp = new SVF();
  add(DRY, t0, 2.6, (i, t) => hp.run(rnd(), 4800, 0.6, 'hp') * (Math.exp(-t * 1.5) * 0.7 + Math.exp(-t * 14) * 0.5) * vel * 0.55, { rev: 0.45, pan: 0.15 });
}
/** A reversed swell of noise into `t1`. */
function swell(t1, len, vel = 0.5) {
  const bp = new SVF();
  add(DRY, t1 - len, len, (i, t) => { const u = t / len; return bp.run(rnd(), 600 + 7000 * u * u, 0.9, 'bp') * u ** 3 * vel; }, { rev: 0.35 });
}

// ---- harmony ----------------------------------------------------------------------------------
// A minor. A bar is 2 s; the drop (14 s) lands on Am.
const ROOT = { Am: 55, F: 43.65, C: 65.41, G: 49 };
const CHT = {
  Am: [220, 261.63, 329.63, 440], F: [174.61, 220, 261.63, 349.23], C: [261.63, 329.63, 392, 523.25], G: [196, 246.94, 293.66, 392],
};
const PROG = [[0, 'Am'], [4, 'F'], [6, 'C'], [8, 'G'], [10, 'Am'], [12, 'F'], [13, 'G'], [14, 'Am'], [16, 'F'], [18, 'C'], [20, 'G']];
const chordAt = (t) => [...PROG].reverse().find(([s]) => t >= s - 1e-9)?.[1] ?? "Am";

// Sixteenth-note grid (0.125 s); a pattern step is its place in the 2 s bar.
const STEP = 0.125;
const step = (t) => Math.round(t / STEP) % 16;
const kicks = [];
const snares = [];
const kk = (t, vel) => { kick(t, vel); kicks.push([t, vel > 0.8 ? 0.6 : 0.35]); };
const cl = (t, vel) => { clap(t, vel); snare(t, vel * 0.5); snares.push(t); };
const each = (a, b, st, fn) => { for (let t = a, k = 0; t < b - 1e-6; t += st, k++) fn(t, k); };

// The cowbell riff (A minor pentatonic), two bars that alternate; null is a rest.
const RIFF = [
  [69, null, 69, 72, null, 69, 76, null, 74, null, 72, 69, null, 67, 69, null],
  [69, null, 69, 72, null, 69, 76, null, 79, null, 76, 74, null, 72, 74, null],
];
const riffAt = (t) => RIFF[Math.floor(t / 2) % 2][step(t)];

/** One stretch of the groove. `full` is the whole beat; otherwise a lighter version. */
function groove(a, b, { full = true, bell = 0.8, octave = 0, sub = 1, roll = true } = {}) {
  const KICK = full ? [0, 3, 8, 11] : [0, 8];
  each(a, b, STEP, (t) => {
    const s = step(t);
    if (KICK.includes(s)) {
      kk(t, full ? 1 : 0.75);
      // The 808 holds from this kick to the next one; the last of every second bar slides up an octave.
      const next = KICK.find((x) => x > s) ?? 16;
      const len = (next - s) * STEP - 0.01;
      const r = ROOT[chordAt(t)];
      const lastOfTwo = s === KICK[KICK.length - 1] && Math.floor(t / 2) % 2 === 1;
      sub808(t, r, Math.min(len, b - t), sub, { glide: lastOfTwo ? r * 2 : 0 });
    }
    if (s === 4 || s === 12) cl(t, full ? 0.95 : 0.7);
    hat(t, false, s % 4 === 2 ? 0.55 : 0.3, s % 2 ? 0.25 : -0.25);
    if (roll && full && Math.floor(t / 2) % 2 === 1 && s >= 14) { hat(t + STEP / 2, false, 0.35, 0.3); }
    const n = riffAt(t);
    if (bell && n) {
      cowbell(t, n, bell, s % 2 ? 0.25 : -0.25);
      if (octave) cowbell(t, n + 12, octave, s % 2 ? -0.35 : 0.35);
    }
  });
}

// ---- arrangement ------------------------------------------------------------------------------
// Intro (0–1.5): a low drone, a thump per word (frames 2, 15, 30), the cowbell teasing three notes, a swell into the crowd.
add(MUS, 0, 2.1, (i, t) => (Math.sin(2 * Math.PI * 55 * t) * 0.5 + Math.sin(2 * Math.PI * 82.4 * t) * 0.25) * Math.min(1, t / 0.4) * 0.35, { rev: 0.2 });
[2, 15, 30].forEach((fr, k) => boom(f(fr), { from: 95, to: 42, k: 14, decay: 5, len: 0.9, vel: 0.6 + k * 0.1, noise: 0.25 }));
[[f(45), 69], [f(52.5), 72], [f(60), 76]].forEach(([t, m]) => cowbell(t, m, 0.6));
swell(f(120), 1.0, 0.45);

// Crowd: "with" (90), "no" (105), "humans." (120): the first 808 hit and a crash.
boom(f(90), { vel: 0.5, decay: 4, len: 1, noise: 0.3 });
boom(f(105), { vel: 0.55, decay: 4, len: 1, noise: 0.3 });
kk(f(120), 1);
sub808(f(120), 55, 0.95, 1);
crash(f(120), 0.55);
metal(f(120), 0.16);
pad(2.0, 1.0, CHT.Am, { vel: 0.7, cutoff: 900 });
whoosh(f(166), f(184) - f(166), { vel: 0.6 });

// Talk (3–7): the half beat with a quiet cowbell; a click per post (188 + 15k), a snap per reply (320 + 15k).
groove(3.0, 7.0, { full: false, bell: 0.45, sub: 0.8 });
pad(3.0, 4.0, CHT.F, { vel: 0.35, cutoff: 800 });
for (let k = 0; k < 7; k++) click(f(188 + 15 * k));
whoosh(f(288), f(300) - f(288), { vel: 0.45 });
boom(f(300), { vel: 0.5, decay: 4, len: 1, noise: 0.3 });
for (let k = 0; k < 5; k++) click(f(320 + 15 * k));
whoosh(f(402), f(420) - f(402), { vel: 0.7, pan: [0.7, -0.7] });

// Build (7–10): the whole beat; a tick on every turn of the ring (450 + 30k).
groove(7.0, 10.0, { bell: 0.75 });
pad(7.0, 3.0, CHT.G, { vel: 0.35, cutoff: 1000 });
for (let k = 0; k < 5; k++) whoosh(f(450 + 30 * k) - 0.14, 0.16, { vel: 0.3 });
whoosh(f(582), f(600) - f(582), { vel: 0.7 });

// Money (10–13): the floor drops out: long 808s, sparse cowbell, the counter ticking (624–676), a switch per rule (700 + 30k).
sub808(10.0, 55, 1.95, 0.85);
sub808(12.0, 43.65, 0.95, 0.85);
sub808(13.0, 49, 0.9, 0.7, { glide: 98 });
each(10.0, 13.0, 0.25, (t, k) => hat(t + 0.125, false, 0.3, k % 2 ? 0.3 : -0.3));
each(10.0, 13.0, 0.5, (t, k) => { if (k % 4 === 0) kk(t, 0.5); });
each(10.0, 13.0, STEP, (t) => { const s = step(t); const n = riffAt(t); if (n && (s === 0 || s === 6 || s === 8)) cowbell(t, n, 0.4); });
pad(10.0, 3.0, CHT.Am, { vel: 0.55, cutoff: 1300 });
for (let fr = 624; fr <= 676; fr += 4) bell(f(fr), 2093 + (fr - 624) * 9, 0.02, 0.2);
boom(f(690), { vel: 0.5, decay: 4, len: 1, noise: 0.3 });
boom(f(704), { vel: 0.8, decay: 3, len: 1.3 });
for (let k = 0; k < 4; k++) { click(f(700 + 30 * k)); cowbell(f(700 + 30 * k), [69, 72, 76, 81][k], 0.55); }
// 13–14: the build. A snare roll and a riser; the last sixteenth is empty.
riser(13.0, 0.875);
pad(13.0, 0.85, CHT.G, { vel: 0.6, cutoff: 2400, attack: 0.5 });

// THE DROP (14, frame 840): the whole beat with the cowbell doubled an octave up; crashes on the bars.
boom(f(840), { from: 140, to: 30, k: 6, decay: 1.2, len: 2.6, vel: 1.1, noise: 1 });
metal(f(840), 0.25);
[14, 16, 18].forEach((t) => crash(t, t === 14 ? 0.75 : 0.45));
groove(14.0, 20.0, { bell: 1, octave: 0.4, sub: 1.05 });
pad(14.0, 2.0, CHT.Am, { vel: 0.5, cutoff: 1600, attack: 0.05 });
pad(16.0, 2.0, CHT.F, { vel: 0.5, cutoff: 1600, attack: 0.05 });
pad(18.0, 2.0, CHT.C, { vel: 0.5, cutoff: 1600, attack: 0.05 });
for (let k = 0; k < 10; k++) click(f(Math.round(844 + 7.5 * k)));
[930, 945, 960, 975].forEach((fr) => click(f(fr)));
whoosh(f(1002), f(1020) - f(1002), { vel: 0.6 });
// Bring (17–20) rides the drop: a key click every other letter, the new face (1160).
for (let n = 0; n < 70; n += 2) click(f(1038) + n / 1.4 / 60);
boom(f(1160), { vel: 0.6, decay: 3, len: 1.2 });
whoosh(f(1184), f(1200) - f(1184), { vel: 0.6 });

// Wall (20–22): the beat again, then a short riser into the logo.
crash(20.0, 0.5);
groove(20.0, 21.5, { bell: 1, octave: 0.4, sub: 1.05, roll: false });
each(21.5, 21.875, STEP / 2, (t, k) => hat(t, false, 0.3 + k * 0.08));
pad(20.0, 1.9, CHT.G, { vel: 0.55, cutoff: 2200, attack: 0.05 });
riser(21.25, 0.7);

// End (22, frame 1320): the last hit, a long 808, the cowbell's last call echoing, an A major chord ringing out.
kk(f(1320), 1);
boom(f(1320), { from: 120, to: 32, k: 7, decay: 1.3, len: 2.4, vel: 1, noise: 0.8 });
sub808(22.0, 55, 2.4, 1.05);
crash(22.0, 0.7);
metal(f(1320), 0.2);
cowbell(22.5, 81, 0.6); cowbell(22.75, 76, 0.45); cowbell(23.0, 69, 0.5);
pad(22.0, 1.7, [110, 164.81, 220, 277.18, 329.63, 440], { vel: 0.7, cutoff: 1800, attack: 0.02, release: 1.0 });
whoosh(f(1334), 0.5, { vel: 0.35 });

// The picture follows the drums: every kick and clap, in frames, for src/v7 (the beat pulse).
writeFileSync(new URL('../src/v7/hits.json', import.meta.url), JSON.stringify({ kick: kicks.map(([t]) => Math.round(t * 60)), snare: snares.map((t) => Math.round(t * 60)) }));

// ---- mix --------------------------------------------------------------------------------------
const duck = new Float32Array(N).fill(1);
for (const [t0, depth] of kicks) {
  const s0 = Math.round(t0 * SR);
  for (let i = 0; i < SR * 0.4 && s0 + i < N; i++) duck[s0 + i] = Math.min(duck[s0 + i], 1 - depth * Math.exp(-i / SR / 0.09));
}

function freeverb(inL, inR, room = 0.86, damp = 0.32) {
  const sc = SR / 44100;
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const aps = [556, 441, 341, 225];
  const run = (input, spread) => {
    const out = new Float32Array(N);
    for (const c of combs) {
      const len = Math.round((c + spread) * sc);
      const buf = new Float32Array(len);
      let idx = 0, store = 0;
      for (let n = 0; n < N; n++) {
        const y = buf[idx];
        store = y * (1 - damp) + store * damp;
        buf[idx] = input[n] * 0.015 + store * room;
        out[n] += y;
        if (++idx >= len) idx = 0;
      }
    }
    for (const a of aps) {
      const len = Math.round((a + spread) * sc);
      const buf = new Float32Array(len);
      let idx = 0;
      for (let n = 0; n < N; n++) {
        const b = buf[idx];
        buf[idx] = out[n] + b * 0.5;
        out[n] = b - out[n];
        if (++idx >= len) idx = 0;
      }
    }
    return out;
  };
  return [run(inL, 0), run(inR, 23)];
}
function pingpong(inL, inR, sec = 0.375, fb = 0.38) {
  const d = Math.round(sec * SR);
  const L = new Float32Array(N), R = new Float32Array(N);
  for (let n = 0; n < N; n++) {
    L[n] = (n >= d ? R[n - d] * fb : 0) + inL[n];
    R[n] = (n >= d ? L[n - d] * fb : 0) + inR[n] * 0.3;
  }
  return [L, R];
}

const [wL, wR] = freeverb(REV[0], REV[1]);
const [dL, dR] = pingpong(DLY[0], DLY[1]);
const out = [new Float32Array(N), new Float32Array(N)];
for (let c = 0; c < 2; c++) {
  const w = c ? wR : wL;
  const d = c ? dR : dL;
  for (let n = 0; n < N; n++) out[c][n] = DRY[c][n] + MUS[c][n] * duck[n] + w[n] * 0.9 + d[n] * 0.35;
}
let peak = 0;
for (const ch of out) for (const v of ch) peak = Math.max(peak, Math.abs(v));
const drive = 2.1 / peak;
peak = 0;
for (const ch of out)
  for (let n = 0; n < N; n++) {
    ch[n] = Math.tanh(ch[n] * drive);
    peak = Math.max(peak, Math.abs(ch[n]));
  }
const norm = 0.93 / peak;
const fadeOut = Math.round(0.08 * SR);

const wav = Buffer.alloc(44 + N * 4);
wav.write("RIFF", 0);
wav.writeUInt32LE(36 + N * 4, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(2, 22);
wav.writeUInt32LE(SR, 24);
wav.writeUInt32LE(SR * 4, 28);
wav.writeUInt16LE(4, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(N * 4, 40);
for (let n = 0; n < N; n++) {
  const g = n > N - fadeOut ? (N - n) / fadeOut : 1;
  for (let c = 0; c < 2; c++) wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, out[c][n] * norm * g)) * 32767), 44 + n * 4 + c * 2);
}
mkdirSync(new URL("../public/v7/", import.meta.url), { recursive: true });
writeFileSync(new URL("../public/v7/score.wav", import.meta.url), wav);
console.log(`v7/score.wav: ${DUR}s, drive ${drive.toFixed(2)}`);
