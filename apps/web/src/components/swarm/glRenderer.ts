import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { Regime } from '@shillex/shared';
import { targetsFor, type SwarmEvent, type SwarmStage } from './bus';
import { hash, type SwarmModel } from './model';
import { FALLBACK, hueHex } from './palette';
import type { Renderer } from './renderer';

/**
 * The Swarm in 3D (WebGL): every agent a light hanging in real depth, joined to its allies, faction and neighbours by
 * filaments of light, signals running along them all the time, everything under bloom, and a camera that drifts round
 * the world and leans with the pointer. Same contract as the 2D canvas (renderer.ts), so the speech bubbles, sparks,
 * focus and live events work unchanged. Returns null when the browser gives no WebGL.
 */

// The world's box in scene units: wide like the screen, with real depth. The camera sits ~1300 units back.
const WORLD_W = 2400, WORLD_H = 1380, DEPTH = 640;
const CAM_CALM = 1460, CAM_HERO = 1130;
const STAGE_S = 1.6;
const MAX_PULSES = 220, MAX_RINGS = 24, STARS = 2600, DUST = 520;
const SEG = 10; // segments per curved filament
const UP = new THREE.Color(FALLBACK.up), DOWN = new THREE.Color(FALLBACK.down), AMBER = new THREE.Color(FALLBACK.amber), WHITE = new THREE.Color('#EEF0F7');

/** Regime tints for the far nebula glow behind the world. */
const SKY: Record<Regime | 'none', [string, string]> = {
  none: ['#1B2A6B', '#4A1F5C'],
  euphoria: ['#6B4A12', '#2C6B4A'],
  grind: ['#16305C', '#22234F'],
  fear: ['#5C1622', '#2A1838'],
  chaos: ['#5C1660', '#163A5C'],
};

const POINT_VERT = /* glsl */ `
  attribute vec3 color; attribute float size; attribute float alpha;
  uniform float uPixelRatio; uniform float uFar;
  varying vec3 vColor; varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float dist = max(1.0, -mv.z);
    gl_PointSize = size * uPixelRatio * (1300.0 / dist);
    vColor = color;
    // Far lights fade into the dark: depth reads at a glance.
    vAlpha = alpha * clamp(1.75 - dist / uFar, 0.18, 1.0);
  }`;
const GLOW_FRAG = /* glsl */ `
  varying vec3 vColor; varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    if (d > 1.0) discard;
    float core = smoothstep(0.32, 0.0, d);
    float halo = pow(1.0 - d, 2.4);
    float a = (core + halo * 0.62) * vAlpha;
    gl_FragColor = vec4(vColor * (0.55 + core * 1.6), a);
  }`;
const RING_FRAG = /* glsl */ `
  varying vec3 vColor; varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float ring = smoothstep(0.84, 0.94, d) * smoothstep(1.0, 0.95, d);
    if (ring <= 0.001) discard;
    gl_FragColor = vec4(vColor * 1.4, ring * vAlpha);
  }`;
const STAR_VERT = /* glsl */ `
  attribute float size; attribute float alpha; attribute float phase;
  uniform float uPixelRatio; uniform float uTime;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = size * uPixelRatio;
    vAlpha = alpha * (0.62 + 0.38 * sin(uTime * 0.9 + phase));
  }`;
const STAR_FRAG = /* glsl */ `
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    gl_FragColor = vec4(vec3(0.82, 0.88, 1.0), (1.0 - d) * vAlpha);
  }`;

interface Curve { a: THREE.Vector3; c: THREE.Vector3; b: THREE.Vector3; colour: THREE.Color; ia: number; ib: number }
interface Pulse { curve: Curve | null; from: THREE.Vector3; ctrl: THREE.Vector3; to: THREE.Vector3; t0: number; dur: number; colour: THREE.Color; size: number; reverse: boolean; live: boolean }
interface Ring { node: number; t0: number; dur: number; colour: THREE.Color; live: boolean }

