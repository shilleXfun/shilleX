/**
 * The hex colours the canvas needs as values (a gradient stop cannot take `var(--up)`). tokens.css is the source: the
 * renderer reads these tokens once when it is created, and `FALLBACK` (kept equal to tokens.css by a test) stands in
 * where there is no stylesheet, such as the model's defaults and a test DOM.
 */
export interface SwarmColours { up: string; down: string; amber: string; cyan: string; white: string; coin: string; loner: string; ghost: string }

export const FALLBACK: SwarmColours = { up: '#3DDC97', down: '#FF5C6C', amber: '#FF6A3D', cyan: '#F7F7F5', white: '#F7F7F5', coin: '#F2E6D0', loner: '#9A9CA6', ghost: '#5E6069' };

/** The custom property each colour comes from. */
export const TOKEN_OF: Record<keyof SwarmColours, string> = { up: '--up', down: '--down', amber: '--accent', cyan: '--token', white: '--text', coin: '--coin', loner: '--accent-hover', ghost: '--ghost' };

/** `#RRGGBB` only: the renderer derives its alpha variants from the hex digits. Anything else falls back. */
export function readColours(root: Element = document.documentElement): SwarmColours {
  const style = getComputedStyle(root);
  const out = { ...FALLBACK };
  for (const k of Object.keys(TOKEN_OF) as (keyof SwarmColours)[]) {
    const v = style.getPropertyValue(TOKEN_OF[k]).trim();
    if (/^#[0-9a-f]{6}$/i.test(v)) out[k] = v;
  }
  return out;
}

const hex2 = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
const tints = new Map<string, string>();
/**
 * An agent's hue (features/home/speaker.ts: the hue of its avatar, its name and its bubbles across the UI) as a canvas
 * `#RRGGBB`, by default at the saturation and lightness the UI gives an agent's name (`hsl(var(--hue) 72% 72%)`), so a
 * spark or a reply arc is the colour of the name it belongs to.
 */
export function hueHex(hue: number, sat = 72, light = 72): string {
  const key = `${hue}/${sat}/${light}`;
  let out = tints.get(key);
  if (out) return out;
  const s = sat / 100, l = light / 100, a = s * Math.min(l, 1 - l);
  const f = (n: number) => { const k = (n + hue / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  out = `#${hex2(f(0))}${hex2(f(8))}${hex2(f(4))}`;
  tints.set(key, out);
  return out;
}

/** `#RRGGBB` at alpha a, as `rgba(…)`. */
export const hexA = (hex: string, a: number) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };

/** `#RRGGBB` moved toward another `#RRGGBB` by k (0..1). */
export function mixHex(a: string, b: string, k: number): string {
  const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
  const ch = (n: number, s: number) => ((n >> s) & 255) / 255;
  return `#${[16, 8, 0].map((s) => hex2(ch(x, s) + (ch(y, s) - ch(x, s)) * k)).join('')}`;
}
