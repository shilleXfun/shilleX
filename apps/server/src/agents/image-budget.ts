import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { imageSpend } from '../db/schema.ts';

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Whether today's (UTC) image budget allows another paid call. `nextUsd` is the worst-case price of the call about to be made:
 * pass it right before paying so the call can never take the day over its dollar budget.
 */
export async function canGenerate(db: Db, limits: { usd: number; max: number }, now: Date, nextUsd = 0): Promise<boolean> {
  const [r] = await db.select().from(imageSpend).where(eq(imageSpend.day, day(now)));
  const usd = r?.usd ?? 0, count = r?.count ?? 0;
  return usd < limits.usd && usd + nextUsd <= limits.usd && count < limits.max;
}

/** Durable, so a restart remembers what today already cost. */
export async function recordImageSpend(db: Db, usd: number, now: Date): Promise<void> {
  await db.insert(imageSpend).values({ day: day(now), usd, count: 1 })
    .onConflictDoUpdate({ target: imageSpend.day, set: { usd: sql`${imageSpend.usd} + ${usd}`, count: sql`${imageSpend.count} + 1` } });
}
