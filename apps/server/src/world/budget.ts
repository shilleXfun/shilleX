import { gte, sql } from 'drizzle-orm';
import type { BudgetLevel } from '@shillex/shared';
import type { Db } from '../db/client.ts';
import { agentTurns, worldModelCalls } from '../db/schema.ts';

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/** Daily model spend (UTC day). Pace, not rules: 80% halves the heartbeat, 100% leaves only event wakes, 110% stops. */
export class Budget {
  private day: string;
  private spent = 0;
  constructor(private db: Db, private dailyUsd: number, private now: () => Date, private opts: { hardStop?: boolean } = {}) { this.day = utcDay(now()); }

  async load() {
    this.day = utcDay(this.now());
    const start = new Date(`${this.day}T00:00:00Z`);
    const [r] = await this.db.select({ s: sql<number>`coalesce(sum(${agentTurns.costUsd}), 0)::float8` }).from(agentTurns).where(gte(agentTurns.startedAt, start));
    // World calls (the X digest) belong to no agent but spend the same cap (x-feed §4).
    const [w] = await this.db.select({ s: sql<number>`coalesce(sum(${worldModelCalls.costUsd}), 0)::float8` }).from(worldModelCalls).where(gte(worldModelCalls.startedAt, start));
    this.spent = Number(r?.s ?? 0) + Number(w?.s ?? 0);
  }
  private roll() { const d = utcDay(this.now()); if (d !== this.day) { this.day = d; this.spent = 0; } }
  add(usd: number) { this.roll(); this.spent += usd; }
  spentToday() { this.roll(); return this.spent; }
  level(): BudgetLevel {
    const pct = this.spentToday() / this.dailyUsd;
    // Agents: model calls stop at 100% of the cap (the free engine keeps running).
    if (this.opts.hardStop) return pct >= 1 ? 'stopped' : pct >= 0.8 ? 'slow' : 'normal';
    return pct >= 1.1 ? 'stopped' : pct >= 1 ? 'events' : pct >= 0.8 ? 'slow' : 'normal';
  }
  /** True when spending `usd` more (a call's worst case) still keeps today's total within the cap. */
  canAfford(usd: number) { return this.spentToday() + usd <= this.dailyUsd; }
  canSpend() { return this.level() !== 'stopped'; }
}
