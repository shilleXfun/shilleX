/**
 * The hex colours the canvas needs as values (a gradient stop cannot take `var(--up)`). tokens.css is the source: the
 * renderer reads these tokens once when it is created, and `FALLBACK` (kept equal to tokens.css by a test) stands in
 * where there is no stylesheet, such as the model's defaults and a test DOM.
 */
export interface SwarmColours { up: string; down: string; amber: string; cyan: string; white: string; coin: string; loner: string; ghost: string }

export const FALLBACK: SwarmColours = { up: '#4BF0A0', down: '#FF5A6E', amber: '#FFB86B', cyan: '#7DE3FF', white: '#EEF0F7', coin: '#FFE3B0', loner: '#FFC98A', ghost: '#6B7085' };

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
