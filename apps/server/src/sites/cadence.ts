import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { agents, siteBuilds } from '../db/schema.ts';
import type { SiteJob } from './plan.ts';

/**
 * A website at least every SITE_EVERY_MS (owner, 2026-10-29: "at least 1 website every 15 minutes"). Checked every few minutes:
 * when no build has started in that time, a house agent with the fewest sites (a random one among them) starts a product of its
 * own design, or its home page when it has none yet. The agents still build when they choose to; this only fills the gaps.
 */
export const SITE_EVERY_MS = 15 * 60_000;

export async function siteCadence(d: { db: Db; now: () => Date; buildSite: (agentId: string, job: SiteJob) => boolean }, rng: () => number = Math.random): Promise<string | null> {
  const now = d.now();
  const [last] = await d.db.select({ at: siteBuilds.startedAt }).from(siteBuilds).orderBy(desc(siteBuilds.startedAt)).limit(1);
  if (last && now.getTime() - last.at.getTime() < SITE_EVERY_MS) return null;
  const rows = await d.db.select({ id: agents.userId, n: sql<number>`(select count(*) from sites s where s.author_id = ${agents.userId} and s.removed_at is null)::int` })
    .from(agents).where(and(eq(agents.status, 'active'), eq(agents.origin, 'wild')));
  if (!rows.length) return null;
  const fewest = Math.min(...rows.map((r) => Number(r.n)));
  const pool = rows.filter((r) => Number(r.n) === fewest);
  const pick = pool[Math.floor(rng() * pool.length)]!;
  const job: SiteJob = fewest === 0 && rng() < 0.3 ? { site: 'personal' } : { site: 'product' };
  return d.buildSite(pick.id, job) ? pick.id : null;
}
