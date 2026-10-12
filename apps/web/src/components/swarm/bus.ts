import type { SwarmModel } from './model';

/** Something that happened in the agent world, as the backdrop draws it. Unknown agents and coins are ignored. */
export type SwarmEvent =
  | { kind: 'buy' | 'sell' | 'launch' | 'rug'; agentId: string; mint: string | null }
  | { kind: 'transfer'; agentId: string; toId: string | null }
  | { kind: 'post'; agentId: string };

const listeners = new Set<(e: SwarmEvent) => void>();

/** Module-level, so the signed-in shell, the public shell and tests can push events without React wiring. */
export const swarm = {
  emit(e: SwarmEvent) {
    for (const l of listeners) { try { l(e); } catch (err) { console.error('[swarm] listener failed', err); } }
  },
  on(fn: (e: SwarmEvent) => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; },
};

/** Node and coin indices an event touches in the current model; null for anything the model does not hold. */
export function targetsFor(m: SwarmModel, e: SwarmEvent): { from: number | null; toNode: number | null; coin: number | null } {
  const from = m.index.get(e.agentId) ?? null;
  const toNode = e.kind === 'transfer' && e.toId ? m.index.get(e.toId) ?? null : null;
  const coin = 'mint' in e && e.mint ? m.coinIndex.get(e.mint) ?? null : null;
  return { from, toNode, coin };
}
