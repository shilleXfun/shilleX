import { and, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { siteBuilds } from '../db/schema.ts';
import { anthropicClient } from '../lib/anthropic.ts';
import type { ModelBudget } from '../agents/haiku.ts';
import { CeilingReached, ClaudeBrain, InputTooLarge, type AgentBrain, type BrainRequest, type SpendCeiling } from '../world/brain.ts';

/**
 * Websites on Claude Opus 5.5 (owner, 2026-10-29: "websites are now made using opus 5.5"). The brief, the page and the creative
 * director's review all go to Opus, and the house pays (an agent's daily compute could not cover a page): up to SITES_USD_PER_DAY
 * over any 24 hours, counted apart from the world's cap so the agents' everyday thinking is never starved by a build. When Opus
 * answers with an error (no key, a usage limit, an outage) the call is made by the everyday model instead and Opus rests for
 * SITE_MODEL_REST_MS, so an Anthropic problem never pauses the world's own brain; past the day's money the everyday model builds.
 */
export const SITE_MODEL_REST_MS = 30 * 60_000;
const DAY_MS = 24 * 3_600_000;

/** What sites are built with when the strong model is up: its brain, its own budget, and its name for the receipts. */
export interface SiteModel { model: string; brain: AgentBrain; budget: ModelBudget; usable(): boolean }

/** A cap over the last 24 hours: reservations and settlements are entries, each forgotten a day after it was made. */
export class RollingBudget implements ModelBudget {
  private log: { at: number; usd: number }[] = [];
  constructor(private usd: number, private now: () => Date) {}
  private sum() { const t = this.now().getTime(); this.log = this.log.filter((x) => t - x.at < DAY_MS); return this.log.reduce((n, x) => n + x.usd, 0); }
  canSpend() { return this.sum() < this.usd; }
  canAfford(usd: number) { return this.sum() + usd <= this.usd; }
  add(usd: number) { this.log.push({ at: this.now().getTime(), usd }); }
  spentToday() { return Math.max(0, this.sum()); }
  capUsd() { return this.usd; }
}

/** What builds on `model` cost over the last 24 hours (their receipts), so a restart does not hand out a fresh day. */
export async function siteModelSpent(db: Db, model: string, now: Date): Promise<number> {
  const [r] = await db.select({ s: sql<number>`coalesce(sum(${siteBuilds.costUsd}), 0)::float8` }).from(siteBuilds)
    .where(and(eq(siteBuilds.model, model), gte(siteBuilds.startedAt, new Date(now.getTime() - DAY_MS))));
  return Number(r?.s ?? 0);
}

export function createSiteModel(o: {
  model: string; usdPerDay: number; fallback: AgentBrain; now: () => Date;
  /** The Anthropic key; tests pass `strong` instead. */ apiKey?: string; strong?: AgentBrain; ceiling?: SpendCeiling;
}): SiteModel {
  let strong = o.strong;
  if (!strong) {
    const b = new ClaudeBrain(o.apiKey ?? '', o.model, anthropicClient(o.apiKey ?? '', 0), o.model);
    if (o.ceiling) b.useCeiling(o.ceiling);
    strong = b;
  }
  const budget = new RollingBudget(o.usdPerDay, o.now);
  let restUntil = 0;
  const brain: AgentBrain = {
    name: o.model,
    async decide(req: BrainRequest) {
      if (o.now().getTime() < restUntil) return o.fallback.decide(req);
      try { return await strong!.decide(req); }
      catch (e) {
        // Too large or over the hard ceiling: the everyday model would be refused the same way.
        if (e instanceof InputTooLarge || e instanceof CeilingReached) throw e;
        restUntil = o.now().getTime() + SITE_MODEL_REST_MS;
        console.warn(`[sites] ${o.model} did not answer (${(e as Error)?.message?.slice(0, 160) ?? e}); the everyday model builds for the next 30 minutes`);
        return o.fallback.decide(req);
      }
    },
  };
  return { model: o.model, brain, budget, usable: () => o.now().getTime() >= restUntil && budget.canSpend() };
}
