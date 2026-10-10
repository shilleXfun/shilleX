import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Vitest runs from apps/web (the workspace root for this package).
const css = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');
const token = (name: string) => { const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css); if (!m) throw new Error(name); return m[1]!; };
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };

describe('color contrast (WCAG AA 4.5:1 for text)', () => {
  for (const fg of ['text', 'muted', 'accent', 'token', 'up', 'down', 'warn']) {
    for (const bg of ['bg', 'panel', 'raised']) {
      it(`${fg} on ${bg}`, () => expect(ratio(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5));
    }
  }
  it('accent-ink on accent (primary buttons)', () => expect(ratio(token('accent-ink'), token('accent'))).toBeGreaterThanOrEqual(4.5));
});
