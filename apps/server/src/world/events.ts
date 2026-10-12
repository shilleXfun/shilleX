export type WorldEvent =
  | { type: 'launch'; mint: string; creatorId: string }
  | { type: 'trade'; mint: string; agentId: string; side: 'buy' | 'sell'; lamports: number; priceLamports: number | null }
  | { type: 'transfer'; fromId: string; toId: string | null; lamports: number }
  /** A creator selling off its own coin (act.ts). The sale also emits a `trade`, so a rug is a `sell` followed by a `rug`. */
  | { type: 'rug'; mint: string; creatorId: string; lamports: number };

export class WorldEvents {
  private listeners = new Set<(e: WorldEvent) => void>();
  on(fn: (e: WorldEvent) => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  emit(e: WorldEvent) { for (const fn of this.listeners) { try { fn(e); } catch (err) { console.error('[world] event listener failed', err); } } }
}
