import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import type { NotificationView } from '@shillex/shared';
import { groupNotifications, namesOf } from '../src/features/notifications/groupNotifications';
import { NotificationsPage } from '../src/features/notifications/NotificationsPage';
import { renderWithApp, mockFetch } from './utils';

const u = (id: string, name = id) => ({ id, username: id, displayName: name, avatarUrl: `/${id}.svg`, isDemo: true });
let seq = 100;
const at = (minAgo: number) => new Date(Date.parse('2026-10-10T12:00:00Z') - minAgo * 60_000).toISOString();
const n = (type: NotificationView['type'], actor: string, target: string, minAgo: number, extra: Partial<NotificationView> = {}): NotificationView => ({
  id: String(seq--), type, actor: u(actor, actor[0]!.toUpperCase() + actor.slice(1)), target: { type: type === 'follow' ? 'user' : 'post', id: target },
  text: `${actor} did ${type}`, href: `/p/${target}`, read: true, createdAt: at(minAgo), excerpt: type === 'follow' ? null : `post ${target}`, emoji: null, ...extra,
});

describe('groupNotifications', () => {
  it('folds reactions to one post (any position) into one row with every emoji, newest first', () => {
    const g = groupNotifications([
      n('reaction', 'nik', 'p1', 1, { emoji: '🔥', read: false }),
      n('reply', 'jo', 'p9', 2),
      n('reaction', 'bo', 'p1', 3, { emoji: '👀' }),
      n('reaction', 'nik', 'p2', 4, { emoji: '🔥' }),
      n('reaction', 'sue', 'p1', 5, { emoji: '🔥' }),
    ]);
    expect(g.map((x) => x.text)).toEqual(['Nik, Bo and Sue reacted 🔥👀 to your post', 'jo did reply', 'nik did reaction']);
    expect(g[0]).toMatchObject({ read: false, excerpt: 'post p1', href: '/p/p1' });
    expect(g[0]!.actors.map((a) => a.id)).toEqual(['nik', 'bo', 'sue']);
  });
  it('groups follows regardless of target, keeps replies apart, and stops at a day', () => {
    const g = groupNotifications([
      n('follow', 'ivy', 'ivy', 1), n('follow', 'fern', 'fern', 30), n('follow', 'old', 'old', 60 * 25),
      n('reply', 'a', 'p1', 2), n('reply', 'b', 'p1', 3),
    ].sort((x, y) => y.createdAt.localeCompare(x.createdAt)));
    expect(g.map((x) => x.text)).toEqual(['Ivy and Fern followed you', 'a did reply', 'b did reply', 'old did follow']);
  });
  it('names: one, two, three, then "and N others"; one person reacting twice is still one name', () => {
    expect(namesOf([u('a', 'A'), u('b', 'B'), u('c', 'C'), u('d', 'D'), u('e', 'E')])).toBe('A, B and 3 others');
    const g = groupNotifications([n('reaction', 'nik', 'p1', 1, { emoji: '🔥' }), n('reaction', 'nik', 'p1', 2, { emoji: '👀' })]);
    expect(g[0]!.text).toBe('Nik reacted 🔥👀 to your post');
  });
});

describe('NotificationsPage grouping', () => {
  it('shows one row with stacked avatars for several reactions', async () => {
    mockFetch({ '/api/notifications': { items: [n('reaction', 'nik', 'p1', 1, { emoji: '🔥' }), n('reaction', 'bo', 'p1', 2, { emoji: '🚀' })], nextCursor: null } });
    renderWithApp(<NotificationsPage />);
    expect(await screen.findByRole('link', { name: /Nik and Bo reacted 🔥🚀 to your post/ })).toHaveAttribute('href', '/p/p1');
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });
});
