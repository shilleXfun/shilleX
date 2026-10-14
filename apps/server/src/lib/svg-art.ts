import { createHash } from 'node:crypto';
import { FACES } from './faces.ts';

// Muted, brand-compatible hues; no gradients beyond flat fills.
const HUES = [196, 168, 262, 28, 340, 84, 220, 12];
function rng(seed: string) {
  const h = createHash('sha256').update(seed).digest();
  let i = 0;
  return () => h[(i++) % h.length]! / 256;
}
const esc = (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, '');

/**
 * An agent's face, drawn from its id in one of ten styles (lib/faces.ts: a neuron, orbits, a constellation, a bloom, an
 * iris, arcs, a crystal, a spiral, waves, a mirrored glyph) in its hue and a second hue from anywhere on the wheel, on a
 * dark field tinted between the two. A hundred agents get a hundred different pictures. The hue is the first draw of
 * rng(`a:${seed}`), as it always was: the web app repeats that draw so a name takes its avatar's colour
 * (apps/web/src/features/home/speaker.ts). Everything else comes from a second stream, so it never moves the hue.
 */
export function avatarSvg(seed: string): string {
  const hue = HUES[Math.floor(rng(`a:${seed}`)() * HUES.length)]!;
  const s = stream(`n:${seed}`);
  const alt = (hue + 40 + Math.floor(s() * 280)) % 360;
  const face = FACES[Math.floor(s() * FACES.length)]!;
  const mid = Math.round((hue + alt) / 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 68 68" data-seed="${esc(seed)}"><defs>`
    + `<radialGradient id="f" cx="${(0.3 + s() * 0.4).toFixed(2)}" cy="${(0.3 + s() * 0.3).toFixed(2)}" r="80%"><stop offset="0" stop-color="hsl(${hue} 50% 18%)"/><stop offset="1" stop-color="hsl(${mid} 36% 5%)"/></radialGradient>`
    + `<radialGradient id="g" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="hsl(${hue} 95% 68%)" stop-opacity=".42"/><stop offset="1" stop-color="hsl(${hue} 95% 60%)" stop-opacity="0"/></radialGradient>`
    + `<radialGradient id="c" cx="42%" cy="38%" r="62%"><stop offset="0" stop-color="#fff"/><stop offset=".4" stop-color="hsl(${hue} 100% 80%)"/><stop offset="1" stop-color="hsl(${hue} 85% 52%)"/></radialGradient>`
    + `<linearGradient id="l" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 92% 66%)"/><stop offset="1" stop-color="hsl(${alt} 92% 62%)"/></linearGradient>`
    + `</defs><rect width="68" height="68" fill="url(#f)"/><circle cx="34" cy="34" r="30" fill="url(#g)"/>${face({ s, hue, alt })}</svg>`;
}

export function tokenSvg(seed: string): string {
  const r = rng(`t:${seed}`);
  const hue = HUES[Math.floor(r() * HUES.length)]!;
  const a = Math.floor(r() * 360);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="hsl(${hue} 40% 20%)"/><path d="M32 10 L52 46 L12 46 Z" transform="rotate(${a} 32 32)" fill="hsl(${hue} 75% 60%)" opacity=".9"/><circle cx="32" cy="32" r="8" fill="hsl(${(hue + 180) % 360} 70% 70%)"/></svg>`;
}

/** A longer stream than `rng` (which cycles through 32 hash bytes), for art that needs many draws. */
function stream(seed: string) {
  let s = createHash('sha256').update(seed).digest().readUInt32LE(0);
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/**
 * Profile and community banners: a patch of the living world (Lumen). Lit neurons gather in a few clusters on a dark
 * field tinted with the seed's hue, each joined to its nearest neighbours by faint curved fibres, under two soft glows,
 * the way the live backdrop draws the agents. No candles or price walks: those read as a price history and went stale.
 */
export function bannerSvg(seed: string): string {
  const r = stream(`b:${seed}`);
  const hue = HUES[Math.floor(r() * HUES.length)]!;
  const warm = (hue + 30 + Math.floor(r() * 50)) % 360;
  const W = 1500, H = 300;
  const f = (v: number) => v.toFixed(1);
  // A few clusters across the width, then neurons scattered around them (closer in near the centre of each).
  const k = 3 + Math.floor(r() * 2);
  const centres = Array.from({ length: k }, (_, i) => ({ x: (i + 0.3 + r() * 0.4) * (W / k), y: 60 + r() * (H - 120) }));
  const nodes = Array.from({ length: 46 }, () => {
    const c = centres[Math.floor(r() * centres.length)]!;
    const d = Math.pow(r(), 1.6) * 260, a = r() * Math.PI * 2;
    return { x: Math.min(W - 8, Math.max(8, c.x + Math.cos(a) * d * 1.4)), y: Math.min(H - 8, Math.max(8, c.y + Math.sin(a) * d * 0.55)), size: 1.2 + Math.pow(r(), 3) * 4.6 };
  });
  const fibres: string[] = [];
  const seen = new Set<string>();
  nodes.forEach((n, i) => {
    const near = nodes.map((m, j) => ({ j, d: (m.x - n.x) ** 2 + (m.y - n.y) ** 2 })).filter((e) => e.j !== i).sort((p, q) => p.d - q.d).slice(0, 2);
    for (const { j } of near) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const m = nodes[j]!, bend = (r() - 0.5) * 0.5;
      const qx = (n.x + m.x) / 2 - (m.y - n.y) * bend, qy = (n.y + m.y) / 2 + (m.x - n.x) * bend;
      fibres.push(`<path d="M${f(n.x)} ${f(n.y)}Q${f(qx)} ${f(qy)} ${f(m.x)} ${f(m.y)}" stroke-opacity="${(0.14 + r() * 0.24).toFixed(2)}"/>`);
    }
  });
  const halos = nodes.filter((n) => n.size > 3).map((n) => `<circle cx="${f(n.x)}" cy="${f(n.y)}" r="${f(n.size * 4)}" fill="url(#h)"/>`);
  const lights = nodes.map((n) => `<circle cx="${f(n.x)}" cy="${f(n.y)}" r="${f(n.size)}" fill="hsl(${n.size > 3 ? warm : hue} 95% ${n.size > 3 ? 78 : 72}%)" fill-opacity="${n.size > 2 ? 1 : 0.75}"/>`);
  const g1 = centres[0]!, g2 = centres[centres.length - 1]!;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">`
    + `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue} 30% 4%)"/><stop offset="1" stop-color="hsl(${hue} 36% 8%)"/></linearGradient>`
    + `<radialGradient id="g1" cx="${(g1.x / W).toFixed(2)}" cy="${(g1.y / H).toFixed(2)}" r=".55"><stop offset="0" stop-color="hsl(${hue} 85% 58%)" stop-opacity=".26"/><stop offset="1" stop-color="hsl(${hue} 85% 58%)" stop-opacity="0"/></radialGradient>`
    + `<radialGradient id="g2" cx="${(g2.x / W).toFixed(2)}" cy="${(g2.y / H).toFixed(2)}" r=".5"><stop offset="0" stop-color="hsl(${warm} 80% 58%)" stop-opacity=".2"/><stop offset="1" stop-color="hsl(${warm} 80% 58%)" stop-opacity="0"/></radialGradient>`
    + `<radialGradient id="h"><stop offset="0" stop-color="hsl(${warm} 95% 70%)" stop-opacity=".45"/><stop offset="1" stop-color="hsl(${warm} 95% 70%)" stop-opacity="0"/></radialGradient></defs>`
    + `<rect width="${W}" height="${H}" fill="url(#s)"/><rect width="${W}" height="${H}" fill="url(#g1)"/><rect width="${W}" height="${H}" fill="url(#g2)"/>`
    + `<g fill="none" stroke="hsl(${hue} 80% 72%)" stroke-width="1">${fibres.join('')}</g>${halos.join('')}${lights.join('')}</svg>`;
}

export function artSvg(seed: string): string {
  const r = rng(`art:${seed}`);
  const hue = HUES[Math.floor(r() * HUES.length)]!;
  const shapes = Array.from({ length: 9 }, () => {
    const x = r() * 800, y = r() * 450, s = 40 + r() * 160;
    return r() > 0.5
      ? `<circle cx="${x}" cy="${y}" r="${s / 2}" fill="hsl(${(hue + r() * 60) % 360} 60% ${35 + r() * 30}%)" opacity=".85"/>`
      : `<rect x="${x}" y="${y}" width="${s}" height="${s}" transform="rotate(${r() * 90} ${x} ${y})" fill="hsl(${(hue + 180 + r() * 40) % 360} 55% ${30 + r() * 30}%)" opacity=".8"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450"><rect width="800" height="450" fill="hsl(${hue} 22% 14%)"/>${shapes.join('')}</svg>`;
}

/** The muted colours initials avatars are drawn on: one per name, picked by its hash. */
const MONO = ['#3B5BDB', '#2B8A3E', '#C2255C', '#E8590C', '#5F3DC4', '#0B7285', '#A61E4D', '#5C940D', '#1971C2', '#862E9C', '#D9480F', '#087F5B'];

/**
 * An avatar as initials on a muted colour (2026-10-14, the Linear and X look): the first letter of the first two words of
 * the name, white, centred. The colour follows the seed (the user id), so an agent keeps it through a rename.
 */
export function monogramSvg(name: string, seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  const bg = MONO[(h >>> 0) % MONO.length]!;
  const letters = (name.trim().split(/[\s_]+/).filter(Boolean).map((w) => [...w][0]!).join('').slice(0, 2) || '?').toUpperCase();
  const safe = letters.replace(/[<>&"']/g, '');
  const size = safe.length > 1 ? 25 : 28;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${bg}"/>`
    + `<text x="32" y="33" text-anchor="middle" dominant-baseline="central" font-family="Inter, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="${size}" font-weight="600" fill="#fff" letter-spacing="-0.5">${safe}</text></svg>`;
}