const bez = (out: THREE.Vector3, a: THREE.Vector3, c: THREE.Vector3, b: THREE.Vector3, t: number) => {
  const it = 1 - t;
  return out.set(it * it * a.x + 2 * it * t * c.x + t * t * b.x, it * it * a.y + 2 * it * t * c.y + t * t * b.y, it * it * a.z + 2 * it * t * c.z + t * t * b.z);
};
const rand = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };

export function createGLRenderer(canvas: HTMLCanvasElement, opts: { reduced: boolean }): Renderer | null {
  let gl: THREE.WebGLRenderer;
  try {
    gl = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  } catch { return null; }
  gl.setClearColor('#020203', 1);
  gl.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 1, 10, 16000);
  camera.position.set(0, 0, CAM_CALM);
  const world = new THREE.Group();
  scene.add(world);

  const composer = new EffectComposer(gl);
  composer.addPass(new RenderPass(scene, camera));
  // Only the bright things bloom (the lights, the signals): the dark stays black.
  const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.7, 0.5, 0.16);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  let W = 0, H = 0, DPR = 1, raf = 0, running = false, last = 0, drawAvg = 0;
  const t0 = performance.now();
  const now = () => (performance.now() - t0) / 1000;
  let model: SwarmModel | null = null;
  let stageFrom = 0, stageTo = 0, stageAt = -STAGE_S;
  let focusId: string | null = null;
  let parTX = 0, parTY = 0, parX = 0, parY = 0;

  // ── Far sky: stars on a great shell and nebula glows tinted by the market's weather. ──
  const starGeo = new THREE.BufferGeometry();
  {
    const r = rand(7), pos = new Float32Array(STARS * 3), size = new Float32Array(STARS), alpha = new Float32Array(STARS), phase = new Float32Array(STARS);
    for (let i = 0; i < STARS; i++) {
      const u = r() * 2 - 1, th = r() * Math.PI * 2, rad = 3200 + r() * 5200, s = Math.sqrt(1 - u * u);
      pos[i * 3] = Math.cos(th) * s * rad; pos[i * 3 + 1] = u * rad * 0.7; pos[i * 3 + 2] = Math.sin(th) * s * rad - 1800;
      size[i] = 0.8 + r() * r() * 2.6; alpha[i] = 0.25 + r() * 0.7; phase[i] = r() * 6.28;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    starGeo.setAttribute('size', new THREE.BufferAttribute(size, 1));
    starGeo.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
    starGeo.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
  }
  const starMat = new THREE.ShaderMaterial({ vertexShader: STAR_VERT, fragmentShader: STAR_FRAG, uniforms: { uPixelRatio: { value: 1 }, uTime: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  // Dust: faint motes through the world's own volume, for parallax between the lights.
  const dustGeo = new THREE.BufferGeometry();
  {
    const r = rand(11), pos = new Float32Array(DUST * 3), size = new Float32Array(DUST), alpha = new Float32Array(DUST), phase = new Float32Array(DUST);
    for (let i = 0; i < DUST; i++) {
      pos[i * 3] = (r() - 0.5) * WORLD_W * 1.6; pos[i * 3 + 1] = (r() - 0.5) * WORLD_H * 1.6; pos[i * 3 + 2] = (r() - 0.5) * 2400;
      size[i] = 1 + r() * 2; alpha[i] = 0.08 + r() * 0.22; phase[i] = r() * 6.28;
    }
    dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    dustGeo.setAttribute('size', new THREE.BufferAttribute(size, 1));
    dustGeo.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
    dustGeo.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
  }
  const dust = new THREE.Points(dustGeo, starMat);
  world.add(dust);

  // Nebulae: huge soft glows far behind, coloured by the weather (and so changing with the market's mood).
  const nebulaTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)'); grad.addColorStop(0.35, 'rgba(255,255,255,0.35)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const nebulae: THREE.Sprite[] = [];
  const NEB = [[-900, 380, -2600, 3600], [1100, -300, -3000, 4200], [100, 650, -3600, 3000], [-200, -700, -2400, 2600]] as const;
  for (const [x, y, z, s] of NEB) {
    const m = new THREE.SpriteMaterial({ map: nebulaTex, color: '#1B2A6B', transparent: true, opacity: 0.05, depthWrite: false, blending: THREE.AdditiveBlending });
    const sp = new THREE.Sprite(m); sp.position.set(x, y, z); sp.scale.set(s, s * 0.7, 1); scene.add(sp); nebulae.push(sp);
  }
  let skyFrom = SKY.none, skyTo = SKY.none, skyAt = -3;

  // ── The agents. ──
  const nodeMat = new THREE.ShaderMaterial({ vertexShader: POINT_VERT, fragmentShader: GLOW_FRAG, uniforms: { uPixelRatio: { value: 1 }, uFar: { value: 2600 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  let nodeGeo = new THREE.BufferGeometry();
  const nodes = new THREE.Points(nodeGeo, nodeMat);
  world.add(nodes);
  let base = new Float32Array(0);          // each light's home (x, y, z)
  let pos = new Float32Array(0);           // where it is now (home + orbit)
  let orbit = new Float32Array(0);         // rx, ry, rz, w, phase per light
  let heat = new Float32Array(0);          // a recent action, fading
  let colours: THREE.Color[] = [];

  // Filaments: curved lines of light between lights, drawn in one geometry; feuds in their own, red.
  const lineMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending });
  let lineGeo = new THREE.BufferGeometry();
  const lines = new THREE.LineSegments(lineGeo, lineMat);
  world.add(lines);
  let curves: Curve[] = [];
  let byNode: number[][] = [];

  // Signals and rings.
  const pulseGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(MAX_PULSES * 3), pCol = new Float32Array(MAX_PULSES * 3), pSize = new Float32Array(MAX_PULSES), pAlpha = new Float32Array(MAX_PULSES);
  pulseGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pulseGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  pulseGeo.setAttribute('size', new THREE.BufferAttribute(pSize, 1));
  pulseGeo.setAttribute('alpha', new THREE.BufferAttribute(pAlpha, 1));
  const pulsesObj = new THREE.Points(pulseGeo, nodeMat);
  world.add(pulsesObj);
  const pulses: Pulse[] = Array.from({ length: MAX_PULSES }, () => ({ curve: null, from: new THREE.Vector3(), ctrl: new THREE.Vector3(), to: new THREE.Vector3(), t0: 0, dur: 1, colour: WHITE, size: 10, reverse: false, live: false }));

  const ringMat = new THREE.ShaderMaterial({ vertexShader: POINT_VERT, fragmentShader: RING_FRAG, uniforms: { uPixelRatio: { value: 1 }, uFar: { value: 2600 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const ringGeo = new THREE.BufferGeometry();
  const rPos = new Float32Array(MAX_RINGS * 3), rCol = new Float32Array(MAX_RINGS * 3), rSize = new Float32Array(MAX_RINGS), rAlpha = new Float32Array(MAX_RINGS);
  ringGeo.setAttribute('position', new THREE.BufferAttribute(rPos, 3));
  ringGeo.setAttribute('color', new THREE.BufferAttribute(rCol, 3));
  ringGeo.setAttribute('size', new THREE.BufferAttribute(rSize, 1));
  ringGeo.setAttribute('alpha', new THREE.BufferAttribute(rAlpha, 1));
  world.add(new THREE.Points(ringGeo, ringMat));
  const rings: Ring[] = Array.from({ length: MAX_RINGS }, () => ({ node: 0, t0: 0, dur: 1, colour: WHITE, live: false }));

  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  const stageNow = (t: number) => { const k = Math.min(1, Math.max(0, (t - stageAt) / STAGE_S)); const e = k * k * (3 - 2 * k); return stageFrom + (stageTo - stageFrom) * e; };

  function build(m: SwarmModel | null) {
    const n = m?.nodes.length ?? 0;
    base = new Float32Array(n * 3); pos = new Float32Array(n * 3); orbit = new Float32Array(n * 5); heat = new Float32Array(n);
    colours = [];
    const col = new Float32Array(n * 3), size = new Float32Array(n), alpha = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const node = m!.nodes[i]!, h = hash(`${node.id}~gl`);
      const x = (node.x - 0.5) * WORLD_W, y = -(node.y - 0.5) * WORLD_H, z = (((h % 1000) / 1000) - 0.5) * DEPTH;
      base[i * 3] = x; base[i * 3 + 1] = y; base[i * 3 + 2] = z;
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      orbit[i * 5] = 6 + ((h >>> 3) % 100) / 9; orbit[i * 5 + 1] = 5 + ((h >>> 9) % 100) / 11; orbit[i * 5 + 2] = 8 + ((h >>> 14) % 100) / 7;
      orbit[i * 5 + 3] = (2 * Math.PI) / (14 + ((h >>> 20) % 100) / 6); orbit[i * 5 + 4] = node.phase;
      const c = new THREE.Color(node.colour);
      colours.push(c);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      size[i] = node.r * 9; alpha[i] = node.glow;
    }
    nodeGeo.dispose();
    nodeGeo = new THREE.BufferGeometry();
    nodeGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    nodeGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    nodeGeo.setAttribute('size', new THREE.BufferAttribute(size, 1));
    nodeGeo.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
    nodes.geometry = nodeGeo;

    // Filaments: allies (their faction's colour), feuds (red), and each light's nearest neighbours (faint, its own colour).
    curves = []; byNode = Array.from({ length: n }, () => []);
    const seen = new Set<string>();
    const add = (ia: number, ib: number, colour: THREE.Color) => {
      const key = ia < ib ? `${ia}|${ib}` : `${ib}|${ia}`;
      if (ia === ib || seen.has(key)) return;
      seen.add(key);
      const a = new THREE.Vector3(base[ia * 3], base[ia * 3 + 1], base[ia * 3 + 2]), b = new THREE.Vector3(base[ib * 3], base[ib * 3 + 1], base[ib * 3 + 2]);
      const mid = a.clone().add(b).multiplyScalar(0.5), len = a.distanceTo(b), hh = hash(key);
      const off = new THREE.Vector3((((hh % 200) / 100) - 1), ((((hh >>> 8) % 200) / 100) - 1), ((((hh >>> 16) % 200) / 100) - 1)).normalize().multiplyScalar(len * 0.16);
      const curve: Curve = { a, c: mid.add(off), b, colour, ia, ib };
      byNode[ia]!.push(curves.length); byNode[ib]!.push(curves.length);
      curves.push(curve);
    };
    if (m) {
      for (const [colour, pairs] of m.alliesByColour) { const c = new THREE.Color(colour); for (const [a, b] of pairs) add(a, b, c); }
      for (const [a, b] of m.feuds) add(a, b, DOWN);
      for (let i = 0; i < n; i++) {
        const near: [number, number][] = [];
        for (let j = 0; j < n; j++) if (j !== i) {
          const dx = base[i * 3]! - base[j * 3]!, dy = base[i * 3 + 1]! - base[j * 3 + 1]!, dz = base[i * 3 + 2]! - base[j * 3 + 2]!;
          near.push([j, dx * dx + dy * dy + dz * dz]);
        }
        near.sort((p, q) => p[1] - q[1]);
        for (const [j] of near.slice(0, 2)) add(i, j, colours[i]!.clone().multiplyScalar(0.42));
      }
    }
    const lp = new Float32Array(curves.length * SEG * 6), lc = new Float32Array(curves.length * SEG * 6);
    let k = 0;
    for (const cv of curves) {
      for (let s = 0; s < SEG; s++) {
        bez(tmp, cv.a, cv.c, cv.b, s / SEG); bez(tmp2, cv.a, cv.c, cv.b, (s + 1) / SEG);
        // Brightest at the ends, where the lights are; the middle of a long filament fades.
        const f1 = 0.35 + 0.65 * Math.abs(1 - 2 * (s / SEG)), f2 = 0.35 + 0.65 * Math.abs(1 - 2 * ((s + 1) / SEG));
        lp.set([tmp.x, tmp.y, tmp.z, tmp2.x, tmp2.y, tmp2.z], k);
        lc.set([cv.colour.r * f1, cv.colour.g * f1, cv.colour.b * f1, cv.colour.r * f2, cv.colour.g * f2, cv.colour.b * f2], k);
        k += 6;
      }
    }
    lineGeo.dispose();
    lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(lp, 3));
    lineGeo.setAttribute('color', new THREE.BufferAttribute(lc, 3));
    lines.geometry = lineGeo;
    for (const p of pulses) p.live = false;
    for (const r of rings) r.live = false;
  }

  function fire(curveIdx: number, colour: THREE.Color, t: number, fast = false, fromNode = -1) {
    const p = pulses.find((x) => !x.live);
    const cv = curves[curveIdx];
    if (!p || !cv) return;
    p.curve = cv; p.live = true; p.t0 = t; p.dur = fast ? 0.9 + Math.random() * 0.5 : 1.8 + Math.random() * 1.6;
    p.colour = colour; p.size = fast ? 16 : 9 + Math.random() * 4;
    p.reverse = fromNode >= 0 ? cv.ib === fromNode : Math.random() < 0.5;
  }
  /** A direct arc from one light to another (a reply), not along a filament. */
  function arc(a: number, b: number, colour: THREE.Color, t: number) {
    for (let k = 0; k < 3; k++) {
      const p = pulses.find((x) => !x.live);
      if (!p) return;
      p.curve = null; p.live = true; p.t0 = t + k * 0.07; p.dur = 1.1; p.colour = colour; p.size = 15 - k * 3; p.reverse = false;
      p.from.set(pos[a * 3]!, pos[a * 3 + 1]!, pos[a * 3 + 2]!); p.to.set(pos[b * 3]!, pos[b * 3 + 1]!, pos[b * 3 + 2]!);
      p.ctrl.copy(p.from).add(p.to).multiplyScalar(0.5).add(new THREE.Vector3(0, p.from.distanceTo(p.to) * 0.28, 120));
    }
  }
  function ring(node: number, colour: THREE.Color, t: number) {
    const r = rings.find((x) => !x.live);
    if (!r) return;
    r.node = node; r.t0 = t; r.dur = 1.4; r.colour = colour; r.live = true;
  }

  let nextIdle = 0;
  function frame(t: number, dt: number, still: boolean) {
    const begin = performance.now();
    const k = still ? stageTo : stageNow(t);
    if (!still) { const e = Math.min(1, dt * 2.2); parX += (parTX - parX) * e; parY += (parTY - parY) * e; }
    // The camera drifts round the world and leans with the pointer; the hero brings it closer.
    const dist = CAM_CALM + (CAM_HERO - CAM_CALM) * k, ang = still ? 0.4 : t * 0.045;
    camera.position.set(Math.sin(ang) * 300 + parX * 260, Math.cos(ang * 0.73) * 120 - parY * 160, dist);
    camera.lookAt(parX * 60, -parY * 40, 0);
    world.rotation.y = still ? 0.05 : Math.sin(t * 0.021) * 0.16;
    world.rotation.x = still ? 0 : Math.sin(t * 0.017) * 0.05;
    stars.rotation.y = t * 0.004;
    bloom.strength = 0.62 + 0.38 * k;
    starMat.uniforms.uTime!.value = t;

    // Weather: the nebulae ease from one sky to the next.
    const sk = Math.min(1, Math.max(0, (t - skyAt) / 3));
    for (let i = 0; i < nebulae.length; i++) {
      const m = nebulae[i]!.material as THREE.SpriteMaterial;
      const a = new THREE.Color(skyFrom[i % 2]!), b = new THREE.Color(skyTo[i % 2]!);
      m.color.copy(a.lerp(b, sk));
      m.opacity = (0.045 + 0.025 * k) * (still ? 1 : 0.85 + 0.15 * Math.sin(t * 0.15 + i));
    }

    if (model) {
      const n = model.nodes.length;
      const alpha = nodeGeo.getAttribute('alpha') as THREE.BufferAttribute, size = nodeGeo.getAttribute('size') as THREE.BufferAttribute;
      const fi = focusId === null ? -1 : model.index.get(focusId) ?? -1;
      for (let i = 0; i < n; i++) {
        const node = model.nodes[i]!, o = i * 5, th = (still ? 0 : t) * orbit[o + 3]! + orbit[o + 4]!;
        pos[i * 3] = base[i * 3]! + Math.sin(th) * orbit[o]!;
        pos[i * 3 + 1] = base[i * 3 + 1]! + Math.cos(th * 0.8) * orbit[o + 1]!;
        pos[i * 3 + 2] = base[i * 3 + 2]! + Math.sin(th * 0.6) * orbit[o + 2]!;
        heat[i] = Math.max(0, heat[i]! - dt * 0.45);
        const breath = node.ghost ? 1 : 1 + 0.16 * Math.sin((2 * Math.PI * (still ? 0 : t)) / node.breath + node.phase);
        const focus = i === fi ? 1.9 : 1;
        size.setX(i, node.r * 9 * breath * (1 + heat[i]! * 1.2) * focus * (1 + 0.15 * k));
        alpha.setX(i, Math.min(1, (node.glow + heat[i]! * 0.6) * (fi >= 0 && i !== fi ? 0.72 : 1) * (0.9 + 0.2 * k)));
      }
      (nodeGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      alpha.needsUpdate = true; size.needsUpdate = true;

      // Idle firing along the filaments, a few a second; more on the hero.
      if (!still && curves.length) {
        while (t >= nextIdle) {
          const cv = Math.floor(Math.random() * curves.length);
          fire(cv, curves[cv]!.colour.clone().lerp(WHITE, 0.35), t);
          nextIdle = t - Math.log(1 - Math.random()) / (4.5 + 3.5 * k);
        }
      }
    }

    // Signals.
    let pi = 0;
    for (const p of pulses) {
      const life = (t - p.t0) / p.dur;
      if (!p.live || life >= 1 || still) { if (life >= 1) p.live = false; pAlpha[pi] = 0; pi++; continue; }
      if (life < 0) { pAlpha[pi] = 0; pi++; continue; }
      const u = p.reverse ? 1 - life : life;
      if (p.curve) bez(tmp, p.curve.a, p.curve.c, p.curve.b, u); else bez(tmp, p.from, p.ctrl, p.to, u);
      pPos[pi * 3] = tmp.x; pPos[pi * 3 + 1] = tmp.y; pPos[pi * 3 + 2] = tmp.z;
      pCol[pi * 3] = p.colour.r; pCol[pi * 3 + 1] = p.colour.g; pCol[pi * 3 + 2] = p.colour.b;
      pSize[pi] = p.size; pAlpha[pi] = Math.min(1, life * 6, (1 - life) * 6);
      pi++;
    }
    for (const a of ['position', 'color', 'size', 'alpha']) (pulseGeo.getAttribute(a) as THREE.BufferAttribute).needsUpdate = true;

    // Rings round a light that just launched or traded.
    for (let i = 0; i < rings.length; i++) {
      const r = rings[i]!, life = (t - r.t0) / r.dur;
      if (!r.live || life >= 1 || !model || still) { if (life >= 1) r.live = false; rAlpha[i] = 0; continue; }
      rPos[i * 3] = pos[r.node * 3]!; rPos[i * 3 + 1] = pos[r.node * 3 + 1]!; rPos[i * 3 + 2] = pos[r.node * 3 + 2]!;
      rCol[i * 3] = r.colour.r; rCol[i * 3 + 1] = r.colour.g; rCol[i * 3 + 2] = r.colour.b;
      rSize[i] = 20 + life * 190; rAlpha[i] = (1 - life) * 0.9;
    }
    for (const a of ['position', 'color', 'size', 'alpha']) (ringGeo.getAttribute(a) as THREE.BufferAttribute).needsUpdate = true;

    composer.render();
    const ms = performance.now() - begin;
    drawAvg = drawAvg ? drawAvg * 0.95 + ms * 0.05 : ms;
  }

  function loop(ts: number) {
    raf = requestAnimationFrame(loop);
    const t = ts / 1000;
    const dt = last ? Math.min(0.1, t - last) : 1 / 60;
    last = t;
    frame(now(), dt, false);
  }
  const still = () => { if (W && H) frame(2, 0, true); };
  const onPointer = (e: PointerEvent) => { if (e.pointerType === 'mouse' && W && H) { parTX = e.clientX / W - 0.5; parTY = e.clientY / H - 0.5; } };
  if (!opts.reduced) window.addEventListener('pointermove', onPointer, { passive: true });

  return {
    resize(w, h, dpr) {
      if (w === W && h === H && dpr === DPR) return;
      W = w; H = h; DPR = Math.min(dpr, 1.5);
      gl.setPixelRatio(DPR); gl.setSize(w, h, false);
      composer.setPixelRatio(DPR); composer.setSize(w, h);
      bloom.resolution.set(w, h);
      camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
      nodeMat.uniforms.uPixelRatio!.value = DPR; ringMat.uniforms.uPixelRatio!.value = DPR; starMat.uniforms.uPixelRatio!.value = DPR;
      if (opts.reduced || !running) still();
    },
    setModel(m) {
      const same = m && model && m.nodes === model.nodes;
      model = m;
      if (!same) build(m);
      if (opts.reduced || !running) still();
    },
    setRegime(r: Regime | null) {
      const target = SKY[r ?? 'none'];
      if (target === skyTo) return;
      skyFrom = skyTo; skyTo = target; skyAt = opts.reduced ? -3 : now();
      if (opts.reduced || !running) still();
    },
    setStage(s: SwarmStage) {
      const target = s.stage === 'hero' ? 1 : 0;
      if (target === stageTo) return;
      const t = now();
      stageFrom = opts.reduced || !running ? target : stageNow(t); stageTo = target; stageAt = t;
      if (opts.reduced || !running) still();
    },
    setFocus(id) { focusId = id; if (opts.reduced || !running) still(); },
    locate(id) {
      const i = model?.index.get(id);
      if (i === undefined || !W || !H) return null;
      tmp.set(pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!);
      world.updateMatrixWorld();
      tmp.applyMatrix4(world.matrixWorld).project(camera);
      if (tmp.z > 1) return null;
      const x = (tmp.x + 1) / 2 * W, y = (1 - tmp.y) / 2 * H;
      const vh = Math.min(H, window.innerHeight || H);
      return x >= 0 && x <= W && y >= 0 && y <= vh ? { x, y } : null;
    },
    event(e: SwarmEvent) {
      if (!model) return;
      const tg = targetsFor(model, e);
      if (tg.from === null) return;
      heat[tg.from] = e.kind === 'post' ? 0.7 : 1;
      if (opts.reduced) { still(); return; }
      const t = now();
      const node = model.nodes[tg.from]!;
      const col = e.kind === 'buy' ? UP : e.kind === 'sell' || e.kind === 'rug' ? DOWN : e.kind === 'launch' ? AMBER : e.kind === 'transfer' ? WHITE : new THREE.Color(hueHex(node.hue));
      const mine = byNode[tg.from] ?? [];
      const burst = e.kind === 'post' ? 2 : 3;
      for (let k = 0; k < Math.min(burst, mine.length); k++) fire(mine[Math.floor(Math.random() * mine.length)]!, col, t + k * 0.08, true, tg.from);
      if (tg.toNode !== null) arc(tg.from, tg.toNode, col, t);
      if (e.kind !== 'post') ring(tg.from, col, t);
    },
    start() { if (running || opts.reduced) return; running = true; last = 0; raf = requestAnimationFrame(loop); },
    stop() { running = false; cancelAnimationFrame(raf); },
    destroy() {
      running = false; cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onPointer);
      for (const g of [starGeo, dustGeo, nodeGeo, lineGeo, pulseGeo, ringGeo]) g.dispose();
      for (const m of [starMat, nodeMat, lineMat, ringMat]) m.dispose();
      for (const s of nebulae) (s.material as THREE.SpriteMaterial).dispose();
      nebulaTex.dispose(); composer.dispose(); gl.dispose();
    },
    stats() { return { drawMs: Math.round(drawAvg * 100) / 100 }; },
  };
}
