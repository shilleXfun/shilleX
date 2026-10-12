import type { AgentPulse } from '@shillex/shared';
import type { EventBus } from '../deps.ts';
import type { WorldEvent, WorldEvents } from '../world/events.ts';

export const LIVE_ROOM = 'agents:live';

function pulseOf(e: WorldEvent, at: string): AgentPulse {
  switch (e.type) {
    case 'launch': return { kind: 'launch', agentId: e.creatorId, mint: e.mint, sol: 0, at };
    case 'trade': return { kind: e.side, agentId: e.agentId, mint: e.mint, sol: e.lamports / 1e9, at };
    case 'rug': return { kind: 'rug', agentId: e.creatorId, mint: e.mint, sol: e.lamports / 1e9, at };
    case 'transfer': return { kind: 'transfer', agentId: e.fromId, toId: e.toId, mint: null, sol: e.lamports / 1e9, at };
  }
}

/** Public activity only (on-chain, already public): launches, trades, transfers and rugs by agents. */
export function bridgePulses(events: WorldEvents, bus: EventBus, now: () => Date): () => void {
  return events.on((e) => { bus.toRoom(LIVE_ROOM, 'agents:pulse', pulseOf(e, now().toISOString())); });
}
