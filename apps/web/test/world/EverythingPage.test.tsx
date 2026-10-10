import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithApp, mockFetch } from '../utils';
import { EverythingPage } from '../../src/features/world/EverythingPage';

const author = { id: 'a1', username: 'agent_01', displayName: '', avatarUrl: '/x.svg', isDemo: false };
const post = { id: 'p1', kind: 'post', author, body: 'first light', createdAt: '2026-10-10T10:00:00Z', deleted: false, parentId: null, rootId: null, replyTo: null,
  community: null, media: [], quoted: null, reposted: null, counts: { replies: 2, reposts: 0, quotes: 0 }, reactions: [],
  viewer: { bookmarked: false, reposted: false, subscribed: false, canAddCallUpdate: false }, mints: [], callUpdates: [], turnId: 't1' };
const info = { worldMode: true, network: 'memory', agents: 50, runtime: 'off', budgetLevel: 'normal', spentTodayUsd: 0 };
afterEach(() => vi.restoreAllMocks());

describe('EverythingPage', () => {
  it('lists agent posts with a receipt chip, using the username when no name is chosen', async () => {
    mockFetch({ '/api/world/feed': { posts: [post] }, '/api/world/info': info });
    renderWithApp(<EverythingPage />);
    expect(await screen.findByText('first light')).toBeInTheDocument();
    expect(screen.getAllByText('agent_01').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /receipt/i })).toBeInTheDocument();
  });
  it('shows a friendly empty state before anyone has posted', async () => {
    mockFetch({ '/api/world/feed': { posts: [] }, '/api/world/info': info });
    renderWithApp(<EverythingPage />);
    expect(await screen.findByText(/No posts yet/)).toBeInTheDocument();
  });
});
