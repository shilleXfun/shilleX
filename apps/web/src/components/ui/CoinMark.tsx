import { useId, useMemo } from 'react';

/** A small seeded stream (FNV-1a into mulberry32): the same mint draws the same mark everywhere. */
function stream(seed: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f = (v: number) => v.toFixed(2);
const polar = (r: number, a: number) => [20 + r * Math.cos(a), 20 + r * Math.sin(a)] as const;

/** The emblems a coin can wear. Each gets the stream and its two hues and returns SVG markup for a 40 × 40 box. */
const EMBLEMS: ((r: () => number, a: number, b: number, g: string) => string)[] = [
  // A star of 4 to 8 points.
  (r, a, b) => {
    const k = 4 + Math.floor(r() * 5), inner = 0.38 + r() * 0.25, turn = r() * Math.PI;
    const pts = Array.from({ length: k * 2 }, (_, i) => polar(i % 2 ? 12 * inner : 12, turn + (i * Math.PI) / k).map(f).join(',')).join(' ');
    return `<polygon points="${pts}" fill="hsl(${a} 92% 66%)"/><circle cx="20" cy="20" r="${f(2 + r() * 2)}" fill="hsl(${b} 95% 80%)"/>`;
  },
  // Three chevrons stacked.
  (r, a, b) => {
    const w = 9 + r() * 3, up = r() < 0.5 ? -1 : 1;
    return [0, 1, 2].map((i) => {
      const y = 20 + (i - 1) * 6.5 * up;
      return `<path d="M${f(20 - w)} ${f(y + 3.5 * up)}L20 ${f(y - 3.5 * up)}L${f(20 + w)} ${f(y + 3.5 * up)}" fill="none" stroke="hsl(${i === 1 ? b : a} 92% ${i === 1 ? 74 : 64}%)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
    }).join('');
  },
  // A disc split in two colours along a turned line.
  (r, a, b) => {
    const t = Math.floor(r() * 180);
    return `<g transform="rotate(${t} 20 20)"><path d="M8 20a12 12 0 0 1 24 0Z" fill="hsl(${a} 88% 62%)"/><path d="M8 20a12 12 0 0 0 24 0Z" fill="hsl(${b} 80% 50%)"/></g><circle cx="20" cy="20" r="12" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="1"/>`;
  },
  // Rings, a little off centre.
  (r, a, b) => {
    const dx = (r() - 0.5) * 4, dy = (r() - 0.5) * 4;
    return [12, 8, 4].map((rad, i) => `<circle cx="${f(20 + dx * i * 0.5)}" cy="${f(20 + dy * i * 0.5)}" r="${rad}" fill="${i === 2 ? `hsl(${b} 95% 78%)` : 'none'}" stroke="hsl(${i ? b : a} 90% ${66 + i * 6}%)" stroke-width="${i === 2 ? 0 : 2.6}"/>`).join('');
  },
  // Nested diamonds.
  (r, a, b) => {
    const t = r() < 0.5 ? 45 : 0, n = 2 + Math.floor(r() * 2);
    return Array.from({ length: n }, (_, i) => {
      const s = 17 - i * (13 / n);
      return `<rect x="${f(20 - s / 2)}" y="${f(20 - s / 2)}" width="${f(s)}" height="${f(s)}" rx="${f(1 + i)}" transform="rotate(${t} 20 20)" fill="hsl(${i % 2 ? b : a} 88% ${58 + i * 9}%)"/>`;
    }).join('');
  },
  // A leaf or flame, turned.
  (r, a, b, g) => {
    const t = Math.floor(r() * 360), w = 7 + r() * 4;
    return `<g transform="rotate(${t} 20 20)"><path d="M20 7C${f(20 + w)} 14 ${f(20 + w)} 27 20 33C${f(20 - w)} 27 ${f(20 - w)} 14 20 7Z" fill="url(#${g}e)"/><path d="M20 12V29" stroke="hsl(${b} 90% 85%)" stroke-width="1.2" stroke-linecap="round" opacity=".7"/></g>`;
  },
  // Bars, like a small chart.
  (r, a, b) => {
    const n = 3 + Math.floor(r() * 3), w = 18 / n;
    return Array.from({ length: n }, (_, i) => {
      const h = 7 + r() * 16, x = 11 + i * w;
      return `<rect x="${f(x + 0.8)}" y="${f(31 - h)}" width="${f(w - 1.6)}" height="${f(h)}" rx="1.4" fill="hsl(${i % 2 ? b : a} 90% ${62 + (i % 2) * 10}%)"/>`;
    }).join('');
  },
  // A hexagon with a triangle inside.
  (r, a, b) => {
    const turn = r() * Math.PI;
    const hex = Array.from({ length: 6 }, (_, i) => polar(12.5, turn + (i * Math.PI) / 3).map(f).join(',')).join(' ');
    const tri = Array.from({ length: 3 }, (_, i) => polar(7, turn + Math.PI / 6 + (i * 2 * Math.PI) / 3).map(f).join(',')).join(' ');
    return `<polygon points="${hex}" fill="hsl(${a} 80% 56%)"/><polygon points="${tri}" fill="hsl(${b} 95% 78%)"/>`;
  },
  // A crescent and a star beside it.
  (r, a, b, g) => {
    const t = Math.floor(r() * 360);
    return `<g transform="rotate(${t} 20 20)"><mask id="${g}m"><rect width="40" height="40" fill="#fff"/><circle cx="25" cy="17" r="10" fill="#000"/></mask><circle cx="20" cy="20" r="12" fill="hsl(${a} 90% 66%)" mask="url(#${g}m)"/><circle cx="28" cy="15" r="2.2" fill="hsl(${b} 95% 80%)"/></g>`;
  },
  // A coin face: a rim of ticks around a bright disc.
  (r, a, b) => {
    const k = 10 + Math.floor(r() * 10);
    const ticks = Array.from({ length: k }, (_, i) => {
      const [x1, y1] = polar(10.5, (i * 2 * Math.PI) / k), [x2, y2] = polar(13, (i * 2 * Math.PI) / k);
      return `M${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}`;
    }).join('');
    return `<path d="${ticks}" stroke="hsl(${a} 90% 70%)" stroke-width="1.6" stroke-linecap="round"/><circle cx="20" cy="20" r="8" fill="hsl(${b} 88% 62%)"/><circle cx="20" cy="20" r="3.4" fill="hsl(${a} 95% 82%)"/>`;
  },
];

/**
 * A coin's mark, drawn from its mint: a field in two hues from the whole colour wheel and one of ten emblems, so no two
 * coins share a picture (agents' coins used to show one of ten emoji). Fills its box; `size` fixes it instead.
 */
export function CoinMark({ seed, size, className }: { seed: string; size?: number; className?: string }) {
  const g = `cm${useId().replace(/[^\w-]/g, '')}`;
  const markup = useMemo(() => {
    const r = stream(seed);
    const a = Math.floor(r() * 360), b = (a + 50 + Math.floor(r() * 200)) % 360;
    const emblem = EMBLEMS[Math.floor(r() * EMBLEMS.length)]!(r, a, b, g);
    return `<defs><linearGradient id="${g}f" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${a} 55% 20%)"/><stop offset="1" stop-color="hsl(${b} 50% 9%)"/></linearGradient>`
      + `<radialGradient id="${g}h" cx=".3" cy=".22" r=".7"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`
      + `<linearGradient id="${g}e" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${b} 95% 72%)"/><stop offset="1" stop-color="hsl(${a} 90% 52%)"/></linearGradient></defs>`
      + `<rect width="40" height="40" fill="url(#${g}f)"/>${emblem}<rect width="40" height="40" fill="url(#${g}h)"/>`;
  }, [seed, g]);
  return (
    <svg className={className} viewBox="0 0 40 40" width={size ?? '100%'} height={size ?? '100%'} aria-hidden="true" focusable="false"
      style={{ display: 'block', borderRadius: size ? Math.round(size * 0.3) : undefined, flex: 'none' }} dangerouslySetInnerHTML={{ __html: markup }} />
  );
}
