import { useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { EffectComposer, Bloom, ChromaticAberration, Noise, Vignette } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import { continueRender, delayRender, interpolate, random, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { useEffect } from 'react';
import * as THREE from 'three';
import { live } from '../kit';
import { C } from '../theme';
import { SHOTS, T } from '../v5/timeline';
import { BEEF, SITES } from '../v5/content';
import { TUNNEL_POSTS, type Assets } from './assets';

/**
 * v6, "Inside Shillex": one continuous 3D world. A real burn hangs in the dark; the camera pulls back to find it at the mouth of
 * a tunnel of real posts; it dives in and locks onto real beef and agent-built sites; the tunnel collapses into a sphere of the
 * hundred agents; on the drop the sphere bursts into the real network; the logo forms inside it.
 */
const smooth = (t: number) => t * t * (3 - 2 * t);
const ease = (t: number) => 1 - (1 - t) ** 3;
const cl = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

const STATION_Z = (k: number) => -26 - k * 15;
/** Where the sphere and the network live: past the last station. */
export const S = v3(0, 0, STATION_Z(SHOTS.length) - 26);

/** The network laid out in 3D: a few hundred steps of springs on the real ties, seeded, around S. */
const NODES = live.graph.nodes.slice(0, 100);
const NET: Map<string, THREE.Vector3> = (() => {
  const p = new Map(NODES.map((n) => [n.id, v3((random(`x${n.id}`) - 0.5) * 14, (random(`y${n.id}`) - 0.5) * 9, (random(`z${n.id}`) - 0.5) * 10)]));
  const edges = live.graph.edges.filter((e) => p.has(e.a) && p.has(e.b));
  for (let it = 0; it < 220; it++) {
    for (const e of edges) {
      const a = p.get(e.a)!, b = p.get(e.b)!, d = b.clone().sub(a), len = d.length() || 0.01, k = (len - 2.6) * 0.02;
      a.addScaledVector(d, k / len); b.addScaledVector(d, -k / len);
    }
    for (const a of p.values()) a.multiplyScalar(0.997);
  }
  for (const a of p.values()) a.multiplyScalar(1.6).add(S);
  return p;
})();
const SPHERE: Map<string, THREE.Vector3> = new Map(NODES.map((n, i) => {
  const y = 1 - (2 * (i + 0.5)) / NODES.length, r = Math.sqrt(1 - y * y), th = i * 2.39996;
  return [n.id, v3(Math.cos(th) * r * 4.4, y * 4.4, Math.sin(th) * r * 4.4).add(S)];
}));
/** Each agent's turn in the sphere (seeded): they arrive faster and faster. */
const TURN = new Map([...NODES].sort((a, b) => random(`t${a.id}`) - random(`t${b.id}`)).map((n, i) => [n.id, i]));

/** The camera: every position is a function of the frame. */
function Rig() {
  const fr = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const V = height > width;
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  let pos = v3(0, 0, 4.6), look = v3(0, 0, 0);
  if (fr < T.nobody) {
    const k = fr / T.nobody;
    pos = v3(Math.sin(k * 1.2 - 0.6) * 0.9, 0.25 - k * 0.25, 4.9 - k * 0.5);
  } else if (fr < T.esc) {
    const k = ease(interpolate(fr, [T.nobody, T.esc - 10], [0, 1], cl));
    // The dive: the camera goes through where the burn hung and into the tunnel, its walls streaming past.
    pos = v3(Math.sin(k * 3) * 0.8, 0.2 + Math.sin(k * 2) * 0.4, 4.4 - k * 16);
    look = v3(Math.sin(k * 3 + 0.4) * 1.2, 0, 4.4 - k * 16 - 12);
  } else if (fr < T.build) {
    const i = SHOTS.findIndex((s) => fr >= s.from && fr < s.to);
    const sh = SHOTS[Math.max(0, i)]!;
    const z = STATION_Z(Math.max(0, i)), prevZ = i > 0 ? STATION_Z(i - 1) : 30;
    const k = ease(interpolate(fr, [sh.from, sh.from + 14], [0, 1], cl));
    const drift = interpolate(fr, [sh.from + 14, sh.to], [0, 0.5], cl);
    const camZ = THREE.MathUtils.lerp(prevZ + 4.4, z + 4.4 - drift, k);
    const side = Math.sin(fr / 40) * 0.25;
    pos = v3(side, 0.15, camZ);
    look = v3(0, 0, camZ - 4.4);
  } else if (fr < T.drop) {
    const k = interpolate(fr, [T.build, T.drop], [0, 1], cl);
    const a = k * k * Math.PI * 1.6, r = 13 - k * 3;
    const enter = ease(interpolate(fr, [T.build, T.build + 14], [0, 1], cl));
    const orbit = v3(Math.sin(a) * r, 2 - k * 2, Math.cos(a) * r).add(S);
    pos = v3(0, 0.15, STATION_Z(SHOTS.length - 1) + 4.4).lerp(orbit, enter);
    look = S.clone();
  } else if (fr < T.logo) {
    const k = interpolate(fr, [T.drop, T.logo], [0, 1], cl);
    const a = Math.PI * 1.6 + k * 1.1, r = 6.5 + ease(Math.min(1, k * 3)) * 4.5;
    pos = v3(Math.sin(a) * r, 3 - k * 2, Math.cos(a) * r).add(S);
    look = S.clone();
  } else if (fr < T.outro1) {
    const k = interpolate(fr, [T.logo, T.outro1], [0, 1], cl);
    pos = S.clone().add(v3(0, 0, 7.5 - k * 0.6));
    look = S.clone();
  } else {
    const k = interpolate(fr, [T.outro1, T.out], [0, 1], cl);
    const a = 1.2 + k * 1.4;
    pos = v3(Math.sin(a) * 22, 4, Math.cos(a) * 22).add(S);
    look = S.clone();
  }
  camera.position.copy(pos);
  camera.lookAt(look);
  // Portrait frames see as much width as landscape ones would, nearly: a taller lens.
  camera.fov = V ? 92 : 50;
  camera.near = 0.05; camera.far = 600;
  camera.updateProjectionMatrix();
  return null;
}

function Card({ map, w, h, pos, rot = [0, 0, 0], opacity = 1 }: { map: THREE.Texture; w: number; h?: number; pos: THREE.Vector3; rot?: [number, number, number]; opacity?: number }) {
  const height = h ?? w / ((map.userData.aspect as number) || 1.78);
  return (
    <mesh position={pos} rotation={rot}>
      <planeGeometry args={[w, height]} />
      <meshBasicMaterial map={map} transparent opacity={opacity} toneMapped={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

/** The burn at the mouth of the tunnel. */
function Hero({ a }: { a: Assets }) {
  const fr = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (fr >= T.esc + 30) return null;
  const { width, height } = useVideoConfig();
  const pw = height > width ? 3.7 : 5.4;
  const s = spring({ frame: fr - 4, fps, config: { damping: 18, stiffness: 70 } });
  // Gone before the camera reaches where it hung (the dive passes z = 0 a third of the way in).
  const o = interpolate(fr, [T.nobody - 8, T.nobody + 4], [1, 0], cl);
  return <Card map={a.hero} w={pw * (0.85 + 0.15 * s)} pos={v3(0, 0, -(1 - s) * 3)} opacity={Math.min(1, s * 1.4) * o} />;
}

/** The tunnel: real posts on the walls, spiralling down to the sphere. */
function Tunnel({ a }: { a: Assets }) {
  const fr = useCurrentFrame();
  const collapse = interpolate(fr, [T.build, T.drop - 30], [0, 1], cl);
  const items = useMemo(() => TUNNEL_POSTS.map((p, i) => {
    const ang = i * 2.39996, r = 5.6 + random(`tr${p.id}`) * 1.6;
    const z = -6 - i * ((Math.abs(S.z) - 20) / TUNNEL_POSTS.length);
    return { id: p.id, x: Math.cos(ang) * r, y: Math.sin(ang) * r * 0.75, z };
  }), []);
  if (fr >= T.drop) return null;
  return (
    <>
      {items.map((it, i) => {
        const p = v3(it.x, it.y, it.z).lerp(S, ease(collapse));
        return <Card key={it.id} map={a.tunnel[i]!} w={4.2} pos={p} rot={[0, -it.x * 0.07, 0]} opacity={interpolate(fr, [T.build, T.build + 24], [1, 0], cl) * (fr < T.nobody ? interpolate(fr, [T.nobody - 30, T.nobody], [0, 1], cl) : 1)} />;
      })}
    </>
  );
}

function SiteCard({ map, w, pos, opacity }: { map: THREE.Texture; w: number; pos: THREE.Vector3; opacity: number }) {
  return (
    <mesh position={pos}>
      <planeGeometry args={[w, w / ((map.userData.aspect as number) || 1.6)]} />
      <meshBasicMaterial map={map} transparent opacity={opacity} toneMapped={false} color={new THREE.Color(0.72, 0.72, 0.74)} />
    </mesh>
  );
}

/** The stations of the flight: real beef and the sites, on the axis, each lit when the camera arrives. */
function Stations({ a }: { a: Assets }) {
  const fr = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const V = height > width;
  if (fr < T.nobody || fr >= T.build + 40) return null;
  return (
    <>
      {SHOTS.map((sh, k) => {
        const z = STATION_Z(k);
        const lit = interpolate(fr, [sh.from - 20, sh.from + 6], [0.25, 1], cl);
        const gone = interpolate(fr, [T.build, T.build + 40], [1, 0], cl);
        if (sh.shot.kind === 'beef') return <Card key={k} map={a.beef[sh.shot.i]!} w={V ? 3.8 : 5.6} pos={v3(0, 0, z)} opacity={lit * gone} />;
        // A site is shown a touch dimmer than white, so bloom keeps its details instead of blowing them out.
        return <SiteCard key={k} map={a.sites[sh.shot.i]!} w={V ? 4.6 : 6.2} pos={v3(0, 0.15, z)} opacity={lit * gone} />;
      })}
    </>
  );
}

/** The hundred: a sphere that fills faster and faster, then bursts into the network on the drop. */
function Agents({ a }: { a: Assets }) {
  const fr = useCurrentFrame();
  const { fps } = useVideoConfig();
  const camera = useThree((s) => s.camera);
  if (fr < T.build) return null;
  const burst = spring({ frame: fr - T.drop, fps, config: { damping: 15, stiffness: 90, mass: 0.9 } });
  const dur = T.drop - T.build - 10;
  const spin = interpolate(fr, [T.build, T.drop], [0, Math.PI * 1.2], cl);
  return (
    <>
      {NODES.map((n) => {
        // The first dozen land at once with the cut, then the rest faster and faster.
        const turn = TURN.get(n.id)!;
        const at = turn < 12 ? T.build + turn : T.build + 12 + Math.round(dur * ((turn - 12) / 88) ** 0.7);
        const pop = fr >= T.drop ? 1 : spring({ frame: fr - at, fps, config: { damping: 12, stiffness: 180 } });
        if (pop <= 0.001) return null;
        const sp = SPHERE.get(n.id)!.clone().sub(S).applyAxisAngle(v3(0, 1, 0), spin).add(S);
        const p = fr >= T.drop ? sp.lerp(NET.get(n.id)!, burst) : sp;
        const size = (fr >= T.drop ? 0.95 - 0.1 * burst : 0.95) * pop;
        return (
          <mesh key={n.id} position={p} quaternion={camera.quaternion}>
            <planeGeometry args={[size, size]} />
            <meshBasicMaterial map={a.avatars.get(n.id)} transparent toneMapped={false} />
          </mesh>
        );
      })}
    </>
  );
}

/** The real ties, drawn after the burst: amber between friends, red between rivals. */
function Ties() {
  const fr = useCurrentFrame();
  const draw = interpolate(fr, [T.drop + 14, T.drop + 70], [0, 1], cl);
  const geo = useMemo(() => new THREE.BufferGeometry(), []);
  if (fr < T.drop + 14) return null;
  const edges = live.graph.edges.filter((e) => NET.has(e.a) && NET.has(e.b));
  const pos: number[] = [], col: number[] = [];
  const amber = new THREE.Color(C.amber), red = new THREE.Color(C.down);
  for (const e of edges) {
    const a = NET.get(e.a)!, b = NET.get(e.b)!, end = a.clone().lerp(b, draw);
    pos.push(a.x, a.y, a.z, end.x, end.y, end.z);
    const c = e.w >= 0 ? amber : red;
    col.push(c.r * 2, c.g * 2, c.b * 2, c.r * 2, c.g * 2, c.b * 2);
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const dim = fr >= T.logo && fr < T.outro1 ? 0.25 : 1;
  return (
    <lineSegments geometry={geo}>
      <lineBasicMaterial vertexColors transparent opacity={0.75 * dim} toneMapped={false} />
    </lineSegments>
  );
}

/** Embers in the world: streaks while flying, pulled into the sphere during the build. */
function Embers({ a }: { a: Assets }) {
  const fr = useCurrentFrame();
  const n = 1400;
  const base = useMemo(() => Array.from({ length: n }, (_, i) => v3((random(`px${i}`) - 0.5) * 30, (random(`py${i}`) - 0.5) * 22, 20 - random(`pz${i}`) * (Math.abs(S.z) + 40))), []);
  const geo = useMemo(() => new THREE.BufferGeometry(), []);
  const pull = interpolate(fr, [T.build, T.drop], [0, 1], cl);
  const out = spring({ frame: fr - T.drop, fps: 60, config: { damping: 30, stiffness: 60 } });
  const pos = new Float32Array(n * 3);
  base.forEach((b, i) => {
    const t = Math.min(1, pull * (0.6 + random(`pp${i}`) * 0.8));
    let p = b.clone().lerp(S, ease(t));
    if (fr >= T.drop) p = S.clone().add(b.clone().sub(S).normalize().multiplyScalar(2 + out * (10 + random(`po${i}`) * 30)));
    p.y += Math.sin(fr / 50 + i) * 0.15;
    pos.set([p.x, p.y, p.z], i * 3);
  });
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return (
    <points geometry={geo}>
      <pointsMaterial map={a.glow} size={0.22} sizeAttenuation transparent depthWrite={false} blending={THREE.AdditiveBlending} color={new THREE.Color(1.6, 1.2, 0.7)} toneMapped={false} />
    </points>
  );
}

/** The logo inside the network, clean, with one light sweep across it. */
function Logo({ a }: { a: Assets }) {
  const fr = useCurrentFrame();
  if (fr < T.logo || fr >= T.outro1) return null;
  const o = interpolate(fr, [T.logo, T.logo + 3], [0, 1], cl);
  return <Card map={a.logo} w={6.4} pos={S.clone().add(v3(0, 0, 0.5))} opacity={o} />;
}

/**
 * Remotion draws each frame once, when it changes; the post-processing pipeline exists only from the second draw on. So every
 * frame is drawn a second time, after the browser has settled, and the screenshot waits for it.
 */
function Redraw() {
  const { advance } = useThree();
  const frame = useCurrentFrame();
  useEffect(() => {
    const h = delayRender(`redraw ${frame}`);
    const id = requestAnimationFrame(() => { advance(performance.now()); requestAnimationFrame(() => continueRender(h)); });
    return () => { cancelAnimationFrame(id); continueRender(h); };
  }, [frame, advance]);
  return null;
}

export function World({ a }: { a: Assets }) {
  const fr = useCurrentFrame();
  const bloom = fr >= T.drop && fr < T.drop + 40 ? interpolate(fr, [T.drop, T.drop + 40], [3.2, 1.3]) : fr >= T.build && fr < T.drop ? interpolate(fr, [T.build, T.drop], [1.1, 2.2]) : 1.25;
  const ab = fr >= T.drop && fr < T.drop + 12 ? 0.004 * (1 - (fr - T.drop) / 12) : 0;
  return (
    <>
      <color attach="background" args={['#04050b']} />
      <fog attach="fog" args={['#04050b', 34, 150]} />
      <Rig />
      <Redraw />
      <Hero a={a} />
      <Tunnel a={a} />
      <Stations a={a} />
      <Agents a={a} />
      <Ties />
      <Embers a={a} />
      <EffectComposer multisampling={0} frameBufferType={THREE.HalfFloatType}>
        <Bloom intensity={bloom} luminanceThreshold={0.78} luminanceSmoothing={0.2} mipmapBlur />
        <ChromaticAberration offset={new THREE.Vector2(ab, ab * 0.6)} blendFunction={BlendFunction.NORMAL} radialModulation={false} modulationOffset={0} />
        <Vignette darkness={0.55} offset={0.3} />
        <Noise opacity={0.035} blendFunction={BlendFunction.OVERLAY} />
      </EffectComposer>
    </>
  );
}
export { BEEF, SITES };
