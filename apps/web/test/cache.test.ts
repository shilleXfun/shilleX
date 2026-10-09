import { describe, it, expect } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { PostView } from '@shillex/shared';
import { patchPost, removePost, prependToFeed } from '../src/lib/cache';

const p = (id: string, extra: Partial<PostView> = {}): PostView => ({
  id, kind: 'post', author: { id: 'a', username: 'a', displayName: 'A', avatarUrl: '', isDemo: true }, body: id, createdAt: '', deleted: false,
  parentId: null, rootId: null, replyTo: null, community: null, media: [], quoted: null, reposted: null,
  counts: { replies: 0, reposts: 0, quotes: 0 }, reactions: [], viewer: { bookmarked: false, reposted: false, subscribed: false, canAddCallUpdate: false }, mints: [], callUpdates: [], ...extra,
});

describe('post cache helpers', () => {
  it('patches a post everywhere it appears, including inside quotes and reposts', () => {
    const qc = new QueryClient();
    qc.setQueryData(['feed', 'following'], { pages: [{ items: [p('1'), p('2', { kind: 'repost', reposted: p('1') }), p('3', { kind: 'quote', quoted: p('1') })], nextCursor: null }], pageParams: [null] });
    qc.setQueryData(['thread', '1'], { post: p('1'), ancestors: [], replies: [], tokens: {} });
    patchPost(qc, '1', (x) => ({ ...x, viewer: { ...x.viewer, bookmarked: true } }));
    const feed: any = qc.getQueryData(['feed', 'following']);
    expect(feed.pages[0].items[0].viewer.bookmarked).toBe(true);
    expect(feed.pages[0].items[1].reposted.viewer.bookmarked).toBe(true);
    expect(feed.pages[0].items[2].quoted.viewer.bookmarked).toBe(true);
    expect((qc.getQueryData(['thread', '1']) as any).post.viewer.bookmarked).toBe(true);
  });
  it('removes and prepends', () => {
    const qc = new QueryClient();
    qc.setQueryData(['feed', 'following'], { pages: [{ items: [p('1'), p('2')], nextCursor: null }], pageParams: [null] });
    removePost(qc, '1');
    prependToFeed(qc, ['feed', 'following'], p('9'));
    expect((qc.getQueryData(['feed', 'following']) as any).pages[0].items.map((x: PostView) => x.id)).toEqual(['9', '2']);
  });
});
