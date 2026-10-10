import { createHash } from 'node:crypto';

// Muted, brand-compatible hues; no gradients beyond flat fills.
const HUES = [196, 168, 262, 28, 340, 84, 220, 12];
function rng(seed: string) {
  const h = createHash('sha256').update(seed).digest();
  let i = 0;
  return () => h[(i++) % h.length]! / 256;
}
const esc = (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, '');

export function avatarSvg(seed: string): string {
  const r = rng(`a:${seed}`);
  const hue = HUES[Math.floor(r() * HUES.length)]!;
  const bg = `hsl(${hue} 32% 22%)`;
  const fg = `hsl(${hue} 70% 62%)`;
  const cells: string[] = [];
  for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) {
    if (r() > 0.5) {
      cells.push(`<rect x="${x * 12 + 4}" y="${y * 12 + 4}" width="12" height="12"/>`);
      if (x < 2) cells.push(`<rect x="${(4 - x) * 12 + 4}" y="${y * 12 + 4}" width="12" height="12"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 68 68" data-seed="${esc(seed)}"><rect width="68" height="68" fill="${bg}"/><g fill="${fg}">${cells.join('')}</g></svg>`;
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
 * Profile and community banners: a personal night skyline (visual v3). A seeded candle walk stands on fading towers
 * under a tinted sky with a horizon glow, echoing the app's live backdrop. No last-price line: in a profile or community
 * header that would read as the entity's own price history, and these walks are decoration.
 */
export function bannerSvg(seed: string): string {
  const r = stream(`b:${seed}`);
  const hue = HUES[Math.floor(r() * HUES.length)]!;
  const W = 1500, H = 220, STEP = 24, BODY = 12;
  const y = (v: number) => (H - 14 - v * 150).toFixed(1);
  let prev = 0.25 + r() * 0.5;
  const candles: string[] = [];
  for (let x = STEP / 2; x < W; x += STEP) {
    const c = Math.min(0.97, Math.max(0.05, prev + (0.5 - prev) * 0.07 + (r() - 0.5) * 0.2));
    const hi = Math.max(prev, c) + r() * 0.05, lo = Math.min(prev, c) - r() * 0.05;
    const up = c >= prev, fill = up ? 'url(#u)' : 'url(#d)', tint = up ? '#27E0C0' : '#FF4F7B';
    const top = y(Math.max(prev, c)), bottom = y(Math.min(prev, c));
    const bodyH = Math.max(2, Number(bottom) - Number(top)).toFixed(1);
    candles.push(
      `<rect x="${x - BODY / 2}" y="${bottom}" width="${BODY}" height="${(H - Number(bottom)).toFixed(1)}" fill="${fill}"/>`
      + `<line x1="${x}" x2="${x}" y1="${y(hi)}" y2="${y(lo)}" stroke="${tint}" stroke-opacity=".45"/>`
      + `<rect x="${x - BODY / 2}" y="${top}" width="${BODY}" height="${bodyH}" fill="${tint}" fill-opacity=".7"/>`,
    );
    prev = c;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice">`
    + `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue} 40% 6%)"/><stop offset="1" stop-color="hsl(${hue} 45% 15%)"/></linearGradient>`
    + `<radialGradient id="g" cx="${(0.3 + r() * 0.4).toFixed(2)}" cy="1" r=".7"><stop offset="0" stop-color="hsl(${(hue + 40) % 360} 75% 50%)" stop-opacity=".35"/><stop offset="1" stop-color="hsl(${hue} 70% 40%)" stop-opacity="0"/></radialGradient>`
    + `<linearGradient id="u" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#27E0C0" stop-opacity=".22"/><stop offset="1" stop-color="#27E0C0" stop-opacity="0"/></linearGradient>`
    + `<linearGradient id="d" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF4F7B" stop-opacity=".2"/><stop offset="1" stop-color="#FF4F7B" stop-opacity="0"/></linearGradient></defs>`
    + `<rect width="${W}" height="${H}" fill="url(#s)"/><rect width="${W}" height="${H}" fill="url(#g)"/>${candles.join('')}</svg>`;
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
