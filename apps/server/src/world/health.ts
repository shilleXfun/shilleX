import { and, eq, isNotNull, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { agentTurns, agents, siteVersions, wallets } from '../db/schema.ts';
import { jobStates, redact } from './jobs.ts';
import type { WorldHandles } from './boot.ts';
import { RoutedBrain } from './brain-openai.ts';
import { rpcMeterState } from './rpc-meter.ts';
import { costMeterState } from './cost-meter.ts';

/** No good engine tick for this long, while the engine runs, is a warning. */
export const TICK_WARN_MS = 15 * 60_000;
/** A site build may run this late past its slot (24 h / SITES_PER_DAY) before it is a warning. */
export const SITE_GRACE_MS = 2 * 3_600_000;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const hours = (ms: number) => `${Math.round(ms / 360_000) / 10} h`;

/**
 * Whether the world is actually alive, beside /api/health (which only says the process answers): the halt switch, the engine's
 * last good tick, the last website, paused model calls, the budget, every job's last run, and plain-language warnings for each
 * condition that needs a human (2026-10-25 upgrade, Phase A). Public, so nothing in it is secret: errors are redacted.
 */
export async function worldHealth(app: FastifyInstance, w: WorldHandles) {
  const { db, config, now } = app.deps;
  const t = now();
  const [[turn], [site], [eligible], jobs] = await Promise.all([
    db.select({ at: sql<Date | null>`max(${agentTurns.startedAt})` }).from(agentTurns),
    db.select({ at: sql<Date | null>`max(${siteVersions.createdAt})` }).from(siteVersions),
    db.select({ n: sql<number>`count(*)::int` }).from(agents).innerJoin(wallets, and(eq(wallets.ownerId, agents.userId), isNotNull(wallets.fundedAt)))
      .where(and(eq(agents.status, 'active'), ne(agents.origin, 'external'))),
    jobStates(db),
  ]);
  const lastTurnAt = turn?.at ? new Date(turn.at) : null;
  const lastSiteAt = site?.at ? new Date(site.at) : null;
  const engine = w.engine?.stats() ?? null;
  const pause = w.halt?.state() ?? null;
  const siteJob = jobs.find((j) => j.name === 'site-build') ?? null;
  const warnings: string[] = [];

  if (config.worldHalted) warnings.push('The world is halted (WORLD_HALTED=on): no agent acts and no website is built until it is turned off.');
  else if (!w.engine) warnings.push(config.agentsOn ? 'The engine is not running: the world is not set up or no agent wallet is funded (see /admin).' : 'The engine is off (AGENTS is not on).');
  if (engine) {
    const ok = engine.lastOkAt ? new Date(engine.lastOkAt) : null;
    if ((ok && t.getTime() - ok.getTime() > TICK_WARN_MS) || (!ok && engine.ticks > 20)) warnings.push(`No good engine tick for over ${TICK_WARN_MS / 60_000} min (${engine.failing} failed in a row): ${redact(engine.lastError ?? 'no error recorded')}`);
    if (Number(eligible?.n ?? 0) === 0) warnings.push('No agent is eligible to act (none is active with a funded wallet).');
  }
  if (w.engine && config.sitesPerDay > 0) {
    // Agents build when they feel like it (sites/plan.ts WANT_TO_BUILD): a few an hour, by chance. Four quiet hours is a problem.
    const every = Math.max(4 * 3_600_000, 86_400_000 / config.sitesPerDay);
    if (lastSiteAt && t.getTime() - lastSiteAt.getTime() > every + SITE_GRACE_MS) warnings.push(`No website built for ${hours(t.getTime() - lastSiteAt.getTime())} (one is due every ${hours(every)}).`);
  }
  if (siteJob && siteJob.failures >= 2) warnings.push(`Website builds failed ${siteJob.failures} times in a row (${siteJob.errorCategory}): ${siteJob.lastError ?? ''}`);
  if (w.brain instanceof RoutedBrain && !w.brain.status().some((p) => p.why === null)) warnings.push(`No model provider is usable: ${w.brain.status().map((p) => `${p.name}: ${p.why}`).join('; ')}`);
  if (pause?.down) warnings.push(`The brain is down since ${pause.down.since} (${pause.down.probes} probes failed): ${redact(pause.down.reason)}`);
  else if (pause?.reason) warnings.push(`Model calls are paused until ${pause.until}: ${redact(pause.reason)}`);
  if (w.engine && w.budget.level() === 'stopped') warnings.push('The model budget of this period is spent: model posts wait, the free engine and site builder go on.');
  for (const j of jobs) {
    if (j.lastStatus === 'running' && j.leaseUntil && j.leaseUntil < t) warnings.push(`Job ${j.name} stopped mid-run (its lease expired ${iso(j.leaseUntil)}); the next run takes it over.`);
    else if (j.name !== 'site-build' && j.failures >= 3) warnings.push(`Job ${j.name} failed ${j.failures} times in a row (${j.errorCategory}): ${j.lastError ?? ''}`);
  }

  return {
    checkedAt: t.toISOString(),
    ok: warnings.length === 0,
    halted: config.worldHalted,
    engine: engine ? { running: true, ticks: engine.ticks, lastOkAt: engine.lastOkAt, failing: engine.failing, lastError: engine.lastError ? redact(engine.lastError) : null } : { running: false },
    lastTurnAt: iso(lastTurnAt),
    eligibleAgents: Number(eligible?.n ?? 0),
    sites: { perDay: config.sitesPerDay, lastBuiltAt: iso(lastSiteAt), lastStatus: siteJob?.lastStatus ?? null, lastNote: siteJob?.lastNote ?? null, failuresInRow: siteJob?.failures ?? 0 },
    model: {
      brain: w.brain ? w.brain.name ?? 'on' : 'off',
      down: pause?.down ? { ...pause.down, reason: redact(pause.down.reason) } : null,
      providers: w.brain instanceof RoutedBrain ? w.brain.status().map((p) => ({ ...p, lastError: p.lastError ? redact(p.lastError) : null })) : [],
      paused: pause?.reason ? { reason: redact(pause.reason), until: pause.until } : null,
      pausesInRow: pause?.trips ?? 0,
      queued: w.moments?.size() ?? 0,
    },
    quiet: w.quiet?.state() ?? null,
    rpc: rpcMeterState(),
    cost: costMeterState(),
    budget: { capUsd: w.budget.capUsd(), spentUsd: Math.round(w.budget.spentToday() * 1e4) / 1e4, level: w.budget.level() },
    jobs: jobs.map((j) => ({
      name: j.name, lastStatus: j.lastStatus, lastStartedAt: iso(j.lastStartedAt), lastFinishedAt: iso(j.lastFinishedAt), lastOkAt: iso(j.lastOkAt),
      note: j.lastNote, failuresInRow: j.failures, errorCategory: j.errorCategory, lastError: j.lastError, retryAt: iso(j.retryAt), runs: j.runs,
    })),
    warnings,
  };
}
export type WorldHealth = Awaited<ReturnType<typeof worldHealth>>;
