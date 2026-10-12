import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithApp, mockFetch } from '../utils';
import { AgentsPage } from '../../src/features/agents/AgentsPage';
import { CoinsPage } from '../../src/features/agents/CoinsPage';
import { LeaderboardPage } from '../../src/features/agents/LeaderboardPage';
import { TimesPage } from '../../src/features/agents/TimesPage';

// A deployment without an agent world has none of the agent routes: every GET answers 404 (mockFetch({}) does just that).
const info = { network: 'memory', agents: 50, runtime: 'on', budgetLevel: 'normal', spentTodayUsd: 0 };
const broke = () => new Response(JSON.stringify({ code: 'INTERNAL', message: 'Something broke' }), { status: 500 });
afterEach(() => vi.restoreAllMocks());

describe('agent pages without an agent world', () => {
  it('Agents says so instead of "Couldn’t load this"', async () => {
    mockFetch({});
    renderWithApp(<AgentsPage />);
    expect(await screen.findByText('No agent world here')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });
  it('Coins says so instead of showing only its title', async () => {
    mockFetch({});
    renderWithApp(<CoinsPage />);
    expect(await screen.findByText('No agent world here')).toBeInTheDocument();
  });
  it('Leaderboard says so, and drops its intro line', async () => {
    mockFetch({});
    renderWithApp(<LeaderboardPage />);
    expect(await screen.findByText('No agent world here')).toBeInTheDocument();
    expect(screen.queryByText(/everyone started with/i)).not.toBeInTheDocument();
  });
  it('Times says so instead of promising an edition at midnight', async () => {
    mockFetch({});
    renderWithApp(<TimesPage />, { route: '/times', path: '/times' });
    expect(await screen.findByText('No agent world here')).toBeInTheDocument();
    expect(screen.queryByText(/first edition/i)).not.toBeInTheDocument();
  });
  it('Times still explains a missing edition where there is a world', async () => {
    mockFetch({ '/api/agents/info': info });
    renderWithApp(<TimesPage />, { route: '/times', path: '/times' });
    expect(await screen.findByText(/first edition comes out at midnight utc/i)).toBeInTheDocument();
    expect(screen.queryByText('No agent world here')).not.toBeInTheDocument();
  });
});

describe('agent pages that fail for another reason', () => {
  it('Coins offers a retry on a server error', async () => {
    mockFetch({ '/api/coins': broke });
    renderWithApp(<CoinsPage />);
    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText('No agent world here')).not.toBeInTheDocument();
  });
  it('Leaderboard offers a retry on a server error', async () => {
    mockFetch({ '/api/leaderboard': broke });
    renderWithApp(<LeaderboardPage />);
    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
  it('Agents offers a retry on a server error', async () => {
    mockFetch({ '/api/agents/overview': broke });
    renderWithApp(<AgentsPage />);
    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('No agent world here')).not.toBeInTheDocument());
  });
});
