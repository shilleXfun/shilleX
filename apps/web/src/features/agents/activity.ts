import { useCallback, useSyncExternalStore } from 'react';
import { swarm } from '../../components/swarm/bus';

/** How long an agent counts as acting after it traded, launched, rugged, sent SOL or posted. */
export const ACTING_MS = 2500;

type Sub = { windowMs: number; notify: () => void };
/** Agent id → when it last acted. */
const lastActed = new Map<string, number>();
/** Agent id → the components watching it, each with its own window. */
const subs = new Map<string, Set<Sub>>();
/** The store's "now". It moves only on an action, a subscription or the timer, so two reads in one render always agree. */
let clock = 0;
/** The one timer for every agent: it wakes when the next watched window ends or the next entry expires. */
let timer: ReturnType<typeof setTimeout> | null = null;

/** Entries live as long as the longest window anyone watches (at least the default), then expire. */
function keepMs() {
  let w = ACTING_MS;
  for (const set of subs.values()) for (const s of set) w = Math.max(w, s.windowMs);
  return w;
}

/** Moves the clock to `now`, drops expired entries and tells only the agents whose window ended in between. */
function advance(now: number) {
  const before = clock;
  clock = now;
  const keep = keepMs();
  const ended: string[] = [];
  for (const [id, at] of lastActed) {
    if ([...(subs.get(id) ?? [])].some((s) => at + s.windowMs > before && at + s.windowMs <= now)) ended.push(id);
    if (at + keep <= now) lastActed.delete(id);
  }
  for (const id of ended) subs.get(id)?.forEach((s) => s.notify());
}

function arm() {
  if (timer) clearTimeout(timer);
  timer = null;
  const keep = keepMs();
  let next = Infinity;
  for (const [id, at] of lastActed) {
    next = Math.min(next, at + keep);
    for (const s of subs.get(id) ?? []) if (at + s.windowMs > clock) next = Math.min(next, at + s.windowMs);
  }
  if (next < Infinity) timer = setTimeout(() => { timer = null; advance(Date.now()); arm(); }, Math.max(0, next - Date.now()));
}

function acted(id: string) {
  const now = Date.now();
  advance(now);
  lastActed.set(id, now);
  subs.get(id)?.forEach((s) => s.notify());
  arm();
}

// Every event the swarm hears — trades, launches, rugs, transfers, posts — is its sender acting.
swarm.on((e) => acted(e.agentId));

/** Tests: forget every action and stop the timer (subscriptions stay with their components). */
export function resetActivity() {
  lastActed.clear();
  clock = 0;
  if (timer) clearTimeout(timer);
  timer = null;
}

/**
 * Whether this agent did something in the last `windowMs`. A component re-renders only when its own agent starts or
 * stops acting. No id (a human, or nobody) is never acting.
 */
export function useActing(agentId: string | null | undefined, windowMs = ACTING_MS): boolean {
  const subscribe = useCallback((notify: () => void) => {
    if (!agentId) return () => undefined;
    const sub: Sub = { windowMs, notify };
    let set = subs.get(agentId);
    if (!set) subs.set(agentId, (set = new Set()));
    set.add(sub);
    // The clock may be stale when nothing has happened for a while: bring it up to date before watching.
    advance(Date.now());
    arm();
    return () => {
      const cur = subs.get(agentId);
      cur?.delete(sub);
      if (cur && !cur.size) subs.delete(agentId);
    };
  }, [agentId, windowMs]);
  const snapshot = () => {
    if (!agentId) return false;
    const at = lastActed.get(agentId);
    return at !== undefined && clock - at < windowMs;
  };
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
