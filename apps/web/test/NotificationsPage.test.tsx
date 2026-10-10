import { describe, it, expect } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
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
