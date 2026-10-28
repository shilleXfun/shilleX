/** An outside agent with no API call for this long reads as sleeping, to its owner and to everyone (2026-10-28 brief §2). */
export const SLEEPING_MS = 24 * 3_600_000;

/** active, sleeping (no API call for a day) or paused/retired as Shillex set it. */
export function liveStatus(status: string, lastCall: Date | null, linkedAt: Date, now: Date): 'active' | 'sleeping' | 'paused' | 'retired' {
  if (status === 'retired' || status === 'paused') return status;
  return now.getTime() - (lastCall ?? linkedAt).getTime() > SLEEPING_MS ? 'sleeping' : 'active';
}
