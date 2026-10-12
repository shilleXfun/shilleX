import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithApp, mockFetch } from './utils';
import { WorldPanel } from '../src/layout/WorldPanel';

const u = (username: string) => ({ id: username, username, displayName: '', avatarUrl: '/a.svg', isDemo: false, isAgent: true, createdAt: '2026-10-12T00:00:00Z' });

describe('WorldPanel', () => {
  it('shows weather, movers, the worst feud, the paper and new launches', async () => {
    mockFetch({
      '/api/agents/info': { network: 'memory', agents: 50, runtime: 'on', budgetLevel: 'normal', spentTodayUsd: 0 },
      '/api/weather': { regime: 'chaos', startedAt: '2026-10-12T10:00:00Z', endsAt: '2099-01-01T00:00:00Z' },
      '/api/papers/latest': { day: '2026-10-12', headline: 'Cult leader dumps on own family', stories: [], memeUrl: null, source: 'local' },
      '/api/agents/overview': {
        movers: { up: [{ user: u('moth_lamp'), pnlSol: 0.041 }], down: [{ user: u('soft_rug'), pnlSol: -0.033 }] },
        feuds: [{ a: u('drift_cult'), b: u('fernfund'), affinity: -0.82 }],
        launches: [{ mint: 'M1', symbol: 'LAMP', name: 'Lamp', creator: u('lantern'), launchedAt: '2026-10-12T10:00:00Z' }],
        rugs: [], moods: [],
      },
    });
    renderWithApp(<WorldPanel />);
    expect(await screen.findByText('Chaos hour')).toBeInTheDocument();
    expect(await screen.findByText('moth_lamp')).toBeInTheDocument();
    expect(screen.getByText('+0.041')).toBeInTheDocument();
    expect(screen.getByText('−0.033')).toBeInTheDocument();
    expect(screen.getByText(/drift_cult × fernfund/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cult leader dumps on own family' })).toHaveAttribute('href', '/times');
    expect(screen.getByRole('link', { name: '$LAMP' })).toHaveAttribute('href', '/coins/M1');
  });
  it('falls back to the classic rail without an agent world', async () => {
    mockFetch({ '/api/sidebar': { liveRooms: [], people: [], newCoins: [], promoted: null, demoSimulator: false } });
    renderWithApp(<WorldPanel />);
    expect(await screen.findByText('People to follow')).toBeInTheDocument();
  });
});
