import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { renderWithApp, mockFetch } from '../utils';

const handlers = new Map<string, (p: unknown) => void>();
vi.mock('../../src/lib/socket', () => ({ useSocketEvent: (e: string, h: (p: unknown) => void) => { handlers.set(e, h); } }));
const pulse = vi.fn();
const emitted: object[] = [];
vi.mock('../../src/components/swarm/bus', () => ({ swarm: { emit: (e: { kind: string }) => { emitted.push(e); pulse(e.kind); }, on: () => () => undefined } }));

import { useAgentPulses, resetPulses } from '../../src/features/agents/pulses';
import { LiveTicker } from '../../src/features/agents/LiveTicker';

function Harness({ compact = false }: { compact?: boolean }) { useAgentPulses(); return <LiveTicker compact={compact} names={{ a1: 'Nine', a2: 'Ember' }} symbols={{ M1: 'MOTH' }} />; }
const send = (p: object) => act(() => handlers.get('agents:pulse')!(p));
const agent = (id: string) => ({ id, username: id, displayName: '', avatarUrl: '/a.svg', isDemo: false, isAgent: true, createdAt: '2026-10-11T00:00:00Z' });
const trade = (kind: string, agentId: string, sol: number, at: string, mint: string | null = 'M1') =>
  ({ signature: `sig-${at}`, agent: agent(agentId), kind, mint, symbol: mint ? 'MOTH' : null, sol, tokens: 0, counterparty: null, createdAt: at, turnId: null });

describe('LiveTicker', () => {
  beforeEach(() => { resetPulses(); pulse.mockClear(); emitted.length = 0; mockFetch({ '/api/coins/trades': { trades: [] } }); });
  it('lists the newest pulses first and moves the swarm', () => {
    renderWithApp(<Harness />);
    send({ kind: 'buy', agentId: 'a1', mint: 'M1', sol: 0.02, at: '2026-10-11T12:00:00Z' });
    send({ kind: 'sell', agentId: 'a2', mint: 'M1', sol: 0.05, at: '2026-10-11T12:00:01Z' });
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items[0]).toMatch(/Ember sold \$MOTH · 0\.05 SOL/);
    expect(items[1]).toMatch(/Nine bought \$MOTH · 0\.02 SOL/);
    expect(pulse.mock.calls.map((c) => c[0])).toEqual(['buy', 'sell']);
  });
  it('passes the recipient of a transfer (or none) and a rug to the swarm', () => {
    renderWithApp(<Harness />);
    send({ kind: 'transfer', agentId: 'a1', toId: 'a2', mint: null, sol: 0.005, at: '2026-10-11T12:00:00Z' });
    send({ kind: 'rug', agentId: 'a2', mint: 'M1', sol: 1.5, at: '2026-10-11T12:00:01Z' });
    send({ kind: 'transfer', agentId: 'a1', mint: null, sol: 0.005, at: '2026-10-11T12:00:02Z' }); // a payout to someone who is not an agent
    expect(emitted).toEqual([
      { kind: 'transfer', agentId: 'a1', toId: 'a2' },
      { kind: 'rug', agentId: 'a2', mint: 'M1' },
      { kind: 'transfer', agentId: 'a1', toId: null },
    ]);
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items[1]).toMatch(/Ember rugged \$MOTH · 1\.50 SOL/);
    expect(items[2]).toMatch(/Nine sent · 0\.0050 SOL/);
  });
  it('keeps only the 20 newest', async () => {
    renderWithApp(<Harness />);
    for (let i = 0; i < 25; i++) send({ kind: 'buy', agentId: 'a1', mint: 'M1', sol: i / 100, at: `2026-10-11T12:00:${String(i).padStart(2, '0')}Z` });
    // The five oldest fade out first (exit animation), then leave the list.
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(20));
    expect(screen.getAllByRole('listitem')[0]!.textContent).toMatch(/0\.24 SOL/);
  });
  it('keys each pulse uniquely, so two identical pulses are two items', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderWithApp(<Harness />);
    const same = { kind: 'buy', agentId: 'a1', mint: 'M1', sol: 0.02, at: '2026-10-11T12:00:00Z' };
    send(same); send(same);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(err).not.toHaveBeenCalled(); // no duplicate-key warning
  });
  it('names an agent it does not know “An agent”, not a slice of its id', () => {
    renderWithApp(<Harness />);
    send({ kind: 'buy', agentId: '01M4R7YNSKZY29NSKYY4T5JJ2K', mint: 'M1', sol: 0.02, at: '2026-10-11T12:00:00Z' });
    expect(screen.getByRole('listitem')).toHaveTextContent(/^An agent bought \$MOTH/);
  });
  it('starts full: the latest trades load with the page, without moving the swarm', async () => {
    const f = mockFetch({ '/api/coins/trades': { trades: [
      trade('sell', 'a2', 0.05, '2026-10-11T12:00:03Z'),
      trade('receive', 'a1', 0.01, '2026-10-11T12:00:02Z', null),
      trade('buy', 'a1', -0.02, '2026-10-11T12:00:01Z'),
      trade('fund', 'a1', 1, '2026-10-11T12:00:00Z', null),
    ] } });
    renderWithApp(<Harness />);
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items[0]).toMatch(/Ember sold \$MOTH · 0\.05 SOL/);
    expect(items[1]).toMatch(/Nine bought \$MOTH · 0\.02 SOL/);
    expect(emitted).toEqual([]);
    expect(f.mock.calls.filter(([u]) => String(u).includes('/api/coins/trades?limit=20'))).toHaveLength(1);
    // A live trade lands above the history.
    send({ kind: 'buy', agentId: 'a2', mint: 'M1', sol: 0.3, at: '2026-10-11T12:00:09Z' });
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent(/Ember bought \$MOTH · 0\.30 SOL/);
    expect(emitted).toHaveLength(1);
  });
  it('says it is waiting only once it knows there are no trades', async () => {
    let answer: (r: Response) => void = () => undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise((r) => { answer = r; }));
    renderWithApp(<Harness />);
    expect(screen.queryByText(/waiting for the first trade/i)).not.toBeInTheDocument();
    await act(async () => answer(new Response(JSON.stringify({ trades: [] }), { status: 200, headers: { 'content-type': 'application/json' } })));
    expect(await screen.findByText(/waiting for the first trade/i)).toBeInTheDocument();
  });
  it('stays unsettled when the history fails, and tries once more after 10 s', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      let n = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => (++n === 1 ? new Response('{}', { status: 500 })
        : new Response(JSON.stringify({ trades: [trade('buy', 'a1', -0.02, '2026-10-11T12:00:01Z')] }), { status: 200, headers: { 'content-type': 'application/json' } })));
      renderWithApp(<Harness />);
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
      expect(n).toBe(1);
      // A failure is not "no trades": no waiting line.
      expect(screen.queryByText(/waiting for the first trade/i)).not.toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      expect(n).toBe(2);
      expect(screen.getByRole('listitem')).toHaveTextContent(/Nine bought \$MOTH/);
    } finally { vi.useRealTimers(); }
  });
  it('announces the full list politely and keeps the one-line strip silent', () => {
    const { unmount } = renderWithApp(<Harness />);
    send({ kind: 'buy', agentId: 'a1', mint: 'M1', sol: 0.02, at: '2026-10-11T12:00:00Z' });
    expect(screen.getByRole('list', { name: 'Live agent activity' })).toHaveAttribute('aria-live', 'polite');
    unmount();
    renderWithApp(<Harness compact />);
    expect(screen.getByRole('list', { name: 'Live agent activity' })).toHaveAttribute('aria-live', 'off');
  });
});
