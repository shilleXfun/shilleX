import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { swarm } from '../../src/components/swarm/bus';
import { resetActivity, useActing } from '../../src/features/agents/activity';

const renders: Record<string, number> = {};
function Probe({ id, windowMs }: { id: string; windowMs?: number }) {
  const acting = useActing(id, windowMs);
  renders[id] = (renders[id] ?? 0) + 1;
  return <span data-testid={id}>{acting ? 'acting' : 'idle'}</span>;
}

describe('activity store', () => {
  beforeEach(() => { vi.useFakeTimers(); resetActivity(); for (const k of Object.keys(renders)) delete renders[k]; });
  afterEach(() => { vi.useRealTimers(); });

  it('marks an agent acting when it trades, launches, rugs, sends or posts', () => {
    render(<><Probe id="a" /><Probe id="b" /><Probe id="c" /><Probe id="d" /><Probe id="e" /></>);
    act(() => {
      swarm.emit({ kind: 'buy', agentId: 'a', mint: 'M1' });
      swarm.emit({ kind: 'launch', agentId: 'b', mint: 'M2' });
      swarm.emit({ kind: 'rug', agentId: 'c', mint: 'M2' });
      swarm.emit({ kind: 'transfer', agentId: 'd', toId: 'e' });
    });
    for (const id of ['a', 'b', 'c', 'd']) expect(screen.getByTestId(id)).toHaveTextContent('acting');
    // The recipient of a transfer did not act.
    expect(screen.getByTestId('e')).toHaveTextContent('idle');
    act(() => swarm.emit({ kind: 'post', agentId: 'e' }));
    expect(screen.getByTestId('e')).toHaveTextContent('acting');
  });

  it('stops after the window, and a new action starts it again', () => {
    render(<Probe id="a" />);
    act(() => swarm.emit({ kind: 'sell', agentId: 'a', mint: 'M1' }));
    act(() => vi.advanceTimersByTime(2400));
    expect(screen.getByTestId('a')).toHaveTextContent('acting');
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByTestId('a')).toHaveTextContent('idle');
    act(() => swarm.emit({ kind: 'buy', agentId: 'a', mint: 'M1' }));
    expect(screen.getByTestId('a')).toHaveTextContent('acting');
  });

  it('honours a custom window', () => {
    render(<Probe id="a" windowMs={500} />);
    act(() => swarm.emit({ kind: 'buy', agentId: 'a', mint: 'M1' }));
    act(() => vi.advanceTimersByTime(499));
    expect(screen.getByTestId('a')).toHaveTextContent('acting');
    act(() => vi.advanceTimersByTime(2));
    expect(screen.getByTestId('a')).toHaveTextContent('idle');
  });

  it('leaves other agents alone: no state change and no re-render', () => {
    render(<><Probe id="a" /><Probe id="b" /></>);
    const before = renders.b;
    act(() => swarm.emit({ kind: 'buy', agentId: 'a', mint: 'M1' }));
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getByTestId('b')).toHaveTextContent('idle');
    expect(renders.b).toBe(before);
    expect(renders.a).toBeGreaterThan(before!);
  });

  it('does not call an agent acting when it mounts long after its last action', () => {
    act(() => swarm.emit({ kind: 'buy', agentId: 'a', mint: 'M1' }));
    act(() => vi.advanceTimersByTime(10_000));
    render(<Probe id="a" />);
    expect(screen.getByTestId('a')).toHaveTextContent('idle');
  });
});
