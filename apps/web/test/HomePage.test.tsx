import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
const thread = (p: PostView) => ({ post: p, ancestors: [], replies: [], tokens: {} });
const SIDEBAR = { liveRooms: [{ community: { id: 'c1', slug: 'den', name: 'The Den' }, channel: { id: 'ch1', name: 'general' }, messagesLast15m: 3 }], people: [], newCoins: [], promoted: null, demoSimulator: false };
const INFO = { network: 'memory', agents: 50, runtime: 'on', budgetLevel: 'normal', spentTodayUsd: 0 };
const routes = (extra: Record<string, unknown> = {}) => mockFetch({
  '/api/feed': { items: [post('p1', 'an older post')], nextCursor: null, tokens: {} },
  '/api/sidebar': SIDEBAR,
  '/api/agents/info': INFO,
  ...extra,
});
const calls = (f: ReturnType<typeof mockFetch>, path: string) => f.mock.calls.filter(([u]) => String(u).replace(/^https?:\/\/[^/]+/, '') === path).length;
const bodies = () => screen.getAllByRole('article').map((a) => a.textContent ?? '');
/** A new public post as the server announces it to Live (post:live), or to the author's followers (post:new). */
const announce = (postId: string, authorId: string, event = 'post:live') => act(() => handlers.get(event)?.({ postId, authorId }));
const rect = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) });
const feedTopAt = (top: number) => vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect(top, top + 800));
const setVisibility = (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
};

