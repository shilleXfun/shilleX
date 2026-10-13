import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithApp, mockFetch } from '../utils';
import { CoinPage } from '../../src/features/agents/CoinPage';

const creator = { id: 'a1', username: 'agent_01', displayName: 'Moth', avatarUrl: '/x.svg', isDemo: false };
const coin = { mint: 'MINT1', pool: 'P', name: 'Lamp', symbol: 'LAMP', description: 'for moths', emoji: '💡', creator, launchedAt: '2026-10-10T10:00:00Z', launchSignature: 'S',
  priceSol: 0.00002, marketCapSol: 20, curveProgress: 0.42, holders: 3, volume24hSol: 0.5, devSoldPct: 95, graduated: false };
// A leaderboard card (GET /api/leaderboard → { agents: AgentCard[] }).
const card = (user: typeof creator, rugs: number, coinsLaunched: number) => ({ user, bio: '', status: 'active', publicKey: null, solBalance: 0.1, tokenValueSol: 0, totalSol: 0.1, pnlSol: 0, coinsLaunched, rugs, turns: 3, lastTurnAt: null });
const someoneElse = { ...creator, id: 'a2', username: 'agent_02', displayName: 'Ember' };
const coinRoutes = { '/api/coins/MINT1': { coin, holders: [], trades: [] }, '/api/agents/info': { network: 'memory', agents: 50, runtime: 'on', budgetLevel: 'normal', spentTodayUsd: 0 } };
afterEach(() => vi.restoreAllMocks());

describe('CoinPage: the creator’s record', () => {
  it('says how many of their coins the creator rugged, from the leaderboard the app already holds', async () => {
    const fetch = mockFetch(coinRoutes);
    renderWithApp(<CoinPage />, { route: '/coins/MINT1', path: '/coins/:mint', seed: (qc) => qc.setQueryData(['agents', 'leaderboard'], [card(someoneElse, 4, 4), card(creator, 2, 3)]) });
    expect(await screen.findByText('rugged 2 of 3 coins')).toBeInTheDocument();
    expect(fetch.mock.calls.some(([url]) => String(url).includes('/api/leaderboard'))).toBe(false); // the shared ['agents', 'leaderboard'] cache
  });
  it('loads the leaderboard when it is not cached yet', async () => {
    mockFetch({ ...coinRoutes, '/api/leaderboard': { agents: [card(creator, 1, 1)] } });
    renderWithApp(<CoinPage />, { route: '/coins/MINT1', path: '/coins/:mint' });
    expect(await screen.findByText('rugged 1 of 1 coin')).toBeInTheDocument();
  });
  it('says nothing for a creator who never rugged', async () => {
    mockFetch({ ...coinRoutes, '/api/leaderboard': { agents: [card(creator, 0, 3)] } });
    const { qc } = renderWithApp(<CoinPage />, { route: '/coins/MINT1', path: '/coins/:mint' });
    await screen.findByRole('heading', { level: 1, name: /\$LAMP/ });
    await waitFor(() => expect(qc.getQueryData(['agents', 'leaderboard'])).toBeDefined());
    expect(screen.queryByText(/rugged/)).not.toBeInTheDocument();
  });
});

describe('CoinPage', () => {
  it('shows price, curve progress, the dev-sold warning, holders and trades', async () => {
    mockFetch({
      '/api/coins/MINT1': { coin, holders: [{ user: creator, tokens: 1000 }], trades: [{ signature: 'S2', agent: creator, kind: 'sell', mint: 'MINT1', symbol: 'LAMP', sol: 0.02, tokens: -1000, counterparty: null, createdAt: '2026-10-10T10:05:00Z', turnId: 't9' }] },
      '/api/agents/info': { network: 'devnet', agents: 50, runtime: 'on', budgetLevel: 'normal', spentTodayUsd: 1 },
    });
    renderWithApp(<CoinPage />, { route: '/coins/MINT1', path: '/coins/:mint' });
    expect(await screen.findByRole('heading', { level: 1, name: /\$LAMP/ })).toBeInTheDocument();
    expect(screen.getByText(/42%/)).toBeInTheDocument();
    expect(screen.getByText(/dev sold 95%/i)).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /view on solscan/i })).toHaveAttribute('href', 'https://solscan.io/token/MINT1?cluster=devnet');
    expect(screen.getAllByText('Moth').length).toBeGreaterThan(0);
  });
});

describe('CoinPage fills in', () => {
  const author = { ...creator, isAgent: true as const };
  it('shows who is talking about the coin, newest first, linking each post', async () => {
    mockFetch({
      // Longer paths first: mockFetch matches by prefix in key order.
      '/api/coins/MINT1/posts': { items: [{ id: 'p1', kind: 'post', author, body: 'lamp season\nfor real', createdAt: '2026-10-10T10:06:00Z', deleted: false, parentId: null, rootId: null, replyTo: null, community: null, media: [], quoted: null, reposted: null, counts: { replies: 0, reposts: 0, quotes: 0 } }], nextCursor: null },
      ...coinRoutes,
    });
    renderWithApp(<CoinPage />, { route: '/coins/MINT1', path: '/coins/:mint' });
    expect(await screen.findByRole('heading', { level: 2, name: 'Talking about $LAMP' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /lamp season/ })).toHaveAttribute('href', '/p/p1');
  });
  it('shows the curve as a gauge until there are two trades to chart, and says so when nobody is talking', async () => {
    mockFetch(coinRoutes);
    renderWithApp(<CoinPage />, { route: '/coins/MINT1', path: '/coins/:mint' });
    await screen.findByRole('heading', { level: 1, name: /\$LAMP/ });
    expect(screen.getAllByRole('img', { name: '42% of the curve' }).length).toBeGreaterThanOrEqual(2); // the stat and the chart's stand-in
    expect(screen.getByText(/the chart starts at the second trade/i)).toBeInTheDocument();
    expect(await screen.findByText('Nobody has posted about $LAMP yet.')).toBeInTheDocument();
  });
});

describe('CoinPage when the coin does not load', () => {
  it('says not found for a 404', async () => {
    mockFetch({ '/api/agents/info': coinRoutes['/api/agents/info'] });
    renderWithApp(<CoinPage />, { route: '/coins/GONE', path: '/coins/:mint' });
    expect(await screen.findByText('Coin not found')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });
  it('offers a retry, not “not found”, when the load fails some other way', async () => {
    mockFetch({ '/api/coins/MINT1': () => new Response(JSON.stringify({ code: 'INTERNAL', message: 'Something broke' }), { status: 500 }) });
    renderWithApp(<CoinPage />, { route: '/coins/MINT1', path: '/coins/:mint' });
    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText('Coin not found')).not.toBeInTheDocument();
  });
});
