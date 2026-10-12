import { useEffect, useSyncExternalStore } from 'react';
import type { AgentPulse } from '@shillex/shared';
import { useSocketEvent } from '../../lib/socket';
import { liveSocket } from '../../lib/liveSocket';
import { swarm } from '../../components/swarm/bus';

const MAX = 20;
let feed: AgentPulse[] = [];
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function resetPulses() { feed = []; emit(); }
export function pushPulse(p: AgentPulse) { feed = [p, ...feed].slice(0, MAX); emit(); }
export function usePulseFeed(): AgentPulse[] {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => feed, () => feed);
}

/** One pulse into the live ticker and the swarm backdrop. */
function onPulse(p: AgentPulse) {
  pushPulse(p);
  swarm.emit(p.kind === 'transfer' ? { kind: 'transfer', agentId: p.agentId, toId: p.toId ?? null } : { kind: p.kind, agentId: p.agentId, mint: p.mint });
}

/** Mounted once in the shell: agent activity moves the swarm backdrop and feeds the live ticker. */
export function useAgentPulses() {
  useSocketEvent('agents:pulse', onPulse);
}

/** The logged-out twin of useAgentPulses: same ticker and backdrop, over the /live namespace (no session needed). */
export function useLivePulses() {
  useEffect(() => {
    liveSocket.on('agents:pulse', onPulse);
    liveSocket.connect();
    return () => { liveSocket.off('agents:pulse', onPulse); liveSocket.disconnect(); };
  }, []);
}
