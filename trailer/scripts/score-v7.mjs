// v7's own score, written in code for this edit (engine from the narrativepad trailer's score.mjs): 120 BPM, 25 s, A minor.
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


// ---- harmony ----------------------------------------------------------------------------------
const CH = {
  Am: { root: 55, tones: [220, 261.63, 329.63, 440] },
  F: { root: 43.65, tones: [174.61, 220, 261.63, 349.23] },
  C: { root: 65.41, tones: [261.63, 329.63, 392, 523.25] },
  G: { root: 49, tones: [196, 246.94, 293.66, 392] },
};
// A bar is 2 s from the crowd hit (2 s); the drop (14 s) lands on Am.
const PROG = [[0, "Am"], [4, "F"], [6, "C"], [8, "G"], [10, "Am"], [12, "F"], [13, "G"], [14, "Am"], [16, "F"], [18, "C"], [20, "G"]];
const chordAt = (t) => CH[[...PROG].reverse().find(([s]) => t >= s)?.[1] ?? "Am"];

// Every kick ducks the music bus (the mix below reads this list).
const kicks = [];
const kk = (t, vel) => { kick(t, vel); kicks.push([t, vel > 0.8 ? 0.6 : 0.35]); };
const each = (a, b, step, fn) => { for (let t = a, k = 0; t < b - 1e-6; t += step, k++) fn(t, k); };

// ---- arrangement ------------------------------------------------------------------------------
// Intro (0–1.5): a low drone and one thump per word (frames 2, 15, 30), a whoosh into the crowd.
add(MUS, 0, 2.1, (i, t) => (Math.sin(2 * Math.PI * 55 * t) * 0.5 + Math.sin(2 * Math.PI * 82.4 * t) * 0.25) * Math.min(1, t / 0.6) * 0.35, { rev: 0.2 });
[2, 15, 30].forEach((fr, k) => boom(f(fr), { from: 95, to: 42, k: 14, decay: 5, len: 0.9, vel: 0.55 + k * 0.1, noise: 0.25 }));
whoosh(f(66), f(90) - f(66), { vel: 0.8 });

// Crowd: "with" (90), "no" (105), "humans." (120) the first big hit.
boom(f(90), { vel: 0.55, decay: 4, len: 1, noise: 0.3 });
boom(f(105), { vel: 0.6, decay: 4, len: 1, noise: 0.3 });
boom(f(120), { vel: 1.05, decay: 2.2 });
metal(f(120), 0.2);
shimmer(f(120), 2.6, [880, 1318.5, 1760], 0.035);
pad(2.0, 1.2, CH.Am.tones, { vel: 0.8, cutoff: 900 });
whoosh(f(166), f(184) - f(166), { vel: 0.7 });

// Talk (3.0–7.0): pulse bass, soft kick, ticking hats; a click per post landing (188 + 15k), a snap per reply (320 + 15k).
each(3.0, 7.0, 0.25, (t) => bassNote(t, chordAt(t).root, 0.22, 0.55, 0.25 + ((t - 3) / 4) * 0.4));
each(3.0, 7.0, 0.5, (t) => kk(t, 0.42));
each(3.0, 7.0, 0.125, (t, k) => hat(t, false, k % 2 ? 0.25 : 0.45, k % 4 < 2 ? -0.3 : 0.3));
pad(3.0, 1.0, CH.Am.tones, { vel: 0.5, cutoff: 1000 });
pad(4.0, 2.0, CH.F.tones, { vel: 0.55, cutoff: 1000 });
pad(6.0, 1.0, CH.C.tones, { vel: 0.55, cutoff: 1100 });
for (let k = 0; k < 7; k++) { click(f(188 + 15 * k)); bell(f(188 + 15 * k), [1318.5, 1568, 1760, 2093][k % 4], 0.05, k % 2 ? 0.4 : -0.4); }
whoosh(f(288), f(300) - f(288), { vel: 0.5 });
boom(f(300), { vel: 0.55, decay: 4, len: 1, noise: 0.35 });
for (let k = 0; k < 5; k++) { snare(f(320 + 15 * k), 0.55); click(f(320 + 15 * k)); }
whoosh(f(400), f(420) - f(400), { vel: 0.85, pan: [0.7, -0.7] });

// Build (7.0–10.0): full kick, open hats, an arp; a bell on every turn of the ring (450 + 30k).
each(7.0, 10.0, 0.25, (t) => bassNote(t, chordAt(t).root, 0.22, 0.8, 0.6));
each(7.0, 10.0, 0.5, (t) => kk(t, 0.8));
each(7.0, 10.0, 0.5, (t) => hat(t + 0.25, true, 0.4));
each(7.0, 10.0, 0.125, (t, k) => arpNote(t, chordAt(t).tones[[0, 1, 2, 3, 2, 1, 2, 3][k % 8]] * 2, 0.5 + ((t - 7) / 3) * 0.4));
pad(7.0, 1.0, CH.C.tones, { vel: 0.6, cutoff: 1500 });
pad(8.0, 2.0, CH.G.tones, { vel: 0.7, cutoff: 1700 });
for (let k = 0; k < 5; k++) { whoosh(f(450 + 30 * k) - 0.16, 0.18, { vel: 0.35 }); bell(f(450 + 30 * k), [1760, 1318.5, 2093, 1568, 2637][k], 0.08, k % 2 ? 0.4 : -0.4); }
whoosh(f(580), f(600) - f(580), { vel: 0.8 });

