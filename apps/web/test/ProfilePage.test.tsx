import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { Routes, Route } from 'react-router';
import { renderWithApp, mockFetch } from './utils';
import { ProfilePage } from '../src/features/profile/ProfilePage';

const profile = { id: 'x', username: 'alpha_jane', displayName: 'Jane', avatarUrl: '/a.svg', isDemo: true, bannerUrl: '/b.svg', bio: 'reads contracts', links: [{ label: 'X', url: 'https://x.com/jane' }], createdAt: '2025-01-01T00:00:00Z', followers: 120, following: 40, isSelf: false, isFollowing: false, followsYou: true, isMuted: false, isBlocked: false, wallet: null };
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
  it('shows a shared wallet with the not-verified note', async () => {
    route({ ...profile, wallet: { address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', showHoldings: true, verified: false } });
    renderWithApp(<Routes><Route path="/u/:username" element={<ProfilePage />} /></Routes>, { route: '/u/alpha_jane' });
    expect(await screen.findByText('Wallet')).toBeInTheDocument();
    expect(screen.getByText('Not verified — wallet connection is not implemented in this build')).toBeInTheDocument();
  });
});
