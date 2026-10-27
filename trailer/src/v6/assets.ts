import { useEffect, useState } from 'react';
import { continueRender, delayRender, staticFile } from 'remotion';
import * as THREE from 'three';
import { asset, live, type Post } from '../kit';
import { C, display, mono } from '../theme';
import { BEEF, QUOTE, SITES } from '../v5/content';

/**
 * v6's textures: every real post, avatar, site and the logo drawn once onto a canvas (in the page's own fonts) and handed to
 * three.js. Remotion waits for them (delayRender) so no frame renders half-loaded.
 */
export interface Assets {
  hero: THREE.Texture;
  beef: THREE.Texture[];
  tunnel: THREE.Texture[];
  sites: THREE.Texture[];
  avatars: Map<string, THREE.Texture>;
  logo: THREE.Texture;
  glow: THREE.Texture;
}

const loadImage = (src: string) => new Promise<HTMLImageElement>((ok) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => ok(i); i.onerror = () => ok(i); i.src = src; });

/** A texture that knows its shape: userData.aspect = width / height. */
function tex(canvas: HTMLCanvasElement | HTMLImageElement): THREE.Texture {
  const t = canvas instanceof HTMLCanvasElement ? new THREE.CanvasTexture(canvas) : new THREE.Texture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  t.userData.aspect = canvas.width / canvas.height;
  return t;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[][] {
  const lines: string[][] = [[]];
  for (const w of text.split(' ')) {
    const cur = lines[lines.length - 1]!;
    const test = [...cur, w].join(' ');
    if (ctx.measureText(test).width > maxW && cur.length) lines.push([w]);
    else cur.push(w);
  }
  return lines;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function avatarCanvas(img: HTMLImageElement | null, size = 256, ring = true): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.save(); ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2 - 6, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = '#151830'; ctx.fillRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = false;
  if (img && img.width) ctx.drawImage(img, 0, 0, size, size);
  ctx.restore();
  if (ring) { ctx.lineWidth = 8; ctx.strokeStyle = C.amber; ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2 - 6, 0, Math.PI * 2); ctx.stroke(); }
  return c;
}

/** A post as a card: avatar, name, handle and its words, @names and $tickers in amber. */
function card(post: { author: { name: string; username: string }; text: string }, avatar: HTMLImageElement | null, o: { w?: number; h?: number; size?: number; glow?: number } = {}): HTMLCanvasElement {
  const W = o.w ?? 1600, pad = 70, size = o.size ?? 78;
  // Measured first, so the card is exactly as tall as its words.
  const m = document.createElement('canvas').getContext('2d')!;
  m.font = `800 ${size}px ${display}`;
  const H = Math.round(pad + 150 + 40 + wrap(m, post.text, W - pad * 2).length * size * 1.12 + pad * 0.9);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#171a36'); g.addColorStop(1, '#0b0c1c');
  roundRect(ctx, 8, 8, W - 16, H - 16, 44); ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = 6; ctx.strokeStyle = `rgba(255,190,107,${o.glow ?? 0.9})`; ctx.shadowColor = C.amber; ctx.shadowBlur = 30; ctx.stroke(); ctx.shadowBlur = 0;
  ctx.drawImage(avatarCanvas(avatar, 150), pad, pad);
  ctx.fillStyle = C.ink; ctx.font = `800 64px ${display}`; ctx.textBaseline = 'alphabetic';
  ctx.fillText(post.author.name, pad + 180, pad + 72);
  ctx.fillStyle = '#9a9bb5'; ctx.font = `500 44px ${mono}`;
  ctx.fillText(`@${post.author.username} · AI agent`, pad + 180, pad + 132);
  ctx.font = `800 ${size}px ${display}`;
  const lines = wrap(ctx, post.text, W - pad * 2);
  let y = pad + 150 + 40 + size;
  for (const line of lines) {
    let x = pad;
    for (const w of line) {
      ctx.fillStyle = /^@\w|^\$[A-Z]/.test(w) ? C.amber : C.ink;
      ctx.fillText(w, x, y);
      x += ctx.measureText(`${w} `).width;
    }
    y += size * 1.12;
  }
  return c;
}

function logoCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = 2048; c.height = 640;
  const ctx = c.getContext('2d')!;
  ctx.font = `800 400px ${display}`; ctx.textBaseline = 'middle';
  const a = 'shille', w1 = ctx.measureText(a).width, w2 = ctx.measureText('X').width, x0 = (2048 - w1 - w2) / 2;
  ctx.fillStyle = C.ink; ctx.fillText(a, x0, 330);
  ctx.fillStyle = C.amber; ctx.shadowColor = C.amber; ctx.shadowBlur = 40; ctx.fillText('X', x0 + w1 - 12, 330);
  return c;
}

function glowCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,214,150,.8)'); g.addColorStop(1, 'rgba(255,190,107,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  return c;
}

/** Posts for the tunnel walls: real, short enough to read on a card, not about the old paper desk. */
export const TUNNEL_POSTS: Post[] = live.posts.filter((p) => p.body.length < 240 && !/paper|desk/i.test(p.body)).slice(0, 130);

let built: Assets | null = null;
let building: Promise<Assets> | null = null;

async function build(): Promise<Assets> {
  await document.fonts.ready;
  await Promise.all([document.fonts.load(`800 64px ${display}`), document.fonts.load(`500 44px ${mono}`)]);
  const avatarSrc = new Map<string, string>();
  for (const n of live.graph.nodes) avatarSrc.set(n.username, n.avatar);
  for (const p of TUNNEL_POSTS) avatarSrc.set(p.author.username, p.author.avatar);
  const imgs = new Map<string, HTMLImageElement>();
  await Promise.all([...avatarSrc.entries()].map(async ([u, a]) => { if (a) imgs.set(u, await loadImage(asset(a))); }));
  const siteImgs = await Promise.all(SITES.map((s) => loadImage(staticFile(s.file))));
  const avatars = new Map<string, THREE.Texture>();
  for (const n of live.graph.nodes) avatars.set(n.id, tex(avatarCanvas(imgs.get(n.username) ?? null, 256)));
  return {
    hero: tex(card({ author: QUOTE.author, text: QUOTE.words.join(' ') }, imgs.get(QUOTE.author.username) ?? null, { w: 1800, h: 1000, size: 84 })),
    beef: BEEF.map((b) => tex(card({ author: b.author, text: b.text }, imgs.get(b.author.username) ?? null, { size: 96 }))),
    tunnel: TUNNEL_POSTS.map((p) => tex(card({ author: p.author, text: p.body }, imgs.get(p.author.username) ?? null, { size: 60, glow: 0.45 }))),
    sites: siteImgs.map((i) => tex(i)),
    avatars,
    logo: tex(logoCanvas()),
    glow: tex(glowCanvas()),
  };
}

/** The textures, once per page; the frame waits until they exist. */
export function useAssets(): Assets | null {
  const [a, setA] = useState<Assets | null>(built);
  // Held from the first render until the textures exist AND React has drawn with them (the effect below), so a frame is
  // never captured before the 3D canvas is on screen.
  const [handle] = useState(() => (built ? null : delayRender('v6 textures')));
  useEffect(() => {
    if (built) { setA(built); return; }
    building ??= build();
    building.then((x) => { built = x; setA(x); }).catch((e) => { console.error(e); if (handle !== null) continueRender(handle); });
  }, [handle]);
  useEffect(() => {
    if (a && handle !== null) requestAnimationFrame(() => requestAnimationFrame(() => continueRender(handle)));
  }, [a, handle]);
  return a;
}
