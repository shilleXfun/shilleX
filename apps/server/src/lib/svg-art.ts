import { createHash } from 'node:crypto';

// Muted, brand-compatible hues; no gradients beyond flat fills.
const HUES = [196, 168, 262, 28, 340, 84, 220, 12];
function rng(seed: string) {
  const h = createHash('sha256').update(seed).digest();
  let i = 0;
  return () => h[(i++) % h.length]! / 256;
}
const esc = (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, '');

/**
 * An agent's face: the neuron it is in the world (the live backdrop draws every agent as a light joined to others). A lit
 * core, dendrites reaching out with their tips glowing, on a dark field tinted with the agent's hue. The hue is the first
 * draw of rng(`a:${seed}`), as it always was: the web app repeats that draw so a name takes its avatar's colour
 * (apps/web/src/features/home/speaker.ts). Everything else comes from a second stream, so it never moves the hue.
 */
export function avatarSvg(seed: string): string {
  const hue = HUES[Math.floor(rng(`a:${seed}`)() * HUES.length)]!;
  const s = stream(`n:${seed}`);
  const tip = (hue + 25 + Math.floor(s() * 70)) % 360;
  const C = 34, n = 5 + Math.floor(s() * 4), turn = s() * Math.PI * 2;
  const f = (v: number) => v.toFixed(1);
  const fibres: string[] = [], tips: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = turn + (i / n) * Math.PI * 2 + (s() - 0.5) * 0.7;
    const len = 17 + s() * 12, bend = (s() - 0.5) * 1.1;
    const qx = C + Math.cos(a + bend) * len * 0.55, qy = C + Math.sin(a + bend) * len * 0.55;
    const x = C + Math.cos(a) * len, y = C + Math.sin(a) * len;
    fibres.push(`<path d="M${C} ${C}Q${f(qx)} ${f(qy)} ${f(x)} ${f(y)}"/>`);
    tips.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(1.3 + s() * 1.5)}"/>`);
    // Some dendrites fork once, part way out.
    if (s() < 0.55) {
      const b = a + (s() < 0.5 ? 0.7 : -0.7), bl = len * (0.3 + s() * 0.25);
      const bx = qx + Math.cos(b) * bl, by = qy + Math.sin(b) * bl;
      fibres.push(`<path d="M${f(qx)} ${f(qy)}L${f(bx)} ${f(by)}"/>`);
      tips.push(`<circle cx="${f(bx)}" cy="${f(by)}" r="1.1"/>`);
    }
  }
  const core = 7 + s() * 3.5;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 68 68" data-seed="${esc(seed)}"><defs>`
    + `<radialGradient id="f" cx="50%" cy="46%" r="72%"><stop offset="0" stop-color="hsl(${hue} 48% 17%)"/><stop offset="1" stop-color="hsl(${hue} 34% 5%)"/></radialGradient>`
    + `<radialGradient id="g" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="hsl(${hue} 95% 68%)" stop-opacity=".5"/><stop offset="1" stop-color="hsl(${hue} 95% 60%)" stop-opacity="0"/></radialGradient>`
    + `<radialGradient id="c" cx="42%" cy="38%" r="62%"><stop offset="0" stop-color="#fff"/><stop offset=".4" stop-color="hsl(${hue} 100% 80%)"/><stop offset="1" stop-color="hsl(${hue} 85% 52%)"/></radialGradient>`
    + `</defs><rect width="68" height="68" fill="url(#f)"/><circle cx="${C}" cy="${C}" r="29" fill="url(#g)"/>`
    + `<g fill="none" stroke="hsl(${hue} 90% 70%)" stroke-width="1.7" stroke-linecap="round" opacity=".88">${fibres.join('')}</g>`
    + `<g fill="hsl(${tip} 95% 78%)">${tips.join('')}</g>`
    + `<circle cx="${C}" cy="${C}" r="${f(core + 3)}" fill="hsl(${hue} 95% 70%)" opacity=".22"/><circle cx="${C}" cy="${C}" r="${f(core)}" fill="url(#c)"/></svg>`;
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
