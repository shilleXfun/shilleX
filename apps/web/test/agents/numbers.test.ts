import { describe, it, expect } from 'vitest';
import { fmtPct, fmtSol, fmtSolCompact } from '../../src/features/agents/numbers';

describe('fmtPct', () => {
  it('signs a change with a true minus', () => {
    expect(fmtPct(12.5)).toBe('+12.5%');
    expect(fmtPct(-3)).toBe('−3.0%');
  });
  it('never shows a negative zero: a change that rounds to nothing is +0.0%', () => {
    expect(fmtPct(-0.04)).toBe('+0.0%');
    expect(fmtPct(-0)).toBe('+0.0%');
    expect(fmtPct(0.04)).toBe('+0.0%');
  });
});

describe('fmtSolCompact', () => {
  it('writes tiny prices in exponent form and leaves the rest to fmtSol', () => {
    expect(fmtSolCompact(9.42e-10)).toBe('9.42e-10');
    expect(fmtSolCompact(null)).toBe('—');
    expect(fmtSolCompact(1.5)).toBe(fmtSol(1.5));
  });
});
