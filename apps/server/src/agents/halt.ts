/**
 * Why model calls are paused, shared by the moment queue, the scenes and the stories (2026-10-25 upgrade, Phase A). An account
 * problem (a rejected key, no credit, a request the provider refuses) used to stop model calls until the process restarted; now
 * it pauses them for a while and lets one call through to see if it was fixed: 15 minutes, then an hour, then six hours. A call
 * that works clears it. The free engine and the local site builder never look at it.
 *
 * A rejected key or an empty account is worse than a pause: the brain is down (2026-10-27, a 401 ran a day on phrasebooks while
 * every pause logged a fresh alert). It says so once, then lets one call through every DOWN_PROBE_MS (a refused call is not
 * billed) until one works, and /api/agents/info shows it as "brain": "down" all the while.
 */
export const HALT_BACKOFF_MS = [15 * 60_000, 60 * 60_000, 6 * 3_600_000] as const;
export const DOWN_PROBE_MS = 30 * 60_000;

/** 'down': the key or the account (401, 403, no credit), needs a human; 'paused': anything else that stopped calls for a while. */
export type HaltKind = 'down' | 'paused';
export interface ModelHaltState {
  reason: string | null; until: string | null; trips: number; last: string | null;
  /** Set from the first 'down' trip until a call works, through the probes in between. */
  down: { reason: string; since: string; probes: number } | null;
}
export interface ModelHalt {
  /**
   * Pause model calls for `reason`. A second trip while the pause runs changes nothing. `resumeAt`: when the provider said access
   * returns; it is told, but the probes go on every DOWN_PROBE_MS, so a limit raised in the console is noticed without a restart.
   */
  trip(reason: string, kind?: HaltKind, resumeAt?: Date): void;
  /** The reason while paused, else null (a call may go out, and is the probe after a pause). */
  reason(): string | null;
  /** A model call worked: the pause and its backoff are forgotten. */
  ok(): void;
  /** Lets the next model call through now (the owner raised a limit or fixed a key): it works and clears the pause, or trips it again. */
  recheck(): ModelHaltState;
  state(): ModelHaltState;
}

export function createModelHalt(now: () => Date, log: (msg: string) => void = (m) => console.error(m)): ModelHalt {
  let reason: string | null = null, until = 0, trips = 0, last: string | null = null;
  let down: { reason: string; since: number; probes: number } | null = null;
  const paused = () => reason !== null && now().getTime() < until;
  return {
    trip(r, kind = 'paused', resumeAt) {
      if (paused()) return;
      const t = now().getTime();
      if (kind === 'down' || down) {
        // Said once; each failed probe after that only waits for the next one.
        if (down) { down.probes++; down.reason = r; }
        else { down = { reason: r, since: t, probes: 0 }; log(`[alert] brain down: ${r}; one call is tried every ${DOWN_PROBE_MS / 60_000} min until it works${resumeAt ? ` (the provider says access returns ${resumeAt.toISOString()})` : ''}`); }
        trips++;
        reason = r; last = r; until = t + DOWN_PROBE_MS;
        return;
      }
      const wait = HALT_BACKOFF_MS[Math.min(trips, HALT_BACKOFF_MS.length - 1)]!;
      trips++;
      reason = r; last = r; until = t + wait;
      log(`[alert] model calls paused for ${Math.round(wait / 60_000)} min: ${r}`);
    },
    reason: () => (paused() ? reason : null),
    ok() {
      if (down) log(`[agents] brain back up after ${Math.round((now().getTime() - down.since) / 60_000)} min`);
      else if (trips) log('[agents] model calls work again');
      reason = null; until = 0; trips = 0; down = null;
    },
    recheck() {
      if (reason !== null) { until = 0; log('[agents] model calls re-checked on request: the next call goes out now'); }
      return this.state();
    },
    state: () => ({
      reason: paused() ? reason : null, until: paused() ? new Date(until).toISOString() : null, trips, last,
      down: down ? { reason: down.reason, since: new Date(down.since).toISOString(), probes: down.probes } : null,
    }),
  };
}
