import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import type { AgentJob } from '@shillex/shared';
import { agentPersonas, agentTurns, agents, factionMembers, factions, sites, worldCoins } from '../db/schema.ts';
import type { EngineDeps } from '../agents/engine.ts';

/**
 * When agents build websites (x-revamp §3). Since 2026-10-26 (owner: "build more often, with no rules") there is no schedule: an
 * agent builds when it feels like it, each time the engine picks it, and builders feel like it far more often than anyone else
 * (WANT_TO_BUILD). What stays: a coin's own site goes to its launcher first, one build runs at a time, and SITES_PER_DAY as a
 * safety cap on cost. A builder may make as many products as it has ideas (the brief check still refuses a repeated idea).
 * The build itself (sites/build.ts siteBuilder) runs beside the free engine and never waits on the model queue.
 */
export const SITE_PROMPT_VERSION = 'site-v1';
/**
 * How likely an agent is to start building when the engine picks it, by job. The engine picks an agent every few seconds, so
 * this is a few builds an hour across the world, spread out by chance rather than by a timer.
 */
export const WANT_TO_BUILD: Record<AgentJob, number> = { builder: 0.015, dev: 0.004, analyst: 0.002, social: 0.0012, replyguy: 0.0008, whale: 0.0008, lurker: 0.0005 };
/** A site can be rebuilt once its newest build is this old. */
export const REBUILD_AFTER_MS = 3 * 86_400_000;
/** A coin still gets its site if it launched this recently (its launch hook may have found the queue busy or closed). */
export const COIN_WINDOW_MS = 6 * 3_600_000;

/** 'product' and 'improve' (2026-10-25, Phase E): a product the agent conceives and builds, or the next version of one. */
/** `collab`: built together with another agent who said yes (agents/director.ts); `changes`: what the agent itself wants in the next version. */
export type SiteJob = { site: 'coin'; mint: string } | { site: 'personal' } | { site: 'faction'; factionId: string } | { site: 'rebuild'; siteId: string }
  | { site: 'product'; collab?: { withId: string; idea: string }; /** Another agent's site it forks or parodies. */ forkOf?: string } | { site: 'improve'; siteId: string; changes?: string };

const dayStart = (now: Date) => new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);

/** Builds tried today (UTC), worked or not: SITES_PER_DAY caps these. */
export async function buildsToday(db: Db, now: Date): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(agentTurns).where(and(eq(agentTurns.promptVersion, SITE_PROMPT_VERSION), gte(agentTurns.startedAt, dayStart(now))));
  return r?.n ?? 0;
}

/** A house or raised agent that is active (outside agents publishing sites is a later pass). No cooldown: it builds when it wants to. */
export async function mayBuild(db: Db, agentId: string, _now?: Date): Promise<boolean> {
  const [a] = await db.select({ origin: agents.origin, status: agents.status }).from(agents).where(eq(agents.userId, agentId));
  return Boolean(a && a.origin !== 'external' && a.status === 'active');
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
  // Another product is always worth building: the brief check refuses an idea that already exists.
  if (job.site === 'product') return true;
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
  // A new product is always on the table; an old one may get its next version.
  options.push({ job: { site: 'product' }, weight: 3 });
  const product = own.find((s) => s.kind === 'product' && now.getTime() - s.updatedAt.getTime() >= REBUILD_AFTER_MS);
  if (product) options.push({ job: { site: 'improve', siteId: product.id }, weight: 1.5 });
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

/** A launched coin is looked for at most this often (a cheap look, but every engine tick calls in). */
const COIN_LOOK_MS = 60_000;
const lastCoinLook = new WeakMap<FastifyInstance, number>();

/**
 * Called on every engine tick with the agent the engine picked (agents/engine.ts). A recent coin still without its site comes
 * first (its launcher builds it); otherwise the picked agent builds if it feels like it (WANT_TO_BUILD by its job). Never throws.
 */
export async function planSites(d: EngineDeps, agentId: string): Promise<void> {
  const perDay = d.app.deps.config.sitesPerDay;
  if (perDay <= 0) return;
  const now = d.now();
  try {
    if (now.getTime() - (lastCoinLook.get(d.app) ?? 0) >= COIN_LOOK_MS) {
      lastCoinLook.set(d.app, now.getTime());
      const coin = await coinWithoutSite(d.db, now);
      if (coin && (await buildsToday(d.db, now)) < perDay) { enqueue(d, coin.creatorId, { site: 'coin', mint: coin.mint }); return; }
    }
    const [persona] = await d.db.select({ job: agentPersonas.job }).from(agentPersonas).where(eq(agentPersonas.agentId, agentId));
    if (d.rng() >= WANT_TO_BUILD[persona?.job ?? 'social']) return;
    if ((await buildsToday(d.db, now)) >= perDay || !(await mayBuild(d.db, agentId, now))) return;
    const job = await ambientJob(d.db, agentId, now, d.rng);
    if (job) enqueue(d, agentId, job);
  } catch (e) { console.error('[sites] planning failed', e); }
}
