import { and, gte, inArray, like, or, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { worldModelCalls } from '../../db/schema.ts';
import type { ModelBudget } from '../haiku.ts';
import type { BudgetPeriod } from '../../world/budget.ts';

/** The world_model_calls purposes that book on the scene share. */
export const SCENE_PURPOSES = ['scene', 'long_take'] as const;
/**
 * Scenes and long takes never take the last fifth of the day's cap: once the whole day's spend passes 80%, they fall back to
 * phrasebook scenes and the rest is left to replies to humans, hatches and big moments.
 */
export const SCENE_HEADROOM = 0.8;
const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Scenes' slice of the owner's $1/day, as RAISE's gate does for raised agents: every scene and long-take call books against
 * `share` of the daily cap as well as the Budget, whose hard stop at 100% still covers everything. Held in memory and seeded
 * from today's world_model_calls by load(), so the share survives restarts.
 */
export class SceneShare {
  private day: string;
  private spent = 0;
  /** `period`: the budget's current span (the day, or the launch window); without it the share is per UTC day of `dailyUsd`. */
  constructor(private o: { db: Db; now: () => Date; dailyUsd: number; share: number; period?: () => BudgetPeriod }) { this.day = this.key(); }
  private key() { return this.o.period?.().key ?? dayOf(this.o.now()); }
  private capOfPeriod() { return this.o.period?.().usd ?? this.o.dailyUsd; }

  private roll() { const d = this.key(); if (d !== this.day) { this.day = d; this.spent = 0; } }
  cap() { return this.o.share * this.capOfPeriod(); }
  spentToday() { this.roll(); return this.spent; }
  canAfford(usd: number) { return this.spentToday() + usd <= this.cap() + 1e-12; }
  add(usd: number) { this.roll(); this.spent += usd; }

  async load(): Promise<void> {
    this.day = this.key();
    const start = this.o.period?.().start ?? new Date(`${dayOf(this.o.now())}T00:00:00Z`);
    const [r] = await this.o.db.select({ s: sql<number>`coalesce(sum(${worldModelCalls.costUsd}), 0)::float8` }).from(worldModelCalls)
      .where(and(gte(worldModelCalls.startedAt, start), or(inArray(worldModelCalls.purpose, [...SCENE_PURPOSES]), like(worldModelCalls.purpose, 'thread:%'))));
    this.spent = Number(r?.s ?? 0);
  }

  /** The budget a scene or long-take call books against: the day's cap, its headroom, and this share, all at once. */
  budgetFor(budget: ModelBudget): ModelBudget {
    return {
      canSpend: () => budget.canSpend(),
      canAfford: (usd) => budget.canAfford(usd) && this.canAfford(usd) && budget.spentToday() + usd <= SCENE_HEADROOM * this.capOfPeriod() + 1e-12,
      add: (usd) => { budget.add(usd); this.add(usd); },
      spentToday: () => budget.spentToday(),
      ...(budget.admits ? { admits: (who: () => Promise<string[] | null>) => budget.admits!(who) } : {}),
    };
  }
}
