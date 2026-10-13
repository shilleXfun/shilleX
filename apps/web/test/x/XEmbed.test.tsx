import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PostView } from '@shillex/shared';
import { renderWithApp } from '../utils';
import { PostCard } from '../../src/features/feed/PostCard';
import { XEmbed, xPostUrl } from '../../src/features/x/XEmbed';
import { XEmbedSetting } from '../../src/features/x/XEmbedSetting';
import { WIDGETS_SRC, resetWidgetsForTests } from '../../src/features/x/widgets';
import { setXEmbedsOn } from '../../src/features/x/xEmbedPref';

let seen: ((entries: { isIntersecting: boolean }[]) => void)[] = [];
const OriginalIO = globalThis.IntersectionObserver;
beforeEach(() => {
  seen = [];
  globalThis.IntersectionObserver = class { constructor(cb: (e: { isIntersecting: boolean }[]) => void) { seen.push(cb); } observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } } as unknown as typeof IntersectionObserver;
  resetWidgetsForTests();
  delete (window as { twttr?: unknown }).twttr;
  document.head.querySelectorAll(`script[src="${WIDGETS_SRC}"]`).forEach((s) => s.remove());
  setXEmbedsOn(true);
});
afterEach(() => { globalThis.IntersectionObserver = OriginalIO; });
const embed = { postId: '1800000000000000001', handle: 'lamp' };
const scrollIn = async () => { await act(async () => { for (const cb of seen) cb([{ isIntersecting: true }]); await Promise.resolve(); }); };

describe('XEmbed (x-feed §5.7)', () => {
  it('shows a link card first and loads nothing until the post scrolls into view', () => {
    render(<XEmbed embed={embed} />);
    expect(screen.getByRole('link', { name: /post on x by lamp/i })).toHaveAttribute('href', 'https://x.com/lamp/status/1800000000000000001');
    expect(document.head.querySelector(`script[src="${WIDGETS_SRC}"]`)).toBeNull();
    expect(xPostUrl({ postId: '9', handle: null })).toBe('https://x.com/i/web/status/9');
  });
  it('in view, asks X’s script for the post without tracking, and swaps the card for it', async () => {
    const createTweet = vi.fn(async (_id: string, el: HTMLElement) => { const n = document.createElement('div'); el.appendChild(n); return n; });
    (window as { twttr?: unknown }).twttr = { widgets: { createTweet } };
    render(<XEmbed embed={embed} />);
    await scrollIn();
    await waitFor(() => expect(screen.queryByRole('link', { name: /post on x/i })).toBeNull());
    expect(createTweet).toHaveBeenCalledWith('1800000000000000001', expect.any(HTMLElement), expect.objectContaining({ dnt: true, theme: 'dark' }));
  });
  it('loads the script once, on demand', async () => {
    render(<><XEmbed embed={embed} /><XEmbed embed={{ postId: '1800000000000000002', handle: null }} /></>);
    await scrollIn();
    expect(document.head.querySelectorAll(`script[src="${WIDGETS_SRC}"]`)).toHaveLength(1);
  });
  it('Review Focus 5: when the script fails (blocked, offline), the link card stays', async () => {
    render(<XEmbed embed={embed} />);
    await scrollIn();
    const script = document.head.querySelector(`script[src="${WIDGETS_SRC}"]`)!;
    await act(async () => { fireEvent.error(script); await Promise.resolve(); });
    expect(screen.getByRole('link', { name: /post on x by lamp/i })).toBeInTheDocument();
  });
  it('with the setting off, never loads anything and keeps the card', async () => {
    setXEmbedsOn(false);
    render(<XEmbed embed={embed} />);
    await scrollIn();
    expect(document.head.querySelector(`script[src="${WIDGETS_SRC}"]`)).toBeNull();
    expect(screen.getByRole('link', { name: /post on x/i })).toBeInTheDocument();
  });
  it('the setting toggles it on this device', () => {
    render(<XEmbedSetting sectionClass="s" titleClass="t" />);
    const box = screen.getByRole('checkbox', { name: /show posts from x/i });
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect(box).not.toBeChecked();
    expect(localStorage.getItem('shillex:x-embeds')).toBe('off');
  });
  it('a post card shows its embed', () => {
    const author = { id: 'a', username: 'agent_01', displayName: 'Moth', avatarUrl: '/a.svg', isDemo: false, isAgent: true as const };
    const post: PostView = { id: 'p1', kind: 'post', author, body: 'look at this one', createdAt: new Date().toISOString(), deleted: false, parentId: null, rootId: null, replyTo: null,
      community: null, media: [], quoted: null, reposted: null, counts: { replies: 0, reposts: 0, quotes: 0 }, reactions: [],
      viewer: { bookmarked: false, reposted: false, subscribed: false, canAddCallUpdate: false }, mints: [], callUpdates: [], xEmbed: embed };
    renderWithApp(<PostCard post={post} />);
    expect(screen.getByRole('link', { name: /post on x by lamp/i })).toBeInTheDocument();
  });
});
