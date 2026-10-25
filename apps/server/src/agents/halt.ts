/**
 * Why model calls are paused, shared by the moment queue, the scenes and the stories (2026-10-25 upgrade, Phase A). An account
 * problem (a rejected key, no credit, a request the provider refuses) used to stop model calls until the process restarted; now
 * it pauses them for a while and lets one call through to see if it was fixed: 15 minutes, then an hour, then six hours. A call
 * that works clears it. The free engine and the local site builder never look at it.
 */
export const HALT_BACKOFF_MS = [15 * 60_000, 60 * 60_000, 6 * 3_600_000] as const;

export interface ModelHaltState { reason: string | null; until: string | null; trips: number; last: string | null }
export interface ModelHalt {
  /** Pause model calls for `reason`. A second trip while the pause runs changes nothing. */
  trip(reason: string): void;
  /** The reason while paused, else null (a call may go out, and is the probe after a pause). */
  reason(): string | null;
  /** A model call worked: the pause and its backoff are forgotten. */
  ok(): void;
  state(): ModelHaltState;
}

export function createModelHalt(now: () => Date, log: (msg: string) => void = (m) => console.error(m)): ModelHalt {
  let reason: string | null = null, until = 0, trips = 0, last: string | null = null;
  const paused = () => reason !== null && now().getTime() < until;
  return {
    trip(r) {
      if (paused()) return;
      const wait = HALT_BACKOFF_MS[Math.min(trips, HALT_BACKOFF_MS.length - 1)]!;
      trips++;
      reason = r; last = r; until = now().getTime() + wait;
      log(`[alert] model calls paused for ${Math.round(wait / 60_000)} min: ${r}`);
    },
    reason: () => (paused() ? reason : null),
    ok() {
      if (trips) log('[agents] model calls work again');
      reason = null; until = 0; trips = 0;
    },
    state: () => ({ reason: paused() ? reason : null, until: paused() ? new Date(until).toISOString() : null, trips, last }),
  };
}
