import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { agentPersonas, agentTurns, agents, factionMembers, factions, siteBuilds, sites, worldCoins } from '../db/schema.ts';
import type { EngineDeps } from '../agents/engine.ts';

/**
 * When agents build websites (x-revamp §3): a site for a coin when they launch it, now and then a personal or faction site,
 * occasionally a rebuild. The engine and the launch call in here with one line each; the build itself (sites/build.ts
 * siteBuilder) runs beside the free engine. It never waits on the model queue: the local builder is free (2026-10-25).
 */
export const SITE_PROMPT_VERSION = 'site-v1';
/** One build per agent per 48 hours, whatever kind, and whether it worked or not: builders build rarely and well (2026-10-26). */
export const SITE_COOLDOWN_MS = 48 * 3_600_000;
/** Products built or improved per UTC day across the whole world. */
export const PRODUCTS_PER_DAY = 3;
/** A site can be rebuilt once its newest build is this old. */
export const REBUILD_AFTER_MS = 3 * 86_400_000;
/** A coin still gets its site if it launched this recently (its launch hook may have found the queue busy or closed). */
export const COIN_WINDOW_MS = 6 * 3_600_000;
/** How often the engine's tick looks for something to build. */
export const PLAN_EVERY_MS = 5 * 60_000;

/** 'product' and 'improve' (2026-10-25, Phase E): a product the agent conceives and builds, or the next version of one. */
export type SiteJob = { site: 'coin'; mint: string } | { site: 'personal' } | { site: 'faction'; factionId: string } | { site: 'rebuild'; siteId: string } | { site: 'product' } | { site: 'improve'; siteId: string };

const dayStart = (now: Date) => new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);

/** Builds tried today (UTC), worked or not: SITES_PER_DAY caps these. */
export async function buildsToday(db: Db, now: Date): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(agentTurns).where(and(eq(agentTurns.promptVersion, SITE_PROMPT_VERSION), gte(agentTurns.startedAt, dayStart(now))));
  return r?.n ?? 0;
}

/** A house or raised agent that is active and has not tried a build in the last 12 hours. Outside agents publishing sites is a later pass. */
export async function mayBuild(db: Db, agentId: string, now: Date): Promise<boolean> {
  const [a] = await db.select({ origin: agents.origin, status: agents.status }).from(agents).where(eq(agents.userId, agentId));
  if (!a || a.origin === 'external' || a.status !== 'active') return false;
  const [recent] = await db.select({ id: agentTurns.id }).from(agentTurns).where(and(eq(agentTurns.agentId, agentId),
    eq(agentTurns.promptVersion, SITE_PROMPT_VERSION), gte(agentTurns.startedAt, new Date(now.getTime() - SITE_COOLDOWN_MS)))).limit(1);
  return !recent;
}

/** The faction this agent is in now, if any. */
export async function factionOf(db: Db, agentId: string) {
  const [f] = await db.select({ f: factions }).from(factionMembers).innerJoin(factions, eq(factions.id, factionMembers.factionId))
    .where(and(eq(factionMembers.agentId, agentId), isNull(factionMembers.leftAt), isNull(factions.splitAt))).limit(1);
  return f?.f ?? null;
}

/** Still worth building when the moment runs: the coin, faction or site is as the job found it. */
export async function stillValid(db: Db, agentId: string, job: SiteJob, now: Date): Promise<boolean> {
  if (job.site === 'coin') {
    const [c] = await db.select({ creatorId: worldCoins.creatorId, archivedAt: worldCoins.archivedAt }).from(worldCoins).where(eq(worldCoins.mint, job.mint));
    const [has] = await db.select({ id: sites.id }).from(sites).where(eq(sites.coinMint, job.mint)).limit(1);
    return Boolean(c && c.creatorId === agentId && !c.archivedAt && !has);
  }
  if (job.site === 'faction') {
    const f = await factionOf(db, agentId);
    const [has] = await db.select({ id: sites.id }).from(sites).where(eq(sites.factionId, job.factionId)).limit(1);
    return f?.id === job.factionId && !has;
  }
  if (job.site === 'product') {
    const [has] = await db.select({ id: sites.id }).from(sites).where(and(eq(sites.authorId, agentId), eq(sites.kind, 'product'), isNull(sites.removedAt))).limit(1);
    return !has;
  }
  if (job.site === 'improve') {
    const [s] = await db.select({ authorId: sites.authorId, kind: sites.kind, removedAt: sites.removedAt }).from(sites).where(eq(sites.id, job.siteId));
    return Boolean(s && s.authorId === agentId && s.kind === 'product' && !s.removedAt);
  }
  if (job.site === 'personal') {
    const [has] = await db.select({ id: sites.id }).from(sites).where(and(eq(sites.authorId, agentId), eq(sites.kind, 'personal'))).limit(1);
    return !has;
  }
  const [s] = await db.select({ authorId: sites.authorId, updatedAt: sites.updatedAt, removedAt: sites.removedAt }).from(sites).where(eq(sites.id, job.siteId));
  return Boolean(s && s.authorId === agentId && !s.removedAt && now.getTime() - s.updatedAt.getTime() >= REBUILD_AFTER_MS);
}

/**
 * What this agent could build now and then: its own product (first, and by far most likely: on 2026-10-25 a faction page still won
 * one build in five), the next version of it, its faction's first site, its own first page, or a rebuild of an old page. Without a
 * model, sites/build.ts turns a product job into its page.
 */
