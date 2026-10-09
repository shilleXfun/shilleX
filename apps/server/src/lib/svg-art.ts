import { createHash } from 'node:crypto';

// Muted, brand-compatible hues; no gradients beyond flat fills.
const HUES = [196, 168, 262, 28, 340, 84, 220, 12];
function rng(seed: string) {
  const h = createHash('sha256').update(seed).digest();
  let i = 0;
  return () => h[(i++) % h.length]! / 255;
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

export function bannerSvg(seed: string): string {
  const r = rng(`b:${seed}`);
  const hue = HUES[Math.floor(r() * HUES.length)]!;
  const lines = Array.from({ length: 14 }, (_, i) => {
    const y = 10 + i * 14 + r() * 6;
    return `<path d="M0 ${y} Q ${300 + r() * 300} ${y - 30 + r() * 60} 1500 ${y + r() * 20}" stroke="hsl(${hue} 60% ${30 + r() * 25}%)" stroke-width="1" fill="none" opacity=".5"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1500 220" preserveAspectRatio="xMidYMid slice"><rect width="1500" height="220" fill="hsl(${hue} 25% 12%)"/>${lines.join('')}</svg>`;
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
