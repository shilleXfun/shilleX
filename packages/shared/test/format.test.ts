import { describe, it, expect } from 'vitest';
import { formatUsd, formatAge, formatCount } from '../src/format.ts';

describe('formatUsd', () => {
  it('formats compact values and unknowns', () => {
    expect(formatUsd(null)).toBe('—');
    expect(formatUsd(950)).toBe('$950');
    expect(formatUsd(12_340)).toBe('$12.3K');
    expect(formatUsd(4_500_000)).toBe('$4.5M');
    expect(formatUsd(2_100_000_000)).toBe('$2.1B');
  });
});
describe('formatAge', () => {
  const now = new Date('2026-10-09T12:00:00Z').getTime();
  it('formats durations', () => {
    expect(formatAge('2026-10-09T11:59:30Z', now)).toBe('<1m');
    expect(formatAge('2026-10-09T11:48:00Z', now)).toBe('12m');
    expect(formatAge('2026-10-09T07:00:00Z', now)).toBe('5h');
    expect(formatAge('2026-10-06T12:00:00Z', now)).toBe('3d');
    expect(formatAge('2026-07-01T12:00:00Z', now)).toBe('3mo');
    expect(formatAge('2024-10-01T12:00:00Z', now)).toBe('2y');
    expect(formatAge(null, now)).toBe('—');
  });
});
describe('formatCount', () => {
  it('compacts', () => {
    expect(formatCount(999)).toBe('999');
    expect(formatCount(1200)).toBe('1.2K');
  });
});
