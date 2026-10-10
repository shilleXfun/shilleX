import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { PostView, UserSummary } from '@shillex/shared';
import { renderWithApp } from './utils';
import { PostCard } from '../src/features/feed/PostCard';
import { QuoteEmbed } from '../src/features/feed/QuoteEmbed';

const author = { id: 'a', username: 'alpha_jane', displayName: 'Jane', avatarUrl: '/a.svg', isDemo: true };
const post: PostView = {
  id: 'p1', kind: 'post', author, body: 'watching this one', createdAt: new Date().toISOString(), deleted: false, parentId: null, rootId: null, replyTo: null,
  community: null, media: [], quoted: null, reposted: null, counts: { replies: 3, reposts: 1, quotes: 0 },
  reactions: [{ emoji: '🔥', count: 4, mine: true }], viewer: { bookmarked: false, reposted: false, subscribed: true, canAddCallUpdate: false },
  mints: [], callUpdates: [{ id: 'c1', status: 'bought', note: 'small', selfReported: true, createdAt: new Date().toISOString() }],
};
describe('PostCard', () => {
  it('renders author, body, counts, pressed reaction and self-reported call updates', () => {
    renderWithApp(<PostCard post={post} />);
    expect(screen.getByRole('link', { name: 'Jane' })).toHaveAttribute('href', '/u/alpha_jane');
    expect(screen.getByText('watching this one')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reply.*3/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /🔥 4/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Bought')).toBeInTheDocument();
    expect(screen.getByText('self-reported')).toBeInTheDocument();
  });
  it('the focal post of a thread shows its exact time; feed cards do not', () => {
    const at = { ...post, createdAt: '2026-10-08T14:05:00Z' };
    const { unmount } = renderWithApp(<PostCard post={at} focused />);
    const stamp = document.querySelector('p time[datetime="2026-10-08T14:05:00Z"]');
    expect(stamp?.textContent).toMatch(/2:05.*PM · Oct 8, 2026|14:05 · .*2026/);
    unmount();
    renderWithApp(<PostCard post={at} />);
    expect(document.querySelector('p time')).toBeNull();
  });
  it('shows repost attribution and a tombstone for deleted posts', () => {
    renderWithApp(<PostCard post={{ ...post, id: 'r1', kind: 'repost', body: '', author: { ...author, displayName: 'Dan', username: 'dex_dan' }, reposted: { ...post, deleted: true, body: '' } }} />);
    expect(screen.getByText(/Dan reposted/)).toBeInTheDocument();
    expect(screen.getByText('This post was deleted.')).toBeInTheDocument();
  });
});

// What the server sends for a post the viewer can't read (deleted or in a community they can't see).
const UNAVAILABLE_AUTHOR: UserSummary = { id: '', username: 'unavailable', displayName: 'Unavailable', avatarUrl: '/media/avatar/unavailable.svg', isDemo: false };
const unavailable: PostView = {
  ...post, id: 'gone', author: UNAVAILABLE_AUTHOR, body: '', createdAt: new Date(0).toISOString(), deleted: true,
  counts: { replies: 0, reposts: 0, quotes: 0 }, reactions: [], callUpdates: [], mints: [],
  viewer: { bookmarked: false, reposted: false, subscribed: false, canAddCallUpdate: false },
};
function expectNeutral(root: HTMLElement) {
  expect(within(root).getByText('This post is unavailable.')).toBeInTheDocument();
  expect(root.textContent).not.toMatch(/1970|Unavailable|@unavailable/);
  expect(root.querySelector('a[href*="/u/"]')).toBeNull();
  expect(root.querySelector('time, img')).toBeNull();
}
describe('unavailable posts', () => {
  it('PostCard renders a neutral block: no author, avatar, date or actions', () => {
    const { container } = renderWithApp(<PostCard post={unavailable} />);
    expectNeutral(container);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });
  it('a quote of an unavailable post keeps the quoter but neutralises the embed', () => {
    const { container } = renderWithApp(<PostCard post={{ ...post, kind: 'quote', quoted: unavailable }} />);
    expect(screen.getByRole('link', { name: 'Jane' })).toBeInTheDocument();
    const embed = screen.getByText('This post is unavailable.');
    expect(embed.closest('a')).toBeNull();
    expect(container.querySelector('a[href="/u/unavailable"], a[href="/p/gone"]')).toBeNull();
    expect(container.textContent).not.toMatch(/1970/);
  });
  it('a repost of an unavailable post shows the reposter and a neutral block', () => {
    const { container } = renderWithApp(<PostCard post={{ ...post, id: 'r2', kind: 'repost', body: '', author: { ...author, displayName: 'Dan', username: 'dex_dan' }, reposted: unavailable }} />);
    expect(screen.getByText(/Dan reposted/)).toBeInTheDocument();
    expect(screen.getByText('This post is unavailable.')).toBeInTheDocument();
    expect(container.querySelector('a[href="/u/unavailable"]')).toBeNull();
    expect(container.textContent).not.toMatch(/1970/);
    expect(screen.queryByRole('group', { name: 'Post actions' })).toBeNull();
  });
  it('QuoteEmbed alone renders the neutral block', () => {
    const { container } = renderWithApp(<QuoteEmbed post={unavailable} />);
    expectNeutral(container);
  });
});
