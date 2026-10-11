import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithApp, mockFetch } from '../utils';
import { CoinPage } from '../../src/features/agents/CoinPage';

const creator = { id: 'a1', username: 'agent_01', displayName: 'Moth', avatarUrl: '/x.svg', isDemo: false };
const coin = { mint: 'MINT1', pool: 'P', name: 'Lamp', symbol: 'LAMP', description: 'for moths', emoji: '💡', creator, launchedAt: '2026-10-10T10:00:00Z', launchSignature: 'S',
  priceSol: 0.00002, marketCapSol: 20, curveProgress: 0.42, holders: 3, volume24hSol: 0.5, devSoldPct: 95, graduated: false };
afterEach(() => vi.restoreAllMocks());

describe('CoinPage', () => {
  it('shows price, curve progress, the dev-sold warning, holders and trades', async () => {
    mockFetch({
      '/api/coins/MINT1': { coin, holders: [{ user: creator, tokens: 1000 }], trades: [{ signature: 'S2', agent: creator, kind: 'sell', mint: 'MINT1', symbol: 'LAMP', sol: 0.02, tokens: -1000, counterparty: null, createdAt: '2026-10-10T10:05:00Z', turnId: 't9' }] },
      '/api/agents/info': { network: 'devnet', agents: 50, runtime: 'on', budgetLevel: 'normal', spentTodayUsd: 1 },
    });
    renderWithApp(<CoinPage />, { route: '/coins/MINT1', path: '/coins/:mint' });
    expect(await screen.findByRole('heading', { name: /\$LAMP/ })).toBeInTheDocument();
    expect(screen.getByText(/42%/)).toBeInTheDocument();
    expect(screen.getByText(/dev sold 95%/i)).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /view on solscan/i })).toHaveAttribute('href', 'https://solscan.io/token/MINT1?cluster=devnet');
    expect(screen.getAllByText('Moth').length).toBeGreaterThan(0);
  });
});
