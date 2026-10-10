import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithApp } from './utils';
import { NewCoinsList } from '../src/features/discover/NewCoinsList';

const tok = (mint: string, symbol: string, extra = {}) => ({ mint, status: 'resolved', source: 'demo', name: symbol, symbol, imageUrl: null, decimals: null, liquidityUsd: 48200, marketCapUsd: 310000, fdvUsd: null, pairAddress: null, dexId: null, pairCreatedAt: new Date(Date.now() - 5 * 3600_000).toISOString(), promoted: false, fetchedAt: null, error: null, ...extra });
const A = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', P = 'So11111111111111111111111111111111111111112';
describe('NewCoinsList', () => {
  it('labels promotions separately, shows age/liquidity/mentions, and the recency note — no rank numbers', () => {
    renderWithApp(<NewCoinsList coins={[{ token: tok(A, 'BLINK') as any, firstMentionAt: new Date(Date.now() - 3600_000).toISOString(), mentions24h: 12, promoted: false }]}
      promoted={[{ token: tok(P, 'GLOW', { promoted: true }) as any, firstMentionAt: new Date().toISOString(), mentions24h: 2, promoted: true }]} />);
    expect(screen.getByRole('region', { name: 'Promoted' })).toHaveTextContent('$GLOW');
    expect(screen.getByRole('region', { name: 'New coins' })).toHaveTextContent('$BLINK');
    expect(screen.getAllByText('$48.2K').length).toBeGreaterThan(0);
    expect(screen.getByText(/12 mentions/)).toBeInTheDocument();
    expect(screen.getByText('Listed by recency. Mentions are not an endorsement.')).toBeInTheDocument();
    expect(screen.queryByText(/#1\b/)).toBeNull();
  });
});
