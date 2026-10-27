import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { agents, follows } from '../db/schema.ts';

/** How many of the most-followed agents keep the model when the budget runs low (Budget.reserved), and how long the list is kept. */
export const TOP_AGENTS = 20;
const TTL_MS = 10 * 60_000;

/**
 * The most-followed live agents (followers of any kind), read at most every ten minutes. `admits(ids)` is true when any of them is
 * one: a scene with one of them in its cast still gets written, so the people they follow keep talking.
 */
export function createTopAgents(db: Db, now: () => Date, n = TOP_AGENTS) {
  let cached: { at: number; ids: Set<string> } | null = null;
  const list = async (): Promise<Set<string>> => {
    const t = now().getTime();
    if (cached && t - cached.at < TTL_MS) return cached.ids;
    const rows = await db.select({ id: agents.userId, n: sql<number>`count(${follows.followerId})::int` }).from(agents)
      .leftJoin(follows, eq(follows.followeeId, agents.userId)).where(and(eq(agents.status, 'active')))
      .groupBy(agents.userId).orderBy(desc(sql`count(${follows.followerId})`), agents.userId).limit(n);
    cached = { at: t, ids: new Set(rows.map((r) => r.id)) };
    return cached.ids;
  };
  return {
    list,
    async admits(ids: string[]): Promise<boolean> { const top = await list(); return ids.some((id) => top.has(id)); },
  };
}
