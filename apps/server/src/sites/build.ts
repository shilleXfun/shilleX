import { eq } from 'drizzle-orm';
import { sites } from '../db/schema.ts';
import type { EngineDeps } from '../agents/engine.ts';
import { exclusiveTurn } from '../agents/moments.ts';
import { runJob, type JobOutcome } from '../world/jobs.ts';
import { buildsToday, mayBuild, stillValid, type SiteJob } from './plan.ts';
import type { ModelBudget } from '../agents/haiku.ts';
import type { AgentBrain } from '../world/brain.ts';
import { buildProduct, type StudioJob } from './products.ts';
import type { SiteModel } from './opus.ts';

/**
 * An agent builds a website (2026-10-27): every kind of site, its own, its coin's, its faction's, a product or the next version of
 * one, is designed by the agent in the studio (sites/products.ts, sites/studio.ts). The templates and genres that made every site
 * look alike are gone; without a model nothing is built.
 */
export type SiteDeps = Pick<EngineDeps, 'app' | 'db' | 'chain' | 'events' | 'worldKey' | 'now' | 'busy' | 'halt'> & { budget?: ModelBudget; /** The model sites are designed and written with. */ brain?: AgentBrain | null;
  /** Claude Opus for sites while it is up and within its day's money (sites/opus.ts); the brain above otherwise. */ siteModel?: SiteModel | null };

/** A site from before the studio (a template page, or one of the old genres) gets its first designed version when it is rebuilt. */
const BEFORE_STUDIO = 'the page now live was made from a template before the studio; this is the first version you design yourself';

async function buildSite(d: SiteDeps, agentId: string, job: SiteJob): Promise<JobOutcome> {
  const now = d.now();
  if ((await buildsToday(d.db, now)) >= d.app.deps.config.sitesPerDay) return { status: 'skipped', note: 'today’s builds are done' };
  if (!(await mayBuild(d.db, agentId, now)) || !(await stillValid(d.db, agentId, job, now))) return { status: 'skipped', note: `the ${job.site} job is no longer valid` };
  // The brain is down or paused (halt.ts): no model call, so no build (2026-10-27: 14 builds refused by a usage limit).
  const deps = { ...d, brain: d.halt?.reason() ? null : d.brain ?? null, budget: d.budget ?? null };
  if (job.site === 'rebuild') {
    const [s] = await d.db.select({ id: sites.id }).from(sites).where(eq(sites.id, job.siteId));
    return s ? buildProduct(deps, agentId, { site: 'improve', siteId: s.id }, { force: BEFORE_STUDIO }) : { status: 'skipped', note: 'no site to rebuild' };
  }
  if (job.site === 'improve' && job.changes) return buildProduct(deps, agentId, { site: 'improve', siteId: job.siteId }, { force: job.changes });
  return buildProduct(deps, agentId, job as StudioJob);
}

const building = new WeakSet<SiteDeps['app']>();
/** A build may hold the job this long (two tries of a page, a review and two renders each); a process that died mid-build frees it after. */
const BUILD_LEASE_MS = 25 * 60_000;

/**
 * Starts a site build for this agent now (sites/plan.ts calls it). One build at a time, beside the engine rather than inside a tick
 * (a page takes minutes), under the 'site-build' job lease so a second process cannot build the same slot. False when a build is
 * already running here; the planner asks again on its next look.
 */
export function siteBuilder(d: SiteDeps): (agentId: string, job: SiteJob) => boolean {
  return (agentId, job) => {
    if (building.has(d.app)) return false;
    building.add(d.app);
    void runJob(d.db, 'site-build', { now: d.now, leaseMs: BUILD_LEASE_MS }, async () => {
      const r = await exclusiveTurn(d, agentId, () => buildSite(d, agentId, job));
      return r.ran ? r.value : { status: 'skipped', note: `the agent was ${r.reason}` };
    })
      .then((r) => { if (!r.ran) console.log(`[sites] build not started: ${r.reason}`); })
      .finally(() => building.delete(d.app));
    return true;
  };
}
