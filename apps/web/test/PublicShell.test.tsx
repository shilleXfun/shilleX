import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, RouterProvider, createMemoryRouter, type RouteObject } from 'react-router';
import { me, mockFetch } from './utils';
vi.mock('../src/lib/socket', () => ({
  useSocketEvent: () => undefined, useRoom: () => undefined, useConnectionState: () => 'connected', joinRoom: () => () => undefined,
  socket: { connected: true, connect: () => undefined, disconnect: () => undefined, on: () => undefined, off: () => undefined, emit: () => undefined },
}));
vi.mock('../src/lib/liveSocket', () => ({ liveSocket: { connect: () => undefined, disconnect: () => undefined, on: () => undefined, off: () => undefined } }));
import { AuthOnly, MaybeAuthShell, Viewer } from '../src/layout/MaybeAuthShell';
import { PublicHome } from '../src/features/feed/PublicHome';
import { PublicThread } from '../src/features/feed/PublicThread';

const author = { id: 'a1', username: 'nine', displayName: 'Nine', avatarUrl: '/x.svg', isDemo: false, isAgent: true, createdAt: '2026-10-01T00:00:00Z' };
const post = { id: 'p1', kind: 'post', author, body: 'gm watchers', createdAt: '2026-10-11T10:00:00Z', deleted: false, parentId: null, rootId: null, replyTo: null, community: null,
  media: [{ url: '/api/blobs/m1', width: 1200, height: 675, alt: 'P&L card' }], quoted: null, reposted: null, counts: { replies: 0, reposts: 0, quotes: 0 }, reactions: [],
  viewer: { bookmarked: false, reposted: false, subscribed: false, canAddCallUpdate: false }, mints: [], callUpdates: [], turnId: null };
const signedOut = { '/api/auth/me': { user: null } };
const overview = { '/api/agents/overview': { movers: { up: [], down: [] }, feuds: [], launches: [], rugs: [], moods: [] } };
afterEach(() => vi.restoreAllMocks());

function app(route: string, children: RouteObject[] = [{ path: '/', element: <Viewer authed={<p>signed in home</p>} anon={<PublicHome />} /> }]) {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined); // ScrollRestoration; jsdom has no scrolling
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ element: <MaybeAuthShell />, children }], { initialEntries: [route] });
  return { router, ...render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>) };
}

describe('watching logged out', () => {
  it('shows the public feed with images and a sign-up prompt instead of a composer', async () => {
    mockFetch({ ...signedOut, '/api/feed/public': { items: [post], nextCursor: null, tokens: {} }, ...overview });
    app('/');
    expect(await screen.findByText('gm watchers')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'P&L card' })).toHaveAttribute('src', '/api/blobs/m1');
    expect(screen.getAllByRole('link', { name: /sign up/i }).map((a) => a.getAttribute('href'))).toContain('/signup?next=%2F');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Agents' })).toHaveAttribute('href', '/agents');
    // Signed-in sections are not offered to a visitor.
    expect(within(screen.getByRole('navigation', { name: 'Main' })).queryByRole('link', { name: /messages/i })).not.toBeInTheDocument();
  });

  it('shows a thread read-only, with a way in instead of the reply box', async () => {
    const reply = { ...post, id: 'p2', body: 'gm back', parentId: 'p1', rootId: 'p1', media: [], replyTo: { id: 'p1', author } };
    mockFetch({ ...signedOut, '/api/posts/p1': { post, ancestors: [], replies: [reply], tokens: {} } });
    app('/p/p1', [{ path: '/p/:id', element: <Viewer authed={<p>signed in thread</p>} anon={<PublicThread />} /> }]);
    expect(await screen.findByText('gm back')).toBeInTheDocument();
    expect(screen.getByText('gm watchers')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /sign up/i }).map((a) => a.getAttribute('href'))).toContain('/signup?next=%2Fp%2Fp1');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('says so when a post is not public', async () => {
    mockFetch({ ...signedOut, '/api/posts/p9': new Response(JSON.stringify({ code: 'NOT_FOUND', message: 'Post not found' }), { status: 404 }) });
    app('/p/p9', [{ path: '/p/:id', element: <Viewer authed={<p>signed in thread</p>} anon={<PublicThread />} /> }]);
    expect(await screen.findByText(/isn’t public/)).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login?next=%2Fp%2Fp9');
  });

  it('sends a visitor who opens a signed-in page to log in', async () => {
    mockFetch(signedOut);
    const { router } = app('/messages', [{ element: <AuthOnly />, children: [{ path: '/messages', element: <p>inbox</p> }] }]);
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toBe('?next=%2Fmessages');
    expect(screen.queryByText('inbox')).not.toBeInTheDocument();
  });
});

describe('watching signed in', () => {
  it('shows the signed-in page and keeps one shell between public and signed-in pages', async () => {
    mockFetch({ '/api/auth/me': { user: me }, '/api/conversations': { conversations: [] } });
    const { router } = app('/agents', [
      { path: '/agents', element: <><p>agents page</p><Link to="/messages">to the inbox</Link></> },
      { element: <AuthOnly />, children: [{ path: '/messages', element: <p>inbox</p> }] },
    ]);
    expect(await screen.findByText('agents page')).toBeInTheDocument();
    const bar = screen.getByRole('banner');
    expect(within(bar).getByRole('button', { name: /account/i })).toBeInTheDocument();
    await act(async () => { await router.navigate('/messages'); });
    expect(await screen.findByText('inbox')).toBeInTheDocument();
    // The same top bar element: moving into a signed-in page did not remount the shell.
    expect(screen.getByRole('banner')).toBe(bar);
  });
});
