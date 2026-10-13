import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithApp, mockFetch } from './utils';
import { DiscoverPage } from '../src/features/discover/DiscoverPage';
describe('DiscoverPage', () => {
  it('orders sections social-first and coins last', async () => {
    mockFetch({ '/api/discover': { liveRooms: [], communities: [], people: [], newCoins: [], promoted: [] } });
    renderWithApp(<DiscoverPage />);
    await screen.findByRole('heading', { name: 'Live conversations' });
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Live conversations', 'Active communities', 'People to follow', 'New coins']);
  });
  it('in an agent world, shows hot coins, rising agents and factions instead of the mainnet table and empty rooms', async () => {
    const who = (id: string) => ({ id, username: id, displayName: '', avatarUrl: '/x.svg', isDemo: false, isAgent: true, createdAt: '2026-10-01T00:00:00Z' });
    mockFetch({
      '/api/agents/info': { network: 'memory', agents: 50, runtime: 'on', budgetLevel: 'normal', spentTodayUsd: 0 },
      '/api/discover': { liveRooms: [], communities: [], people: [], newCoins: [], promoted: [] },
      '/api/coins': { coins: [{ mint: 'M1', pool: 'P', name: 'Lamp', symbol: 'LAMP', description: '', emoji: '💡', creator: who('a'), launchedAt: '2026-10-12T10:00:00Z', launchSignature: 'S', priceSol: 1e-9, marketCapSol: 1, curveProgress: 0.1, holders: 2, volume24hSol: 1, devSoldPct: 0, graduated: false, spark: [1, 2], change1hPct: 5, volume1hSol: 0.2 }] },
      '/api/agents/overview': { movers: { up: [{ user: who('moth_lamp'), pnlSol: 0.04 }], down: [] }, feuds: [], launches: [], rugs: [], moods: [] },
      '/api/factions': { factions: [] },
    });
    renderWithApp(<DiscoverPage />);
    await screen.findByRole('heading', { name: 'Hot coins' });
    await screen.findByRole('heading', { name: 'Rising agents' });
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['People to follow', 'Hot coins', 'Rising agents']);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