// Money (10.0–14.0): the counter ticks (624–676), "By your rules." (690), a switch per rule (700 + 30k), the riser into the drop.
each(10.0, 13.0, 0.25, (t) => bassNote(t, chordAt(t).root, 0.22, 0.6, 0.4));
each(10.0, 13.0, 0.5, (t) => kk(t, 0.55));
each(10.0, 13.0, 0.25, (t, k) => hat(t + 0.125, false, 0.35, k % 2 ? 0.3 : -0.3));
pad(10.0, 2.0, CH.Am.tones, { vel: 0.6, cutoff: 1200 });
pad(12.0, 1.0, CH.F.tones, { vel: 0.6, cutoff: 1500 });
pad(13.0, 1.0, CH.G.tones, { vel: 0.7, cutoff: 2200, attack: 0.6 });
for (let fr = 624; fr <= 676; fr += 4) bell(f(fr), 2093 + (fr - 624) * 9, 0.025, 0.2);
boom(f(690), { vel: 0.5, decay: 4, len: 1, noise: 0.3 });
boom(f(704), { vel: 0.8, decay: 3, len: 1.3 });
for (let k = 0; k < 4; k++) { click(f(700 + 30 * k)); bell(f(700 + 30 * k), [880, 1108.7, 1318.5, 1760][k], 0.1, k % 2 ? 0.3 : -0.3); }
riser(13.0, 1.0);

// THE DROP (14.0, frame 840): the impact, then everything. Tiles land on sixteenths (844 + 7.5k), the order runs 930–975.
boom(f(840), { from: 140, to: 30, k: 6, decay: 1.2, len: 3.2, vel: 1.3, noise: 1 });
metal(f(840), 0.3);
shimmer(f(840), 3, [880, 1108.7, 1318.5, 1760], 0.04);
each(14.0, 17.0, 0.5, (t) => kk(t, 1));
each(14.5, 17.0, 1.0, (t) => clap(t, 0.9));
each(14.0, 17.0, 0.25, (t, k) => hat(t + 0.125, k % 2 === 0, 0.5));
each(14.0, 17.0, 0.25, (t, k) => bassNote(t, chordAt(t).root * (k % 2 ? 2 : 1), 0.22, 1, 0.9));
each(14.0, 17.0, 0.125, (t, k) => arpNote(t, chordAt(t).tones[[0, 2, 1, 3, 2, 3, 1, 2][k % 8]] * 2, 1));
pad(14.0, 2.0, CH.Am.tones, { vel: 0.9, cutoff: 2600, attack: 0.05 });
pad(16.0, 1.0, CH.F.tones, { vel: 0.9, cutoff: 2600, attack: 0.05 });
for (let k = 0; k < 10; k++) click(f(Math.round(844 + 7.5 * k)));
[1318.5, 1568, 1760, 2093].forEach((fr, k) => bell(f(930 + 15 * k), fr, 0.11, k % 2 ? 0.4 : -0.4));
whoosh(f(1000), f(1020) - f(1000), { vel: 0.8 });

// Bring (17.0–20.0): a lighter groove under the typing (a key click every other letter), a line per answer, the new face (1160).
each(17.0, 20.0, 0.5, (t) => kk(t, 0.7));
each(17.0, 20.0, 0.25, (t) => bassNote(t, chordAt(t).root, 0.22, 0.7, 0.5));
each(17.0, 20.0, 0.25, (t, k) => hat(t + 0.125, false, 0.3, k % 2 ? 0.3 : -0.3));
pad(17.0, 1.0, CH.F.tones, { vel: 0.6, cutoff: 1400 });
pad(18.0, 2.0, CH.C.tones, { vel: 0.6, cutoff: 1500 });
for (let n = 0; n < 70; n += 2) click(f(1038) + n / 1.4 / 60);
[1104, 1124, 1144].forEach((fr, k) => bell(f(fr), [1318.5, 1568, 1760][k], 0.1, 0));
boom(f(1160), { vel: 0.7, decay: 3, len: 1.2 });
metal(f(1160), 0.14);
whoosh(f(1182), f(1200) - f(1182), { vel: 0.8 });

// Wall (20.0–22.0): full again, then a short riser into the logo.
each(20.0, 21.5, 0.5, (t) => kk(t, 1));
each(20.5, 21.5, 1.0, (t) => clap(t, 0.8));
each(20.0, 22.0, 0.25, (t, k) => hat(t + 0.125, k % 2 === 0, 0.45));
each(20.0, 21.75, 0.25, (t, k) => bassNote(t, chordAt(t).root * (k % 2 ? 2 : 1), 0.22, 0.9, 0.8));
each(20.0, 21.75, 0.125, (t, k) => arpNote(t, chordAt(t).tones[[0, 2, 1, 3, 2, 3, 1, 2][k % 8]] * 2, 0.9));
pad(20.0, 1.9, CH.G.tones, { vel: 0.85, cutoff: 2400, attack: 0.05 });
riser(21.25, 0.75);

// End (22.0, frame 1320): the last hit and an A major chord that rings out.
boom(f(1320), { from: 120, to: 32, k: 7, decay: 1.3, len: 2.6, vel: 1.15, noise: 0.8 });
metal(f(1320), 0.24);
pad(22.0, 1.7, [110, 164.81, 220, 277.18, 329.63, 440, 493.88], { vel: 0.85, cutoff: 2200, attack: 0.02, release: 1.1 });
shimmer(f(1320), 2.8, [1318.5, 1760, 2217.5, 2637], 0.035);
whoosh(f(1334), 0.5, { vel: 0.4 }); // the light across the logo
[2637, 2217.5, 1760, 1318.5, 1108.7].forEach((fr, k) => bell(f(1350) + k * 0.09, fr, 0.06, k % 2 ? 0.5 : -0.5));
bell(f(1376), 880, 0.08, 0);

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
