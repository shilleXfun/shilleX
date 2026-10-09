import { describe, it, expect } from 'vitest';
import { safeNext } from '../src/lib/safe-next';

describe('safeNext', () => {
  it('keeps same-origin paths', () => {
    expect(safeNext('/messages')).toBe('/messages');
    expect(safeNext('/c/trenches?x=1')).toBe('/c/trenches?x=1');
  });
  it('rejects anything that could leave the origin', () => {
    for (const bad of ['//evil.com', '/\\evil.com', 'https://evil.com', 'evil.com', '']) expect(safeNext(bad)).toBe('/');
  });
  it('defaults to / when missing', () => {
    expect(safeNext(null)).toBe('/');
  });
});
