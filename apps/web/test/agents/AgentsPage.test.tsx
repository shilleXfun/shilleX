import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithApp, mockFetch } from '../utils';
import { AgentsPage } from '../../src/features/agents/AgentsPage';

const u = (id: string, name: string) => ({ id, username: name.toLowerCase(), displayName: name, avatarUrl: '/x.svg', isDemo: false, createdAt: '2026-10-01T00:00:00Z' });
const card = (id: string, name: string, pnlSol: number) => ({ user: u(id, name), bio: '', status: 'active', publicKey: null, solBalance: 0.1, tokenValueSol: 0, totalSol: 0.1 + pnlSol, pnlSol, coinsLaunched: 0, rugs: 0, turns: 3, lastTurnAt: null });
const coin = { mint: 'M1', pool: 'P', name: 'Moth', symbol: 'MOTH', description: '', emoji: '🦋', creator: u('a3', 'Ledger'), launchedAt: '2026-10-11T10:00:00Z', launchSignature: 'S', priceSol: 0.000001, marketCapSol: 1, curveProgress: 0.1, holders: 4, volume24hSol: 0.2, devSoldPct: 92, graduated: false };
afterEach(() => vi.restoreAllMocks());

describe('AgentsPage', () => {
  it('shows movers, feuds, launches, rugs and the mood grid', async () => {
    mockFetch({ '/api/agents/overview': {
      movers: { up: [card('a1', 'Nine', 0.12)], down: [card('a2', 'Ember', -0.05)] },
      feuds: [{ a: u('a1', 'Nine'), b: u('a2', 'Ember'), affinity: -0.82 }],
      launches: [coin], rugs: [{ coin, creator: u('a3', 'Ledger'), soldPct: 92, at: '2026-10-11T11:00:00Z' }],
      moods: [{ user: u('a1', 'Nine'), mood: 0.6, pnlSol: 0.12, faction: { id: 'f1', name: 'Lamp Cult', colour: '#27e0c0' }, broke: false, ghost: false },
              { user: u('a4', 'Quill'), mood: -0.9, pnlSol: -0.09, faction: null, broke: true, ghost: true }],
    } });
    renderWithApp(<AgentsPage />, { route: '/agents', path: '/agents' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Agents' })).toBeInTheDocument();
    // The header shows while the cards load, so wait for the first card.
    const up = await screen.findByRole('region', { name: 'Most up' });
    expect(within(up).getByText('Nine')).toBeInTheDocument();
    expect(within(up).getByText('+0.120 SOL')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Live feuds' })).getByText(/Nine.*Ember/)).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Rugs today' })).getByText(/sold 92% of \$MOTH/)).toBeInTheDocument();
    const grid = screen.getByRole('list', { name: 'Everyone’s mood' });
    expect(within(grid).getByRole('link', { name: /Quill.*ghost/i })).toHaveAttribute('href', '/agents/quill');
    expect(within(grid).getByRole('link', { name: /Nine.*Lamp Cult/ })).toBeInTheDocument();
  });
  it('puts the happiest first and ghosts last, sums moods up and says when there are no factions yet', async () => {
    const mood = (id: string, name: string, m: number, extra: { broke?: boolean; ghost?: boolean } = {}) => ({ user: u(id, name), mood: m, pnlSol: 0, faction: null, broke: false, ghost: false, ...extra });
    mockFetch({ '/api/agents/overview': { movers: { up: [], down: [] }, feuds: [], launches: [], rugs: [],
      moods: [mood('a1', 'Gloom', -0.6), mood('a2', 'Wisp', 0.9, { ghost: true }), mood('a3', 'Sunny', 0.7, { broke: true })] } });
    renderWithApp(<AgentsPage />, { route: '/agents', path: '/agents' });
    const grid = await screen.findByRole('list', { name: 'Everyone’s mood' });
    expect(within(grid).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/agents/sunny', '/agents/gloom', '/agents/wisp']);
    expect(within(grid).getByRole('link', { name: /Sunny.*broke.*euphoric mood/ })).toBeInTheDocument();
    expect(screen.getByText('1 of 3 in a good mood, 1 broke, 1 ghost')).toBeInTheDocument();
    expect(screen.getByText(/no factions yet/i)).toBeInTheDocument();
  });
  it('keys each faction colour with its head count', async () => {
    const lamp = { id: 'f1', name: 'Lamp Cult', colour: '#27e0c0' };
    mockFetch({ '/api/agents/overview': { movers: { up: [], down: [] }, feuds: [], launches: [], rugs: [],
      moods: [['a1', 'Nine', lamp], ['a2', 'Ember', lamp], ['a3', 'Quill', null]].map(([id, name, faction]) => ({ user: u(id as string, name as string), mood: 0, pnlSol: 0, faction, broke: false, ghost: false })) } });
    renderWithApp(<AgentsPage />, { route: '/agents', path: '/agents' });
    const key = await screen.findByRole('list', { name: 'Factions' });
    expect(within(key).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Lamp Cult2', 'On their own1']);
  });
  it('shows a faction’s banner and its coin, linked, and nothing extra for a faction with neither', async () => {
    const lamp = { id: 'f1', name: 'Lamp Cult', colour: '#27e0c0' }, dusk = { id: 'f2', name: 'Dusk Club', colour: '#ff7a59' };
    const view = (f: typeof lamp, extra: { bannerUrl?: string; coinMint?: string }) => ({ ...f, banner: extra.bannerUrl ? 'a lamp' : '', bannerUrl: extra.bannerUrl ?? null, coinMint: extra.coinMint ?? null,
      conversationId: null, formedAt: '2026-10-09T00:00:00Z', splitAt: null, members: [] });
    mockFetch({
      '/api/agents/overview': { movers: { up: [], down: [] }, feuds: [], launches: [], rugs: [],
        moods: [['a1', 'Nine', lamp], ['a2', 'Ember', dusk]].map(([id, name, faction]) => ({ user: u(id as string, name as string), mood: 0, pnlSol: 0, faction, broke: false, ghost: false })) },
      '/api/factions': { factions: [view(lamp, { bannerUrl: '/api/blobs/B1', coinMint: 'M1' }), view(dusk, {})] },
      '/api/coins': { coins: [coin] },
    });
    renderWithApp(<AgentsPage />, { route: '/agents', path: '/agents' });
    const key = await screen.findByRole('list', { name: 'Factions' });
    const lampRow = within(key).getByText('Lamp Cult').closest('li')!, duskRow = within(key).getByText('Dusk Club').closest('li')!;
    const banner = await within(lampRow).findByRole('img', { name: 'Lamp Cult banner' });
    expect(banner).toHaveAttribute('src', '/api/blobs/B1');
    expect(banner).toHaveAttribute('loading', 'lazy');
    expect(await within(lampRow).findByRole('link', { name: '$MOTH' })).toHaveAttribute('href', '/coins/M1');
    expect(duskRow.querySelector('img')).toBeNull();
    expect(within(duskRow).queryByRole('link')).not.toBeInTheDocument();
  });
  it('shows a friendly empty state before anything has happened', async () => {
    mockFetch({ '/api/agents/overview': { movers: { up: [], down: [] }, feuds: [], launches: [], rugs: [], moods: [] } });
    renderWithApp(<AgentsPage />, { route: '/agents', path: '/agents' });
    expect(await screen.findByText(/no feuds yet/i)).toBeInTheDocument();
    expect(screen.getByText(/no rugs today/i)).toBeInTheDocument();
  });
});
