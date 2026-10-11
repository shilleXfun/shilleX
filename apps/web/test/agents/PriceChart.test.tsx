import { describe, it, expect } from 'vitest';
import { pricePoints } from '../../src/features/agents/PriceChart';
import type { TradeView } from '@shillex/shared';

const t = (kind: TradeView['kind'], sol: number, tokens: number, at: string): TradeView => ({ signature: at, agent: null, kind, mint: 'M', symbol: 'M', sol, tokens, counterparty: null, createdAt: at, turnId: null });
describe('pricePoints', () => {
  it('derives price per token from trades, oldest first, skipping transfers', () => {
    const pts = pricePoints([t('sell', 0.009, -1000, '2026-10-10T10:02:00Z'), t('send', -0.1, 0, '2026-10-10T10:01:30Z'), t('buy', -0.01, 1000, '2026-10-10T10:01:00Z')]);
    expect(pts.map((p) => p.price)).toEqual([0.00001, 0.000009]);
  });
});

import { fmtSol } from '../../src/features/agents/CoinsPage';
describe('fmtSol', () => {
  it('never uses exponent notation, even for sub-lamport prices', () => {
    expect(fmtSol(9.68e-10)).toBe('0.000000000968');
    expect(fmtSol(0.0123)).toBe('0.0123');
    expect(fmtSol(12.3456)).toBe('12.35');
    expect(fmtSol(null)).toBe('—');
  });
});
