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