async function ambientJob(db: Db, agentId: string, now: Date, rng: () => number): Promise<SiteJob | null> {
  const options: { job: SiteJob; weight: number }[] = [];
  const f = await factionOf(db, agentId);
  if (f) {
    const [has] = await db.select({ id: sites.id }).from(sites).where(eq(sites.factionId, f.id)).limit(1);
    // A product for the faction (sites/products.ts), as worth building as the builder's own.
    if (!has) options.push({ job: { site: 'faction', factionId: f.id }, weight: 1.5 });
  }
  const own = await db.select({ id: sites.id, kind: sites.kind, updatedAt: sites.updatedAt }).from(sites)
    .where(and(eq(sites.authorId, agentId), isNull(sites.removedAt))).orderBy(sites.updatedAt);
  const product = own.find((s) => s.kind === 'product');
  if (!product) options.push({ job: { site: 'product' }, weight: 3 });
  else if (now.getTime() - product.updatedAt.getTime() >= REBUILD_AFTER_MS) options.push({ job: { site: 'improve', siteId: product.id }, weight: 1.5 });
  if (!own.some((s) => s.kind === 'personal')) options.push({ job: { site: 'personal' }, weight: 0.25 });
  const old = own.find((s) => s.kind !== 'product' && now.getTime() - s.updatedAt.getTime() >= REBUILD_AFTER_MS);
  if (old) options.push({ job: { site: 'rebuild', siteId: old.id }, weight: 0.15 });
  let x = rng() * options.reduce((n, o) => n + o.weight, 0);
  for (const o of options) { x -= o.weight; if (x <= 0) return o.job; }
  return options.at(-1)?.job ?? null;
}

/** The newest coin launched in the last hours by a house or raised agent that has no site yet and whose creator may build now. */
async function coinWithoutSite(db: Db, now: Date): Promise<{ mint: string; creatorId: string } | null> {
  const recent = await db.select({ mint: worldCoins.mint, creatorId: worldCoins.creatorId }).from(worldCoins).innerJoin(agents, eq(agents.userId, worldCoins.creatorId))
    .where(and(gte(worldCoins.launchedAt, new Date(now.getTime() - COIN_WINDOW_MS)), isNull(worldCoins.archivedAt), inArray(agents.origin, ['wild', 'raised'])))
    .orderBy(desc(worldCoins.launchedAt)).limit(20);
  if (!recent.length) return null;
  const done = new Set((await db.select({ mint: sites.coinMint }).from(sites).where(inArray(sites.coinMint, recent.map((c) => c.mint)))).map((r) => r.mint));
  for (const c of recent) if (!done.has(c.mint) && (await mayBuild(db, c.creatorId, now))) return c;
  return null;
}

/**
 * Starts a build now. Boot hands the engine its builder (d.buildSite, with the model budget for a model-written page); without
 * one (tests, scripts) the local builder runs. Either way it is never routed through the model queue, which refuses work while
 * the model is paused or the budget's pace is closed: that silently stopped free builds before (docs/system-audit.md §3).
 */
function enqueue(d: EngineDeps, agentId: string, job: SiteJob): boolean {
  if (d.buildSite) return d.buildSite(agentId, job);
  void import('./build.ts').then(({ siteBuilder }) => siteBuilder(d)(agentId, job)).catch((e) => console.error('[sites] local build failed', e));
  return true;
}

/** Called right after an agent launches a coin (agents/act.ts): its site is built on the next drain, if today allows. */
export function queueCoinSite(d: EngineDeps, agentId: string, mint: string): void {
  if (d.app.deps.config.sitesPerDay > 0) enqueue(d, agentId, { site: 'coin', mint });
}

const nextPlan = new WeakMap<FastifyInstance, number>();
/** Whether any build was tried since `since`, any agent, any kind: ambient builds are spread over the day. */
async function builtSince(db: Db, since: Date): Promise<boolean> {
  const [r] = await db.select({ id: agentTurns.id }).from(agentTurns).where(and(eq(agentTurns.promptVersion, SITE_PROMPT_VERSION), gte(agentTurns.startedAt, since))).limit(1);
  return Boolean(r);
}

/**
 * Called on every engine tick with the agent the engine picked (agents/engine.ts). Every few minutes it queues one build: a
 * recent coin still without a site first, else (at most once per day/SITES_PER_DAY) something for the picked agent. Never throws.
 */
export async function planSites(d: EngineDeps, agentId: string): Promise<void> {
  const perDay = d.app.deps.config.sitesPerDay;
  if (perDay <= 0) return;
  const now = d.now();
  if (now.getTime() < (nextPlan.get(d.app) ?? 0)) return;
  nextPlan.set(d.app, now.getTime() + PLAN_EVERY_MS);
  try {
    if ((await buildsToday(d.db, now)) >= perDay) return;
    const coin = await coinWithoutSite(d.db, now);
    if (coin) { enqueue(d, coin.creatorId, { site: 'coin', mint: coin.mint }); return; }
    if (await builtSince(d.db, new Date(now.getTime() - 86_400_000 / perDay))) return;
    // Only builders build (agents/personas.ts jobs): most agents never do. A coin's own site above is its launcher's.
    const [persona] = await d.db.select({ job: agentPersonas.job }).from(agentPersonas).where(eq(agentPersonas.agentId, agentId));
    if (persona?.job !== 'builder') return;
    const [{ n }] = await d.db.select({ n: sql<number>`count(*)::int` }).from(siteBuilds).where(gte(siteBuilds.startedAt, dayStart(now))) as [{ n: number }];
    if (Number(n) >= PRODUCTS_PER_DAY) return;
    if (!(await mayBuild(d.db, agentId, now))) return;
    const job = await ambientJob(d.db, agentId, now, d.rng);
    if (job) enqueue(d, agentId, job);
  } catch (e) { console.error('[sites] planning failed', e); }
}
