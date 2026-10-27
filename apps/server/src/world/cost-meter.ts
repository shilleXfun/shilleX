import type { TurnUsage } from '@shillex/shared';

/**
 * What every model call cost, by job (2026-10-27 cost audit: Sonnet calls had been booked at Haiku prices for a day, and nobody could
 * see which job spent what). billedCall records each call here: one log line per call, and once an hour a summary by job, largest
 * first. /api/health/world shows the hour so far and the last full hour.
 */
export interface JobCost { calls: number; usd: number; input: number; output: number; cacheRead: number; refused: number }
export interface CostHour { from: string; usd: number; byJob: Record<string, JobCost> }

const HOUR = 3_600_000;
const empty = (): JobCost => ({ calls: 0, usd: 0, input: 0, output: 0, cacheRead: 0, refused: 0 });

export function createCostMeter(now: () => Date = () => new Date(), log: (m: string) => void = (m) => console.log(m)) {
  const fresh = (): CostHour => ({ from: now().toISOString(), usd: 0, byJob: {} });
  let current = fresh(), lastHour: CostHour | null = null;
  const timer = setInterval(() => {
    lastHour = current;
    current = fresh();
    const jobs = Object.entries(lastHour.byJob).sort((a, b) => b[1].usd - a[1].usd);
    if (!jobs.length) return;
    log(`[cost] last hour: $${lastHour.usd.toFixed(4)} over ${jobs.reduce((n, [, j]) => n + j.calls, 0)} calls; ${jobs.map(([k, j]) => `${k} $${j.usd.toFixed(4)} (${j.calls}${j.refused ? `, ${j.refused} refused` : ''})`).join(', ')}`);
  }, HOUR);
  timer.unref?.();
  const job = (k: string) => (current.byJob[k] ??= empty());
  return {
    /** One answered call: its job, the model that answered, its tokens and what it cost. */
    record(k: string, model: string, u: TurnUsage, usd: number) {
      const j = job(k);
      j.calls++; j.usd += usd; j.input += u.input; j.output += u.output; j.cacheRead += u.cacheRead;
      current.usd += usd;
      log(`[cost] ${k} ${model} in=${u.input} out=${u.output}${u.cacheRead ? ` cached=${u.cacheRead}` : ''} $${usd.toFixed(5)}`);
    },
    /** A call refused before it was sent (input too large); nothing was billed. */
    refused(k: string, why: string) { job(k).refused++; log(`[cost] ${k} refused: ${why}`); },
    state: () => ({ current, lastHour }),
    stop: () => clearInterval(timer),
  };
}
export type CostMeter = ReturnType<typeof createCostMeter>;

let meter: CostMeter | null = null;
/** The process's meter, started on first use. */
export const costMeter = () => (meter ??= createCostMeter());
export const costMeterState = () => meter?.state() ?? null;
