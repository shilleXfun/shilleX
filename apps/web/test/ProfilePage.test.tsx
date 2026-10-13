import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router';
import { renderWithApp, mockFetch } from './utils';
import { ProfilePage } from '../src/features/profile/ProfilePage';

const profile = { id: 'x', username: 'alpha_jane', displayName: 'Jane', avatarUrl: '/a.svg', isDemo: true, bannerUrl: '/b.svg', bio: 'reads contracts', links: [{ label: 'X', url: 'https://x.com/jane' }], createdAt: '2025-01-01T00:00:00Z', followers: 120, following: 40, isSelf: false, isFollowing: false, followsYou: true, isMuted: false, isBlocked: false, wallets: [] };
const route = (p: object) => mockFetch({ '/api/users/alpha_jane/posts': { items: [], nextCursor: null }, '/api/users/alpha_jane': { profile: p } });

describe('ProfilePage', () => {
  it('shows identity, counts, links, follow, demo persona note; no wallet unless shared', async () => {
    route(profile);
    renderWithApp(<Routes><Route path="/u/:username" element={<ProfilePage />} /></Routes>, { route: '/u/alpha_jane' });
    expect(await screen.findByRole('heading', { name: 'Jane' })).toBeInTheDocument();
    expect(screen.getByText('Follows you')).toBeInTheDocument();
    expect(screen.getByText(/Fictional demo persona/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'X' })).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    expect(screen.getByRole('button', { name: 'Follow' })).toBeInTheDocument();
    expect(screen.queryByText(/Wallet/)).toBeNull();
    expect(screen.queryByText(/win rate|pnl|profit/i)).toBeNull();
  });
  it('has a Calls tab that loads their calls under a not-verified note', async () => {
    const f = route(profile);
    renderWithApp(<Routes><Route path="/u/:username" element={<ProfilePage />} /></Routes>, { route: '/u/alpha_jane?tab=calls' });
    expect(await screen.findByText(/Calls are self-reported/)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Calls' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('No calls yet')).toBeInTheDocument();
    expect(f.mock.calls.some(([u]) => String(u).includes('/api/users/alpha_jane/posts?tab=calls'))).toBe(true);
  });
  it('shows signed wallets as chips that say when they were signed', async () => {
    route({ ...profile, wallets: [{ address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', walletName: 'Phantom', verifiedAt: '2026-10-01T00:00:00.000Z' }] });
    renderWithApp(<Routes><Route path="/u/:username" element={<ProfilePage />} /></Routes>, { route: '/u/alpha_jane' });
    const chips = await screen.findByRole('list', { name: 'Wallets' });
    expect(within(chips).getByText('DezX…263')).toBeInTheDocument();
    expect(within(chips).getByTitle(/^Signed by this wallet on /)).toBeInTheDocument();
    expect(screen.queryByText(/not implemented/)).toBeNull();
  });
  it('writes the join date in English, whatever the browser’s locale', async () => {
    route({ ...profile, createdAt: '2026-10-01T00:00:00Z' });
    renderWithApp(<Routes><Route path="/u/:username" element={<ProfilePage />} /></Routes>, { route: '/u/alpha_jane' });
    expect(await screen.findByText(/Joined October 2026/)).toBeInTheDocument();
  });
  it('fills a new human’s own empty profile with agents to follow and a way to say hi', async () => {
    const agent = (id: string, turns: number) => ({ user: { id, username: id, displayName: '', avatarUrl: '/x.svg', isDemo: false, isAgent: true, createdAt: '2026-10-01T00:00:00Z' }, bio: '', status: 'active', publicKey: null, solBalance: 0.1, tokenValueSol: 0, totalSol: 0.1, pnlSol: 0, coinsLaunched: 0, rugs: 0, turns, lastTurnAt: null });
    mockFetch({
      '/api/agents/info': { network: 'memory', agents: 50, runtime: 'on', budgetLevel: 'normal', spentTodayUsd: 0 },
      '/api/leaderboard': { agents: [agent('quiet_moth', 2), agent('loud_lamp', 9)] },
      '/api/users/demo/posts': { items: [], nextCursor: null },
      '/api/users/demo': { profile: { ...profile, id: 'u1', username: 'demo', displayName: 'You', isDemo: false, isSelf: true, followsYou: false, createdAt: '2026-10-01T00:00:00Z' } },
    });
    renderWithApp(<Routes><Route path="/u/:username" element={<ProfilePage />} /></Routes>, { route: '/u/demo' });
    const hi = (await screen.findByRole('heading', { level: 2, name: 'Say hi' })).closest('section')!;
    expect(within(hi).getAllByRole('button', { name: 'Follow' })).toHaveLength(2);
    const sayHi = within(hi).getAllByRole('button', { name: 'Say hi' });
    expect(sayHi).toHaveLength(2);
    // The busiest agent first; its "Say hi" addresses Home's composer to it.
    await userEvent.click(sayHi[0]!);
    expect(localStorage.getItem('shillex:draft:u1:post:home')).toBe('@loud_lamp ');
  });
});
