import { describe, it, expect } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithApp, mockFetch } from './utils';
import { NotificationsPage } from '../src/features/notifications/NotificationsPage';

describe('NotificationsPage', () => {
  it('lists notifications with links and marks all read', async () => {
    const f = mockFetch({
      '/api/notifications/read': { unread: 0 },
      '/api/notifications': { items: [{ id: 'n1', type: 'follow', actor: { id: 'x', username: 'jane', displayName: 'Jane', avatarUrl: '/a.svg', isDemo: true }, target: { type: 'user', id: 'x' }, text: 'Jane followed you', href: '/u/jane', read: false, createdAt: new Date().toISOString(), excerpt: null }], nextCursor: null },
    });
    renderWithApp(<NotificationsPage />);
    expect(await screen.findByRole('link', { name: /Jane followed you/ })).toHaveAttribute('href', '/u/jane');
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    await waitFor(() => expect(f.mock.calls.some(([u]) => String(u).endsWith('/api/notifications/read'))).toBe(true));
  });
  it('quotes what was said under the headline', async () => {
    mockFetch({ '/api/notifications': { items: [{ id: 'n2', type: 'reply', actor: { id: 'x', username: 'jane', displayName: 'Jane', avatarUrl: '/a.svg', isDemo: true }, target: { type: 'post', id: 'p1' }, text: 'Jane replied to your post', href: '/p/p1', read: true, createdAt: new Date().toISOString(), excerpt: 'LP is locked, checked it myself' }], nextCursor: null } });
    renderWithApp(<NotificationsPage />);
    expect(await screen.findByRole('link', { name: /Jane replied to your post.*LP is locked, checked it myself/ })).toHaveAttribute('href', '/p/p1');
  });
  it('shows an empty state', async () => {
    mockFetch({ '/api/notifications': { items: [], nextCursor: null } });
    renderWithApp(<NotificationsPage />);
    expect(await screen.findByText('You’re all caught up')).toBeInTheDocument();
  });
});

describe('NotificationsPage in an agent world', () => {
  const who = (id: string) => ({ id, username: id, displayName: '', avatarUrl: '/x.svg', isDemo: false, isAgent: true, createdAt: '2026-10-01T00:00:00Z' });
  const world = {
    '/api/agents/info': { network: 'memory', agents: 50, runtime: 'on', budgetLevel: 'normal', spentTodayUsd: 0 },
    '/api/agents/overview': { movers: { up: [], down: [] }, feuds: [], launches: [{ mint: 'M1', symbol: 'LAMP', name: 'Lamp', creator: who('lantern'), launchedAt: '2026-10-13T09:00:00Z' }], rugs: [], moods: [] },
    '/api/factions': { factions: [{ id: 'f1', name: 'Lamp Cult', banner: '', bannerUrl: null, colour: '#3DDBD9', coinMint: null, conversationId: null, formedAt: '2026-10-13T08:00:00Z', splitAt: null, members: [who('a'), who('b')] }] },
    '/api/notifications': { items: [], nextCursor: null },
  };
  it('fills an empty page with the world’s newest events and drops the legacy Calls and tokens tab', async () => {
    mockFetch(world);
    renderWithApp(<NotificationsPage />, { route: '/notifications', path: '/notifications' });
    const meanwhile = (await screen.findByRole('heading', { level: 2, name: 'Meanwhile in the world' })).closest('section')!;
    expect(within(meanwhile).getAllByRole('listitem').map((li) => li.textContent)).toEqual([expect.stringMatching(/lantern launched \$LAMP/), expect.stringMatching(/Lamp Cult formed, 2 members/)]);
    expect(screen.queryByRole('tab', { name: 'Calls and tokens' })).not.toBeInTheDocument();
  });
});
