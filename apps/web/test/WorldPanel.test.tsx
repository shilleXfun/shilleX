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
  const world = () => ({
    '/api/agents/info': { network: 'memory', agents: 50, runtime: 'on', budgetLevel: 'normal', spentTodayUsd: 0 },
    '/api/weather': { regime: 'euphoria', startedAt: '2026-10-12T10:00:00Z', endsAt: '2099-01-01T00:00:00Z' },
    '/api/papers/latest': { day: '2026-10-12', headline: 'Moths everywhere', stories: [], memeUrl: null, source: 'local' },
    '/api/agents/overview': {
      movers: { up: [{ user: u('moth_lamp'), pnlSol: 0.041 }], down: [] }, feuds: [{ a: u('drift_cult'), b: u('fernfund'), affinity: -0.82 }],
      launches: [{ mint: 'M1', symbol: 'LAMP', name: 'Lamp', creator: u('lantern'), launchedAt: '2026-10-12T10:00:00Z' }], rugs: [], moods: [],
      today: { trades: 31, launches: 4, rugs: 1, volumeSol: 1.25 },
    },
    '/api/coins': { coins: [
      { mint: 'M1', pool: 'P', name: 'Lamp', symbol: 'LAMP', description: '', emoji: '💡', creator: u('lantern'), launchedAt: '2026-10-12T10:00:00Z', launchSignature: 'S', priceSol: 1e-9, marketCapSol: 1, curveProgress: 0.3, holders: 7, volume24hSol: 2, devSoldPct: 0, graduated: false, spark: [1, 2, 3], change1hPct: 12.5, volume1hSol: 0.4 },
      { mint: 'M2', pool: 'P', name: 'Moth', symbol: 'MOTH', description: '', emoji: '🦋', creator: u('lantern'), launchedAt: '2026-10-12T10:00:00Z', launchSignature: 'S', priceSol: 1e-9, marketCapSol: 1, curveProgress: 0.1, holders: 2, volume24hSol: 1, devSoldPct: 0, graduated: false, spark: [], change1hPct: null, volume1hSol: 0.1 },
    ] },
    '/api/factions': { factions: [
      { id: 'f1', name: 'Lamp Cult', banner: '', bannerUrl: null, colour: '#3DDBD9', coinMint: null, conversationId: null, formedAt: '2026-10-12T10:00:00Z', splitAt: null, members: [u('a'), u('b'), u('c')] },
      { id: 'f2', name: 'Fern Fund', banner: '', bannerUrl: null, colour: '#FF7A59', coinMint: null, conversationId: null, formedAt: '2026-10-12T10:00:00Z', splitAt: null, members: [u('d')] },
    ] },
  });
  it('fills the column: weather, today, movers, feud, hot coin, launches, factions, then the paper', async () => {
    mockFetch(world());
    renderWithApp(<WorldPanel />);
    expect(await screen.findByText('Lamp Cult')).toBeInTheDocument();
    expect(await screen.findByText('31')).toBeInTheDocument();
    await screen.findByRole('link', { name: 'Moths everywhere' });
    // A panel title carries its link's text too ("Movers All agents"), so each title is read by its leading words.
    const titles = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent ?? '');
    expect(titles.map((t) => /^(Market weather|Today|Movers|Live feud|Hot coin|New launches|Factions|The Shillex Times)/.exec(t)?.[1])).toEqual(['Market weather', 'Today', 'Movers', 'Live feud', 'Hot coin', 'New launches', 'Factions', 'The Shillex Times']);
    const hot = screen.getByRole('heading', { name: /^Hot coin/ }).closest('section')!;
    expect(hot).toHaveTextContent('$LAMP');
    expect(hot).toHaveTextContent('+12.5%');
  });
  it('leaves Movers out on /agents, which lists them itself', async () => {
    mockFetch(world());
    renderWithApp(<WorldPanel />, { route: '/agents' });
    await screen.findByText('Lamp Cult');
    expect(screen.queryByRole('heading', { name: /^Movers/ })).not.toBeInTheDocument();
  });
});
