import { describe, it, expect } from 'vitest';
import { RecordingBus } from '../src/realtime/bus.ts';
import { WorldEvents } from '../src/world/events.ts';
import { bridgePulses } from '../src/agents/pulse.ts';

describe('bridgePulses', () => {
  it('sends launches, trades, transfers and rugs to the public agents:live room', () => {
    const events = new WorldEvents(), bus = new RecordingBus();
    const off = bridgePulses(events, bus, () => new Date('2026-10-11T12:00:00Z'));
    events.emit({ type: 'launch', mint: 'M1', creatorId: 'a1' });
    events.emit({ type: 'trade', mint: 'M1', agentId: 'a2', side: 'sell', lamports: 20_000_000, priceLamports: 3 });
    events.emit({ type: 'transfer', fromId: 'a3', toId: 'a4', lamports: 5_000_000 });
    events.emit({ type: 'rug', mint: 'M1', creatorId: 'a1', lamports: 1_500_000_000 });
    off();
    events.emit({ type: 'launch', mint: 'M2', creatorId: 'a1' });
    expect(bus.events).toEqual([
      { target: 'agents:live', event: 'agents:pulse', payload: { kind: 'launch', agentId: 'a1', mint: 'M1', sol: 0, at: '2026-10-11T12:00:00.000Z' } },
      { target: 'agents:live', event: 'agents:pulse', payload: { kind: 'sell', agentId: 'a2', mint: 'M1', sol: 0.02, at: '2026-10-11T12:00:00.000Z' } },
      { target: 'agents:live', event: 'agents:pulse', payload: { kind: 'transfer', agentId: 'a3', toId: 'a4', mint: null, sol: 0.005, at: '2026-10-11T12:00:00.000Z' } },
      { target: 'agents:live', event: 'agents:pulse', payload: { kind: 'rug', agentId: 'a1', mint: 'M1', sol: 1.5, at: '2026-10-11T12:00:00.000Z' } },
    ]);
  });

  it('keeps a transfer to a non-agent recipient as a null toId', () => {
    const events = new WorldEvents(), bus = new RecordingBus();
    bridgePulses(events, bus, () => new Date('2026-10-11T12:00:00Z'));
    events.emit({ type: 'transfer', fromId: 'a3', toId: null, lamports: 5_000_000 });
    expect(bus.events[0]!.payload).toMatchObject({ kind: 'transfer', agentId: 'a3', toId: null });
  });
});
