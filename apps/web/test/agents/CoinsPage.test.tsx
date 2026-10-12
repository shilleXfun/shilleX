import { describe, it, expect, beforeEach } from 'vitest';
import { act, screen } from '@testing-library/react';
import { renderWithApp, mockFetch } from '../utils';
import { pushPulse, resetPulses } from '../../src/features/agents/pulses';
import { CoinsPage } from '../../src/features/agents/CoinsPage';
import { CoinPage } from '../../src/features/agents/CoinPage';

const creator = { id: 'a1', username: 'agent_01', displayName: 'Moth', avatarUrl: '/x.svg', isDemo: false, isAgent: true as const, createdAt: '2026-10-10T00:00:00Z' };
const coin = (mint: string, symbol: string) => ({ mint, pool: 'P', name: symbol, symbol, description: '', emoji: '💡', creator, launchedAt: '2026-10-10T10:00:00Z', launchSignature: 'S',
  priceSol: 0.00002, marketCapSol: 20, curveProgress: 0.42, holders: 3, volume24hSol: 0.5, devSoldPct: 5, graduated: false });
const pulse = (kind: 'buy' | 'sell' | 'launch' | 'rug', mint: string) => ({ kind, agentId: 'a1', mint, sol: 0.01, at: '2026-10-11T12:00:00Z' });
const row = (symbol: string) => screen.getByRole('link', { name: new RegExp(`\\$${symbol}`) }).closest('tr')!;

describe('coin flashes', () => {
  beforeEach(() => resetPulses());
  it('flashes a coin’s row green on a buy and red on a sale, restarting on each new trade', async () => {
    mockFetch({ '/api/coins': { coins: [coin('M1', 'LAMP'), coin('M2', 'MOTH')] } });
    renderWithApp(<CoinsPage />);
    await screen.findByRole('link', { name: /\$LAMP/ });
    expect(row('LAMP')).not.toHaveAttribute('data-flash');
    act(() => pushPulse(pulse('buy', 'M1')));
    expect(row('LAMP')).toHaveAttribute('data-flash', 'up');
    const beat = row('LAMP').getAttribute('data-beat');
    expect(row('MOTH')).not.toHaveAttribute('data-flash');
    act(() => pushPulse(pulse('rug', 'M1')));
    expect(row('LAMP')).toHaveAttribute('data-flash', 'down');
    expect(row('LAMP').getAttribute('data-beat')).not.toBe(beat);
  });
  it('does not flash for trades that happened before the page opened', async () => {
    pushPulse(pulse('buy', 'M1'));
    mockFetch({ '/api/coins': { coins: [coin('M1', 'LAMP')] } });
    renderWithApp(<CoinsPage />);
    await screen.findByRole('link', { name: /\$LAMP/ });
    expect(row('LAMP')).not.toHaveAttribute('data-flash');
  });
  it('flashes the price on a coin’s page for that coin only', async () => {
    mockFetch({ '/api/coins/M1': { coin: coin('M1', 'LAMP'), holders: [], trades: [] }, '/api/agents/info': { network: 'memory', agents: 1, runtime: 'on', budgetLevel: 'normal', spentTodayUsd: 0 } });
    renderWithApp(<CoinPage />, { route: '/coins/M1', path: '/coins/:mint' });
    await screen.findByRole('heading', { name: /\$LAMP/ });
    const stats = screen.getByText('Price').closest('dl')!;
    act(() => pushPulse(pulse('sell', 'M2')));
    expect(stats).not.toHaveAttribute('data-flash');
    act(() => pushPulse(pulse('sell', 'M1')));
    expect(stats).toHaveAttribute('data-flash', 'down');
  });
});
