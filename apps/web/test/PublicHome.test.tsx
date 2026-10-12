import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import type { PostView } from '@shillex/shared';
import { renderWithApp, mockFetch } from './utils';

// Visitors hear new public posts on the /live socket.
const live = new Map<string, (p: unknown) => void>();
vi.mock('../src/lib/liveSocket', () => ({ liveSocket: { on: (e: string, h: (p: unknown) => void) => { live.set(e, h); }, off: (e: string) => { live.delete(e); }, connect: () => undefined, disconnect: () => undefined } }));
const emitted: object[] = [];
vi.mock('../src/components/swarm/bus', () => ({ swarm: { emit: (e: object) => { emitted.push(e); }, on: () => () => undefined } }));
import { PublicHome, publicFeedInterval } from '../src/features/feed/PublicHome';
import { useSwarmPosts } from '../src/components/swarm/hooks';

const agent = { id: 'a9', username: 'agent_09', displayName: 'Nine', avatarUrl: '/a.svg', isDemo: false, isAgent: true as const };
const post = (id: string, body: string): PostView => ({
  id, kind: 'post', author: agent, body, createdAt: new Date().toISOString(), deleted: false, parentId: null, rootId: null, replyTo: null,
  community: null, media: [], quoted: null, reposted: null, counts: { replies: 0, reposts: 0, quotes: 0 }, reactions: [],
  viewer: { bookmarked: false, reposted: false, subscribed: false, canAddCallUpdate: false }, mints: [], callUpdates: [],
});

describe('PublicHome', () => {
  beforeEach(() => { live.clear(); emitted.length = 0; });
  it('slides a new public post in for a visitor', async () => {
    mockFetch({
      '/api/feed/public': { items: [post('p1', 'an older post')], nextCursor: null, tokens: {} },
      '/api/posts/p2': { post: post('p2', 'fresh off the chain'), ancestors: [], replies: [], tokens: {} },
    });
    renderWithApp(<PublicHome />);
    await screen.findByText('an older post');
    act(() => live.get('post:live')!({ postId: 'p2', authorId: agent.id }));
    await waitFor(() => expect(screen.getAllByRole('article')[0]).toHaveTextContent('fresh off the chain'));
  });
  it('polls only while a visitor is on the first page, so a deep scroll does not refetch every page every 10 s', () => {
    const at = (pages: number) => publicFeedInterval({ state: { data: { pages: Array.from({ length: pages }, () => ({})) } } });
    expect(publicFeedInterval({ state: {} })).toBe(10_000);
    expect(at(1)).toBe(10_000);
    expect(at(2)).toBe(false);
    expect(at(10)).toBe(false);
  });
  it('ripples the swarm for a visitor’s post:live', () => {
    renderHook(() => useSwarmPosts());
    act(() => live.get('post:live')!({ postId: 'p2', authorId: agent.id }));
    expect(emitted).toEqual([{ kind: 'post', agentId: agent.id }]);
  });
});
