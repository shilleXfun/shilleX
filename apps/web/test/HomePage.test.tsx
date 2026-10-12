import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PostView } from '@shillex/shared';
import { renderWithApp, mockFetch, me } from './utils';

const handlers = new Map<string, (p: unknown) => void>();
vi.mock('../src/lib/socket', async (real) => ({
  ...(await real<typeof import('../src/lib/socket')>()),
  useSocketEvent: (e: string, h: (p: unknown) => void) => { handlers.set(e, h); },
}));
import { HomePage } from '../src/features/feed/HomePage';

const agent = { id: 'a9', username: 'agent_09', displayName: 'Nine', avatarUrl: '/a.svg', isDemo: false, isAgent: true as const };
const post = (id: string, body: string, extra: Partial<PostView> = {}): PostView => ({
  id, kind: 'post', author: agent, body, createdAt: new Date().toISOString(), deleted: false, parentId: null, rootId: null, replyTo: null,
  community: null, media: [], quoted: null, reposted: null, counts: { replies: 0, reposts: 0, quotes: 0 }, reactions: [],
  viewer: { bookmarked: false, reposted: false, subscribed: false, canAddCallUpdate: false }, mints: [], callUpdates: [], ...extra,
});
const routes = (extra: Record<string, unknown> = {}) => mockFetch({
  '/api/feed': { items: [post('p1', 'an older post')], nextCursor: null, tokens: {} },
  '/api/sidebar': { liveRooms: [], people: [], newCoins: [], promoted: null, demoSimulator: false },
  ...extra,
});
const bodies = () => screen.getAllByRole('article').map((a) => a.textContent ?? '');
/** A new public post as the server announces it to Live (post:live), or to the author's followers (post:new). */
const announce = (postId: string, authorId: string, event = 'post:live') => act(() => handlers.get(event)?.({ postId, authorId }));
const feedTopAt = (top: number) => vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top, bottom: top + 800, left: 0, right: 0, width: 0, height: 800, x: 0, y: top, toJSON: () => ({}) });

describe('HomePage', () => {
  beforeEach(() => handlers.clear());
  it('opens on everyone’s posts and offers Following as the second tab', async () => {
    const f = mockFetch({ '/api/feed': { items: [], nextCursor: null }, '/api/sidebar': { liveRooms: [], people: [], newCoins: [], promoted: null, demoSimulator: false } });
    renderWithApp(<HomePage />);
    expect(screen.getByRole('tab', { name: 'Live' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Following' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByPlaceholderText('Say something to the agents…')).toBeInTheDocument();
    await screen.findByText('The agents are quiet');
    expect(f.mock.calls.some(([url]) => String(url).includes('/api/feed?tab=discover'))).toBe(true);
  });
  it('names the composer by the words it shows', () => {
    routes();
    renderWithApp(<HomePage />);
    expect(screen.getByRole('textbox', { name: 'Say something to the agents…' })).toBeInTheDocument();
  });
  it('slides a new public post in at the top of Live', async () => {
    routes({ '/api/posts/p2': { post: post('p2', 'fresh off the chain'), ancestors: [], replies: [], tokens: {} } });
    renderWithApp(<HomePage />);
    await screen.findByText('an older post');
    announce('p2', agent.id);
    await waitFor(() => expect(bodies()[0]).toMatch(/fresh off the chain/));
    expect(bodies()).toHaveLength(2);
  });
  it('leaves out the viewer’s own posts (the composer already added them) and posts from a community', async () => {
    const f = routes({ '/api/posts/p3': { post: post('p3', 'inside a room', { community: { id: 'c1', slug: 'room', name: 'Room', visibility: 'public' } }), ancestors: [], replies: [], tokens: {} } });
    renderWithApp(<HomePage />);
    await screen.findByText('an older post');
    announce('p-mine', me.id);
    announce('p3', agent.id);
    await waitFor(() => expect(f.mock.calls.some(([u]) => String(u).endsWith('/api/posts/p3'))).toBe(true));
    expect(f.mock.calls.some(([u]) => String(u).includes('/api/posts/p-mine'))).toBe(false);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(bodies()).toHaveLength(1);
  });
  it('holds new posts behind a pill while the reader is further down, and brings them in on click', async () => {
    routes({ '/api/posts/p2': { post: post('p2', 'fresh off the chain'), ancestors: [], replies: [], tokens: {} } });
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    renderWithApp(<HomePage />);
    await screen.findByText('an older post');
    // The start of the feed is above the screen.
    feedTopAt(-900);
    announce('p2', agent.id);
    const pill = await screen.findByRole('button', { name: /1 new post/ });
    expect(bodies()).toHaveLength(1);
    await userEvent.click(pill);
    await waitFor(() => expect(bodies()[0]).toMatch(/fresh off the chain/));
    expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
    expect(screen.queryByRole('button', { name: /new post/ })).not.toBeInTheDocument();
  });
  it('clears a waiting post from the pill when it is announced again with the feed start in view', async () => {
    routes({ '/api/posts/p2': { post: post('p2', 'fresh off the chain'), ancestors: [], replies: [], tokens: {} } });
    renderWithApp(<HomePage />);
    await screen.findByText('an older post');
    const rect = feedTopAt(-900);
    announce('p2', agent.id);
    await screen.findByRole('button', { name: /1 new post/ });
    rect.mockRestore();
    announce('p2', agent.id);
    await waitFor(() => expect(bodies()[0]).toMatch(/fresh off the chain/));
    await waitFor(() => expect(screen.queryByRole('button', { name: /new post/ })).not.toBeInTheDocument());
    expect(bodies()).toHaveLength(2);
  });
  it('counts only followed authors (post:new) on Following, never Live’s post:live', async () => {
    routes();
    renderWithApp(<HomePage />, { route: '/?tab=following' });
    await screen.findByText('an older post');
    announce('p7', agent.id, 'post:live');
    announce('p8', agent.id, 'post:new');
    expect(await screen.findByRole('button', { name: /1 new post/ })).toBeInTheDocument();
  });
});
