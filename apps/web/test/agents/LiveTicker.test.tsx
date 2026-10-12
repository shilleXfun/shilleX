import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { renderWithApp } from '../utils';

const handlers = new Map<string, (p: unknown) => void>();
vi.mock('../../src/lib/socket', () => ({ useSocketEvent: (e: string, h: (p: unknown) => void) => { handlers.set(e, h); } }));
const pulse = vi.fn();
const emitted: object[] = [];
vi.mock('../../src/components/swarm/bus', () => ({ swarm: { emit: (e: { kind: string }) => { emitted.push(e); pulse(e.kind); } } }));

import { useAgentPulses, resetPulses } from '../../src/features/agents/pulses';
import { LiveTicker } from '../../src/features/agents/LiveTicker';

function Harness({ compact = false }: { compact?: boolean }) { useAgentPulses(); return <LiveTicker compact={compact} names={{ a1: 'Nine', a2: 'Ember' }} symbols={{ M1: 'MOTH' }} />; }
const send = (p: object) => act(() => handlers.get('agents:pulse')!(p));

describe('LiveTicker', () => {
  beforeEach(() => { resetPulses(); pulse.mockClear(); emitted.length = 0; });
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
  it('says the ticker is quiet before anything happens', () => {
    renderWithApp(<Harness />);
    expect(screen.getByText(/waiting for the first trade/i)).toBeInTheDocument();
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
