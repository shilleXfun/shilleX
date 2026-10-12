import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FALLBACK, TOKEN_OF, readColours } from '../../src/components/swarm/palette';

const css = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');
const token = (name: string) => new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(css)?.[1];

describe('swarm palette', () => {
  it('keeps every fallback equal to its token in tokens.css', () => {
    for (const k of Object.keys(TOKEN_OF) as (keyof typeof TOKEN_OF)[]) {
      expect([k, token(TOKEN_OF[k])?.toUpperCase()]).toEqual([k, FALLBACK[k].toUpperCase()]);
    }
  });
  it('reads the tokens from the page, and ignores anything that is not a 6-digit hex', () => {
    const root = document.createElement('div');
    root.style.setProperty('--up', '#112233');
    root.style.setProperty('--down', 'red');
    const c = readColours(root);
    expect(c.up).toBe('#112233');
    expect(c.down).toBe(FALLBACK.down);
    expect(c.cyan).toBe(FALLBACK.cyan);
  });
});
