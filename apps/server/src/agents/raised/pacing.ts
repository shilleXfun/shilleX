import { eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { agents } from '../../db/schema.ts';

export const BASE_POPULATION = 50, TICK_FLOOR_MS = 1000;
/**
 * Spec §8: one agent acts per tick, so with more agents the tick shortens (× 50 / population) and each agent keeps about
 * today's pace. Never under 1 s, nor under ENGINE_TICK_MS's own minimum when that is faster (a fast local tick keeps its floor).
 */
export function pacedTick([lo, hi]: [number, number], population: number): [number, number] {
  if (population <= BASE_POPULATION) return [lo, hi];
  const k = BASE_POPULATION / population, floor = Math.min(lo, TICK_FLOOR_MS);
  const a = Math.max(floor, Math.round(lo * k));
  return [a, Math.max(a, Math.round(hi * k))];
}

/** How many agents are active, re-read at most once a minute (value() never waits). */
export class Population {
  private n = BASE_POPULATION;
  private at = -Infinity;
  constructor(private db: Db, private now: () => Date) {}
  async refresh(): Promise<number> {
    this.at = this.now().getTime();
    const [r] = await this.db.select({ n: sql<number>`count(*)::int` }).from(agents).where(eq(agents.status, 'active'));
    this.n = r?.n ?? this.n;
    return this.n;
  }
  value(): number {
    if (this.now().getTime() - this.at > 60_000) void this.refresh().catch((e) => console.error('[raised] population refresh failed', e));
    return this.n;
  }
}
