import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import type { PostView, UserSummary } from '@shillex/shared';
vi.mock('../src/lib/socket', () => ({ useSocketEvent: () => undefined, useRoom: () => undefined, useConnectionState: () => 'connected', socket: { connected: true, on: () => undefined, off: () => undefined, emit: () => undefined } }));
import { renderWithApp, mockFetch } from './utils';
import { LiveTape, mergeTape } from '../src/layout/LiveTape';
import { pushPulse, resetPulses, type StoredPulse } from '../src/features/agents/pulses';

const agent = (id: string): UserSummary => ({ id, username: id, displayName: '', avatarUrl: `/a/${id}.svg`, isDemo: false, isAgent: true, createdAt: '2026-10-12T00:00:00Z' });
const human: UserSummary = { id: 'h1', username: 'h1', displayName: '', avatarUrl: '/a/h1.svg', isDemo: false, createdAt: '2026-10-12T00:00:00Z' };
const postOf = (id: string, author: UserSummary, at: string, o: Partial<PostView> = {}) => ({ id, kind: 'post', author, body: `${id} first line\nsecond`, createdAt: at, deleted: false, parentId: null, rootId: null, replyTo: null, community: null, media: [], quoted: null, reposted: null, counts: { replies: 0, reposts: 0, quotes: 0 }, ...o }) as unknown as PostView;
const graph = { nodes: [{ id: 'a1', username: 'moth_lamp', displayName: '', avatarUrl: null, netWorthSol: 0.1, mood: 0, ghost: false, reputation: 0, factionId: null, factionColour: null }], edges: [], generatedAt: '2026-10-13T00:00:00Z' };
const lamp = { mint: 'M1', pool: 'P', name: 'Lamp', symbol: 'LAMP', description: '', emoji: '💡', creator: agent('a1'), launchedAt: '2026-10-13T09:00:00Z', launchSignature: 'S', priceSol: 1e-9, marketCapSol: 1, curveProgress: 0.1, holders: 2, volume24hSol: 0.1, devSoldPct: 0, graduated: false };

beforeEach(() => resetPulses());

describe('mergeTape', () => {
  it('merges trades and agents’ public posts newest first, leaving out humans and community posts, and caps the list', () => {
    const pulses = [
      { kind: 'buy', agentId: 'a1', mint: 'M1', sol: 0.02, at: '2026-10-13T10:00:02Z', seq: 2 },
      { kind: 'launch', agentId: 'a2', mint: 'M2', sol: 0, at: '2026-10-13T10:00:00Z', seq: 1, history: true },
    ] as StoredPulse[];
    const posts = [
      postOf('p1', agent('a3'), '2026-10-13T10:00:01Z'),
      postOf('p2', human, '2026-10-13T10:00:03Z'),
      postOf('p3', agent('a4'), '2026-10-13T10:00:04Z', { community: { id: 'c', slug: 'club', name: 'Club' } as PostView['community'] }),
    ];
    expect(mergeTape(pulses, posts).map((r) => r.id)).toEqual(['t2', 'pp1', 't1']);
    expect(mergeTape(pulses, posts, 2)).toHaveLength(2);
    expect(mergeTape([], posts).find((r) => r.kind === 'post')).toMatchObject({ text: 'p1 first line', postId: 'p1' });
  });
});

describe('LiveTape', () => {
  it('signed in, reads the viewer’s own Live feed (their mutes hold) and puts new trades on top', async () => {
    const f = mockFetch({
      '/api/coins/trades': { trades: [] },
      '/api/feed?tab=live': { items: [postOf('p1', agent('a3'), '2026-10-13T10:00:01Z')], nextCursor: null },
      '/api/agents/graph': graph,
      '/api/coins': { coins: [lamp] },
    });
    renderWithApp(<LiveTape signedIn />);
    expect(await screen.findByText(/p1 first line/)).toBeInTheDocument();
    act(() => pushPulse({ kind: 'buy', agentId: 'a1', mint: 'M1', sol: 0.02, at: '2026-10-13T11:00:00Z' }));
    await waitFor(() => expect(screen.getAllByRole('listitem')[0]).toHaveTextContent(/moth_lamp\s*bought\s*\$LAMP\s*0\.02 SOL/));
    expect(f.mock.calls.some(([u]) => String(u).includes('/api/feed?tab=live&limit=12'))).toBe(true);
    expect(f.mock.calls.some(([u]) => String(u).includes('/api/feed/public'))).toBe(false);
  });
  it('for a visitor, reads the public feed', async () => {
    const f = mockFetch({ '/api/coins/trades': { trades: [] }, '/api/feed/public': { items: [postOf('p9', agent('a3'), '2026-10-13T10:00:01Z')], nextCursor: null } });
    renderWithApp(<LiveTape signedIn={false} />);
    expect(await screen.findByText(/p9 first line/)).toBeInTheDocument();
    expect(f.mock.calls.some(([u]) => String(u).includes('/api/feed/public?limit=12'))).toBe(true);
  });
  it('waits quietly while nothing has happened', async () => {
    mockFetch({ '/api/coins/trades': { trades: [] }, '/api/feed/public': { items: [], nextCursor: null } });
    renderWithApp(<LiveTape signedIn={false} />);
    expect(await screen.findByText('Waiting for the first move…')).toBeInTheDocument();
  });
});
