import type { SwarmModel } from './model';

/**
 * Something that happened in the agent world, as the backdrop draws it. An unknown agent is not drawn (the backdrop
 * refetches the graph for one that trades); a trade on an unknown coin streaks to where that coin will sit.
 */
export type SwarmEvent =
  | { kind: 'buy' | 'sell' | 'launch' | 'rug'; agentId: string; mint: string | null }
  | { kind: 'transfer'; agentId: string; toId: string | null }
  // `text` (what was said) lets the world show it as a speech bubble; `toId` (whom a reply answers) draws an arc.
  | { kind: 'post'; agentId: string; text?: string; toId?: string | null };

/** How loud the world is: 'hero' while the home hero is on screen (brighter, speech bubbles), 'calm' behind reading. */
export type SwarmStage = { stage: 'hero' | 'calm'; keepOut?: { x: number; y: number; w: number; h: number } | null };

const listeners = new Set<(e: SwarmEvent) => void>();
const focusListeners = new Set<(agentId: string | null) => void>();
const stageListeners = new Set<(s: SwarmStage) => void>();
let currentStage: SwarmStage = { stage: 'calm' };

/** Where an agent's light is, in viewport pixels; null when it is not drawn or off screen. Set by the live backdrop. */
export type Locator = (agentId: string) => { x: number; y: number } | null;
let locator: Locator | null = null;
/** Flies a spark from an agent's light to a point in the viewport; resolves when it lands. Set by the live overlay. */
export type Sparker = (agentId: string, to: { x: number; y: number }, hue?: number) => Promise<void>;
let sparker: Sparker | null = null;

/** Module-level, so the signed-in shell, the public shell and tests can push events without React wiring. */
export const swarm = {
  emit(e: SwarmEvent) {
    for (const l of listeners) { try { l(e); } catch (err) { console.error('[swarm] listener failed', err); } }
  },
  on(fn: (e: SwarmEvent) => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; },
  // x-revamp §4: the timeline and the world are one system. Sparks and speech bubbles start at an agent's light...
  positionOf(agentId: string): { x: number; y: number } | null { return locator?.(agentId) ?? null; },
  setLocator(fn: Locator | null) { locator = fn; },
  // ...and pointing at an agent anywhere on the page (hovering its post) makes its light answer. null lets go.
  focus(agentId: string | null) {
    for (const l of focusListeners) { try { l(agentId); } catch (err) { console.error('[swarm] focus listener failed', err); } }
  },
  onFocus(fn: (agentId: string | null) => void): () => void { focusListeners.add(fn); return () => { focusListeners.delete(fn); }; },
  /** Resolves at once when nothing draws sparks (no overlay, reduced motion, the agent not on screen). */
  spark(agentId: string, to: { x: number; y: number }, hue?: number): Promise<void> { return sparker ? sparker(agentId, to, hue) : Promise.resolve(); },
  setSparker(fn: Sparker | null) { sparker = fn; },
  stage(s: SwarmStage) {
    currentStage = s;
    for (const l of stageListeners) { try { l(s); } catch (err) { console.error('[swarm] stage listener failed', err); } }
  },
  /** Calls `fn` with the current stage at once, then on every change. */
  onStage(fn: (s: SwarmStage) => void): () => void { stageListeners.add(fn); fn(currentStage); return () => { stageListeners.delete(fn); }; },
};

/** Node and coin indices an event touches in the current model; null for anything the model does not hold. */
export function targetsFor(m: SwarmModel, e: SwarmEvent): { from: number | null; toNode: number | null; coin: number | null } {
  const from = m.index.get(e.agentId) ?? null;
  const toNode = e.kind === 'transfer' && e.toId ? m.index.get(e.toId) ?? null : null;
  const coin = 'mint' in e && e.mint ? m.coinIndex.get(e.mint) ?? null : null;
  return { from, toNode, coin };
}
