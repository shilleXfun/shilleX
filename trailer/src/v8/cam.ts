import { Easing } from 'remotion';

/**
 * v8's camera and world geometry. One CSS 3D world (y points down), seen through a perspective of P px from the screen centre.
 * The same maths is used to place DOM planes (CSS transforms) and to project points for the SVG lines, so the two always agree.
 */
export type V3 = [number, number, number];
export const P = 1500;
export const CX = 960;
export const CY = 540;

export const rad = (d: number) => (d * Math.PI) / 180;
export const deg = (r: number) => (r * 180) / Math.PI;
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const mix3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
/** CSS rotateY / rotateX on a point. */
export const ry = (v: V3, a: number): V3 => { const c = Math.cos(a), s = Math.sin(a); return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c]; };
export const rx = (v: V3, a: number): V3 => { const c = Math.cos(a), s = Math.sin(a); return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c]; };

export interface Cam { eye: V3; look: V3; yaw: number; pitch: number; focus: number }
export function cam(eye: V3, look: V3): Cam {
  const d = sub(look, eye);
  return { eye, look, yaw: Math.atan2(-d[0], -d[2]), pitch: Math.atan2(d[1], Math.hypot(d[0], d[2])), focus: len(d) };
}
/** World point → camera space (the camera looks down -z). */
export const toCam = (p: V3, c: Cam): V3 => rx(ry(sub(p, c.eye), -c.yaw), -c.pitch);
/** Camera space → world point. */
export const fromCam = (r: V3, c: Cam): V3 => add(c.eye, ry(rx(r, c.pitch), c.yaw));
/** Screen position, scale and depth of a world point; d <= 0 is behind the camera. */
export function project(p: V3, c: Cam) {
  const r = toCam(p, c);
  const d = -r[2];
  const s = d > 1 ? P / d : 0;
  return { x: CX + r[0] * s, y: CY + r[1] * s, s, d };
}
/** The world container's transform for a camera. */
export const worldCss = (c: Cam) => `translateZ(${P}px) rotateX(${deg(-c.pitch)}deg) rotateY(${deg(-c.yaw)}deg) translate3d(${-c.eye[0]}px, ${-c.eye[1]}px, ${-c.eye[2]}px)`;

/** A station: a place on the circle around the sphere, facing outwards. Its local x is screen-right when seen face on. */
export interface Station { pos: V3; yaw: number }
export const station = (angle: number, r: number, y = 0): Station => ({ pos: [Math.sin(rad(angle)) * r, y, Math.cos(rad(angle)) * r], yaw: angle });
export const at = (st: Station, v: V3): V3 => add(st.pos, ry(v, rad(st.yaw)));

export const inOut = Easing.bezier(0.65, 0, 0.35, 1);
export const whip = Easing.bezier(0.8, 0, 0.2, 1);
export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
