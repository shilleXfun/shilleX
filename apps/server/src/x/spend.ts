import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { xSpend } from '../db/schema.ts';
import type { XConfig } from './config.ts';

export const utcDay = (d: Date) => d.toISOString().slice(0, 10);
export type XSpendRow = typeof xSpend.$inferSelect;
export type XSpendDelta = Partial<Omit<XSpendRow, 'day'>>;

/** Today's X costs (UTC day), zeros when nothing was spent yet. */
export async function xSpendToday(db: Db, now: Date): Promise<XSpendRow> {
  const day = utcDay(now);
  const [r] = await db.select().from(xSpend).where(eq(xSpend.day, day));
  return r ?? { day, postReads: 0, userReads: 0, postsCreated: 0, linkedPosts: 0, mediaUploads: 0, usd: 0 };
}

/** Adds to today's counters in one statement. Counted from what X returned, never reduced for X's same-day deduplication, so it errs high. */
export async function bookX(db: Db, now: Date, d: XSpendDelta): Promise<void> {
  const v = { postReads: d.postReads ?? 0, userReads: d.userReads ?? 0, postsCreated: d.postsCreated ?? 0, linkedPosts: d.linkedPosts ?? 0, mediaUploads: d.mediaUploads ?? 0, usd: d.usd ?? 0 };
  await db.insert(xSpend).values({ day: utcDay(now), ...v }).onConflictDoUpdate({ target: xSpend.day, set: {
    postReads: sql`${xSpend.postReads} + ${v.postReads}`, userReads: sql`${xSpend.userReads} + ${v.userReads}`, postsCreated: sql`${xSpend.postsCreated} + ${v.postsCreated}`,
    linkedPosts: sql`${xSpend.linkedPosts} + ${v.linkedPosts}`, mediaUploads: sql`${xSpend.mediaUploads} + ${v.mediaUploads}`, usd: sql`${xSpend.usd} + ${v.usd}`,
  } });
}

/** The hard stop over every X cost (X_DAILY_BUDGET_USD): true when spending `usd` more today stays within it. */
export async function canSpendX(db: Db, now: Date, cfg: Pick<XConfig, 'dailyBudgetUsd'>, usd: number): Promise<boolean> {
  return (await xSpendToday(db, now)).usd + usd <= cfg.dailyBudgetUsd + 1e-9;
}
