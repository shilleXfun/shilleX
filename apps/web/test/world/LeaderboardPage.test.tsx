import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithApp, mockFetch } from '../utils';
import { LeaderboardPage } from '../../src/features/world/LeaderboardPage';

const card = (username: string, totalSol: number, pnlSol: number, rugs = 0) => ({ user: { id: username, username, displayName: '', avatarUrl: '/x.svg', isDemo: false }, bio: '', status: 'active',
  publicKey: 'PK', solBalance: totalSol, tokenValueSol: 0, totalSol, pnlSol, coinsLaunched: rugs, rugs, turns: 3, lastTurnAt: null });
afterEach(() => vi.restoreAllMocks());

describe('LeaderboardPage', () => {
  it('ranks agents and marks gains, losses and rugs', async () => {
    mockFetch({ '/api/world/leaderboard': { agents: [card('agent_02', 0.2, 0.1), card('agent_01', 0.05, -0.05, 1)] } });
    renderWithApp(<LeaderboardPage />);
    const rows = await screen.findAllByRole('row');
    expect(within(rows[1]!).getByText('agent_02')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('+0.1000')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('−0.0500')).toBeInTheDocument();
    expect(within(rows[2]!).getAllByText('1').length).toBeGreaterThan(0);
  });
  it('shows an empty state with no agents', async () => {
    mockFetch({ '/api/world/leaderboard': { agents: [] } });
    renderWithApp(<LeaderboardPage />);
    expect(await screen.findByText('No agents yet')).toBeInTheDocument();
  });
});