describe('HomePage', () => {
  beforeEach(() => handlers.clear());
  afterEach(() => { Reflect.deleteProperty(document, 'visibilityState'); });
  it('opens on Live, the chronological list of every public post, and offers Following as the second tab', async () => {
    const f = mockFetch({ '/api/feed': { items: [], nextCursor: null }, '/api/agents/info': INFO });
    renderWithApp(<HomePage />);
    expect(screen.getByRole('tab', { name: 'Live' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Following' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByPlaceholderText('Say something to the agents…')).toBeInTheDocument();
    await screen.findByText('The agents are quiet');
    expect(f.mock.calls.some(([url]) => String(url).includes('/api/feed?tab=live'))).toBe(true);
    expect(f.mock.calls.some(([url]) => String(url).includes('tab=discover'))).toBe(false);
  });
  it('names the composer by the words it shows', () => {
    routes();
    renderWithApp(<HomePage />);
    expect(screen.getByRole('textbox', { name: 'Say something to the agents…' })).toBeInTheDocument();
  });
  it('slides a new public post in at the top of Live', async () => {
    routes({ '/api/posts/p2': thread(post('p2', 'fresh off the chain')) });
    renderWithApp(<HomePage />);
    await screen.findByText('an older post');
    announce('p2', agent.id);
    await waitFor(() => expect(bodies()[0]).toMatch(/fresh off the chain/));
    expect(bodies()).toHaveLength(2);
  });
  it('leaves out the viewer’s own posts (the composer already added them) and posts from a community', async () => {
    const f = routes({ '/api/posts/p3': thread(post('p3', 'inside a room', { community: { id: 'c1', slug: 'room', name: 'Room', visibility: 'public' } })) });
    renderWithApp(<HomePage />);
    await screen.findByText('an older post');
    announce('p-mine', me.id);
    announce('p3', agent.id);
    await waitFor(() => expect(calls(f, '/api/posts/p3')).toBe(1));
    expect(f.mock.calls.some(([u]) => String(u).includes('/api/posts/p-mine'))).toBe(false);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(bodies()).toHaveLength(1);
  });
  it('holds new posts behind a pill while the reader is further down, and brings them in on click', async () => {
    routes({ '/api/posts/p2': thread(post('p2', 'fresh off the chain')) });
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
  it('counts the start of the feed as out of sight while it sits under the sticky top bar and tabs', async () => {
    routes({ '/api/posts/p2': thread(post('p2', 'fresh off the chain')) });
    renderWithApp(<HomePage />);
    await screen.findByText('an older post');
    // The feed starts 60 px down the window, still behind the sticky header, whose bottom the pill holder marks (106 px).
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('role') === 'feed' ? rect(60, 900) : this.classList.contains('newPill') ? rect(106, 106) : rect(0, 0);
    });
    announce('p2', agent.id);
    expect(await screen.findByRole('button', { name: /1 new post/ })).toBeInTheDocument();
    expect(bodies()).toHaveLength(1);
  });
  it('puts a post in once and fetches it once, however often it is announced, and never fetches one already listed', async () => {
    const f = routes({ '/api/posts/p2': thread(post('p2', 'fresh off the chain')) });
    renderWithApp(<HomePage />);
    await screen.findByText('an older post');
    announce('p2', agent.id);
    announce('p2', agent.id);
    await waitFor(() => expect(bodies()[0]).toMatch(/fresh off the chain/));
    announce('p2', agent.id);
    announce('p1', agent.id);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(bodies()).toHaveLength(2);
    expect(calls(f, '/api/posts/p2')).toBe(1);
    expect(calls(f, '/api/posts/p1')).toBe(0);
  });
  it('fetches nothing while the page is hidden, and reloads Live once when the reader comes back', async () => {
    let fresh = false;
    const f = routes({
      '/api/feed': () => ({ items: fresh ? [post('p2', 'posted while away'), post('p1', 'an older post')] : [post('p1', 'an older post')], nextCursor: null, tokens: {} }),
    });
    renderWithApp(<HomePage />);
    await screen.findByText('an older post');
    const feedLoads = calls(f, '/api/feed?tab=live');
    setVisibility('hidden');
    announce('p2', agent.id);
    announce('p3', agent.id);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(f.mock.calls.some(([u]) => String(u).includes('/api/posts/'))).toBe(false);
    fresh = true;
    setVisibility('visible');
    await waitFor(() => expect(bodies()[0]).toMatch(/posted while away/));
    expect(calls(f, '/api/feed?tab=live')).toBe(feedLoads + 1);
    expect(f.mock.calls.some(([u]) => String(u).includes('/api/posts/'))).toBe(false);
  });
  it('counts posts missed while hidden on the pill when the reader comes back further down', async () => {
    const f = routes();
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    renderWithApp(<HomePage />);
    await screen.findByText('an older post');
    const feedLoads = calls(f, '/api/feed?tab=live');
    setVisibility('hidden');
    announce('p2', agent.id);
    announce('p2', agent.id);
    feedTopAt(-900);
    setVisibility('visible');
    const pill = await screen.findByRole('button', { name: /1 new post/ });
    expect(calls(f, '/api/feed?tab=live')).toBe(feedLoads);
    await userEvent.click(pill);
    await waitFor(() => expect(calls(f, '/api/feed?tab=live')).toBe(feedLoads + 1));
  });
  it('counts only followed authors (post:new) on Following, never Live’s post:live', async () => {
    routes();
    renderWithApp(<HomePage />, { route: '/?tab=following' });
    await screen.findByText('an older post');
    announce('p7', agent.id, 'post:live');
    announce('p8', agent.id, 'post:new');
    expect(await screen.findByRole('button', { name: /1 new post/ })).toBeInTheDocument();
  });
  it('leaves the legacy Active rooms strip out of an agent deployment (World now replaces it) and its poll with it', async () => {
    const f = routes();
    renderWithApp(<HomePage />);
    await screen.findByText('an older post');
    await waitFor(() => expect(calls(f, '/api/agents/info')).toBeGreaterThan(0));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.queryByRole('navigation', { name: 'Active rooms' })).not.toBeInTheDocument();
    expect(calls(f, '/api/sidebar')).toBe(0);
  });
  it('keeps the Active rooms strip where there is no agent world', async () => {
    mockFetch({ '/api/feed': { items: [post('p1', 'an older post')], nextCursor: null, tokens: {} }, '/api/sidebar': SIDEBAR });
    renderWithApp(<HomePage />);
    expect(await screen.findByRole('navigation', { name: 'Active rooms' })).toHaveTextContent('The Den');
  });
});
