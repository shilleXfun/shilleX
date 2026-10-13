import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { AgentPulse, ChainTxKind, TradeView } from '@shillex/shared';
import { get } from '../../lib/api';
import { useSocketEvent } from '../../lib/socket';
import { liveSocket } from '../../lib/liveSocket';
import { swarm } from '../../components/swarm/bus';

const MAX = 20;
/** A pulse as the store holds it. `seq` is unique and keys it; `history` marks a trade loaded with the page: it already happened, so it never animates, flashes or reaches the swarm. */
export type StoredPulse = AgentPulse & { seq: number; history?: true };

let feed: StoredPulse[] = [];
let seq = 0;
/** The page-load history request; `settled` once it has answered, so the ticker knows "no trades" is true. */
let seeding: Promise<void> | null = null;
let settled = false;
/** A failed history load tries once more after this long. */
const HISTORY_RETRY_MS = 10_000;
let retry: ReturnType<typeof setTimeout> | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

export function resetPulses() {
  feed = []; seeding = null; settled = false;
  if (retry) clearTimeout(retry);
  retry = null;
  emit();
}
export function pushPulse(p: AgentPulse) { feed = [{ ...p, seq: ++seq }, ...feed].slice(0, MAX); emit(); }
export function usePulseFeed(): StoredPulse[] {
  return useSyncExternalStore(subscribe, () => feed, () => feed);
}
/** True once the page-load history has answered: an empty feed then really means no trades yet. */
export function usePulseHistorySettled(): boolean {
  return useSyncExternalStore(subscribe, () => settled, () => settled);
}

const PULSE_KIND: Partial<Record<ChainTxKind, AgentPulse['kind']>> = { launch: 'launch', buy: 'buy', sell: 'sell', send: 'transfer' };
/** A recorded trade as the pulse it was. Funding and the receiving side of a transfer are not an agent acting. */
export function tradePulse(t: TradeView): AgentPulse | null {
  const kind = PULSE_KIND[t.kind];
  if (!kind || !t.agent) return null;
  // A launch pulse carries no SOL (as live ones do); trades carry the amount, whichever way it moved.
  return { kind, agentId: t.agent.id, mint: t.mint, sol: kind === 'launch' ? 0 : Math.abs(t.sol), at: t.createdAt, ...(kind === 'transfer' && { toId: null }) };
}

/** History goes below what is already live; anything from the second before the oldest live pulse is likely that same trade. */
function addHistory(pulses: AgentPulse[]) {
  const oldest = feed.at(-1);
  const cutoff = oldest ? Date.parse(oldest.at) - 1000 : Infinity;
  const older = pulses.filter((p) => Date.parse(p.at) < cutoff).map((p): StoredPulse => ({ ...p, seq: ++seq, history: true }));
  feed = [...feed, ...older].slice(0, MAX);
}

/**
 * Fills the ticker with the latest trades, once per page load. They are history: the swarm is not told. A failed load
 * leaves the ticker unsettled (a failure is not "no trades") and tries once more after 10 s.
 */
export function loadPulseHistory(): Promise<void> {
  seeding ??= fetchHistory(1);
  return seeding;
}
function fetchHistory(retries: number): Promise<void> {
  return get<{ trades: TradeView[] }>(`/coins/trades?limit=${MAX}`)
    .then((r) => { addHistory(r.trades.flatMap((t) => tradePulse(t) ?? [])); settled = true; emit(); })
    .catch(() => { if (retries > 0) retry = setTimeout(() => { retry = null; seeding = fetchHistory(retries - 1); }, HISTORY_RETRY_MS); });
}

export type Flash = { side: 'up' | 'down'; beat: 0 | 1 };
const SIDE: Partial<Record<AgentPulse['kind'], Flash['side']>> = { buy: 'up', launch: 'up', sell: 'down', rug: 'down' };

/**
 * Trades that land after the caller mounted, by coin: which way the latest went, and a beat that flips with every new
 * trade so a CSS animation keyed on it restarts. History never flashes.
 */
export function useCoinFlashes(): ReadonlyMap<string, Flash> {
  const pulses = usePulseFeed();
  const seen = useRef(-1);
  if (seen.current < 0) seen.current = seq;
  const [flashes, setFlashes] = useState<ReadonlyMap<string, Flash>>(() => new Map());
  useEffect(() => {
    const fresh = pulses.filter((p) => p.seq > seen.current && !p.history && p.mint && SIDE[p.kind]);
    if (!fresh.length) return;
    seen.current = Math.max(...fresh.map((p) => p.seq));
    setFlashes((m) => {
      const next = new Map(m);
      const done = new Set<string>();
      // Newest first: a coin's first fresh pulse is its latest, and one batch flips its beat once.
      for (const p of fresh) {
        if (done.has(p.mint!)) continue;
        done.add(p.mint!);
        next.set(p.mint!, { side: SIDE[p.kind]!, beat: next.get(p.mint!)?.beat === 0 ? 1 : 0 });
      }
      return next;
    });
  }, [pulses]);
  return flashes;
}

/** The latest trade by `agentId` after the caller mounted: which way it went, and a beat that flips per trade (as useCoinFlashes). History never flashes. */
export function useAgentTradeFlash(agentId: string): Flash | undefined {
  const pulses = usePulseFeed();
  const seen = useRef(-1);
  if (seen.current < 0) seen.current = seq;
  const [flash, setFlash] = useState<Flash | undefined>(undefined);
  useEffect(() => {
    const fresh = pulses.filter((p) => p.seq > seen.current && !p.history && p.agentId === agentId && SIDE[p.kind]);
    if (!fresh.length) return;
    seen.current = Math.max(...fresh.map((p) => p.seq));
    setFlash((f) => ({ side: SIDE[fresh[0]!.kind]!, beat: f?.beat === 0 ? 1 : 0 }));
  }, [pulses, agentId]);
  return flash;
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
