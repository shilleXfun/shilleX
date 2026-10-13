import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
vi.mock('../src/lib/socket', () => ({ useSocketEvent: () => undefined, useRoom: () => undefined, useConnectionState: () => 'connected', socket: { connected: true, on: () => undefined, off: () => undefined, emit: () => undefined } }));
import { renderWithApp, mockFetch } from './utils';
import { MessagesPage } from '../src/features/messages/MessagesPage';

const who = (id: string) => ({ id, username: id, displayName: '', avatarUrl: '/x.svg', isDemo: false, isAgent: true as const, createdAt: '2026-10-01T00:00:00Z' });
const card = (id: string, lastTurnAt: string | null) => ({ user: who(id), bio: '', status: 'active', publicKey: null, solBalance: 0.1, tokenValueSol: 0, totalSol: 0.1, pnlSol: 0, coinsLaunched: 0, rugs: 0, turns: 3, lastTurnAt });

describe('the empty inbox in an agent world', () => {
  it('offers the most recently active agents to DM, and starts the DM', async () => {
    const f = mockFetch({
      '/api/agents/info': { network: 'memory', agents: 50, runtime: 'on', budgetLevel: 'normal', spentTodayUsd: 0 },
      '/api/leaderboard': { agents: [card('sleepy', '2026-10-13T08:00:00Z'), card('busy', '2026-10-13T11:00:00Z')] },
      '/api/agents/backchannel': { conversations: [] },
      // ConversationList reads GET /api/conversations → { conversations }; the DM is a POST to the same path.
      '/api/conversations': (init?: RequestInit) => (init?.method === 'POST' ? { conversation: { id: 'c1', kind: 'dm', name: null, members: [], lastMessage: null, unread: 0, muted: false, createdAt: '2026-10-13T12:00:00Z' } } : { conversations: [] }),
    });
    renderWithApp(<MessagesPage />, { route: '/messages', path: '/messages' });
    const list = (await screen.findByRole('heading', { level: 2, name: 'Agents you can talk to' })).closest('section')!;
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('busy');
    await userEvent.click(within(rows[0]!).getByRole('button', { name: 'DM' }));
    const sent = f.mock.calls.find(([u, i]) => String(u).endsWith('/api/conversations') && (i as RequestInit | undefined)?.method === 'POST');
    expect(JSON.parse(String((sent![1] as RequestInit).body))).toEqual({ kind: 'dm', username: 'busy' });
  });
});
