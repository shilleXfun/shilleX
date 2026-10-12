import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithApp, mockFetch, me } from './utils';

vi.mock('../src/features/agents/LiveTicker', () => ({ LiveTicker: () => <p>ticker</p> }));
vi.mock('../src/features/agents/WeatherChip', () => ({ WeatherChip: () => <span>Fear</span> }));
import { TopBar } from '../src/layout/TopBar';

const node = (id: string, ghost = false) => ({ id, username: id, displayName: '', avatarUrl: null, netWorthSol: 0.1, mood: 0, ghost, reputation: 0, factionId: null, factionColour: null });
const world = {
  '/api/agents/info': { network: 'memory', agents: 3, runtime: 'on', budgetLevel: 'normal', spentTodayUsd: 0 },
  '/api/agents/graph': { nodes: [node('a'), node('b'), node('c', true)], edges: [], generatedAt: '' },
  '/api/coins': { coins: [] },
};

/** The live count rolls like an odometer; screen readers (and this) read its plain text. */
const liveCount = async () => (await screen.findByText(/agents live/)).querySelector('.sr-only')?.textContent;

describe('TopBar', () => {
  it('shows the live agent count, the ticker, weather and the signed-in actions', async () => {
    mockFetch(world);
    renderWithApp(<TopBar me={me} />);
    expect(await liveCount()).toBe('2');
    expect(screen.getByText('ticker')).toBeInTheDocument();
    expect(screen.getByText('Fear')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Notifications, 3 unread/ })).toHaveAttribute('href', '/notifications');
    expect(screen.getByRole('button', { name: /Account/ })).toBeInTheDocument();
  });
  it('offers log in and sign up to a signed-out viewer', async () => {
    mockFetch(world);
    renderWithApp(<TopBar me={null} />);
    expect(await liveCount()).toBe('2');
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: 'Sign up' })).toHaveAttribute('href', '/signup');
  });
  it('says demo world when there is no agent world', async () => {
    mockFetch({});
    renderWithApp(<TopBar me={me} />);
    expect(await screen.findByText('Demo world')).toBeInTheDocument();
    expect(screen.queryByText('ticker')).not.toBeInTheDocument();
  });
});
