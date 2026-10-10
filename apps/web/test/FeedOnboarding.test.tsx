import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithApp, mockFetch } from './utils';
import { HomePage } from '../src/features/feed/HomePage';

const user = (id: string, name: string) => ({ id, username: id, displayName: name, avatarUrl: `/${id}.svg`, isDemo: true });
const community = (slug: string, name: string, myStatus: string | null) => ({ id: slug, slug, name, description: '', avatarUrl: '/c.svg', visibility: 'public', memberCount: 12, onlineCount: 2, myRole: null, myStatus, unread: 0, isDemo: true });
const discover = {
  liveRooms: [], newCoins: [], promoted: [],
  people: [{ user: user('tilly', 'Tilly'), reason: 'Active this week' }, { user: user('sue', 'Sue'), reason: 'Followed by @jo' }],
  communities: [community('trenches', 'The Trenches', null), community('beta', 'Beta Testers', 'active')],
};
const post = (id: string) => ({ id, kind: 'post', author: user('tilly', 'Tilly'), body: `post ${id}`, createdAt: new Date().toISOString(), deleted: false, parentId: null, rootId: null, replyTo: null, community: null, media: [], quoted: null, reposted: null, counts: { replies: 0, reposts: 0, quotes: 0 }, reactions: [], viewer: { reposted: false, bookmarked: false, subscribed: false }, mints: [], callUpdates: [] });

describe('first-run Home', () => {
  it('an empty Following feed offers people to follow and rooms you have not joined', async () => {
    mockFetch({ '/api/feed': { items: [], nextCursor: null, tokens: {} }, '/api/discover': discover, '/api/sidebar': { liveRooms: [], people: [], newCoins: [], promoted: null, demoSimulator: false } });
    renderWithApp(<HomePage />);
    expect(await screen.findByRole('heading', { name: 'Your feed is quiet. Let’s fill it.' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Tilly' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Follow' })).toHaveLength(2);
    expect(screen.getByRole('link', { name: /The Trenches/ })).toHaveAttribute('href', '/c/trenches');
    expect(screen.queryByRole('link', { name: /Beta Testers/ })).toBeNull();
  });
  it('a sparse feed keeps suggestions below its posts', async () => {
    mockFetch({ '/api/feed': { items: [post('p1'), post('p2')], nextCursor: null, tokens: {} }, '/api/discover': discover, '/api/sidebar': { liveRooms: [], people: [], newCoins: [], promoted: null, demoSimulator: false } });
    renderWithApp(<HomePage />);
    expect(await screen.findByText('post p1')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Find more to follow' })).toBeInTheDocument();
  });
});
