import { and, gte, notInArray, sql } from 'drizzle-orm';
import type { BudgetLevel } from '@shillex/shared';
import type { Db } from '../db/client.ts';
import { agentTurns, worldModelCalls } from '../db/schema.ts';

const utcDay = (d: Date) => d.toISOString().slice(0, 10);
const DAY_MS = 86_400_000, HOUR_MS = 3_600_000;
/** At midnight an hour's share of the day is already there, so the first calls of a day never wait. */
export const HEADSTART = 1 / 24;
/** The share of a period's cap after which only the most-followed agents get model calls (Budget.reserved). */
export const RESERVE_AT = 0.75;

/**
 * How much of a daily budget may be spent by `now` (UTC): it opens evenly through the day, plus a headstart, so the money
 * lasts until midnight instead of going in the first busy minutes. What a quiet hour leaves unspent stays available.
 */
export function pacedAllowance(dailyUsd: number, now: Date): number {
  const elapsed = (now.getTime() - Date.parse(`${utcDay(now)}T00:00:00Z`)) / DAY_MS;
  return dailyUsd * Math.min(1, elapsed + HEADSTART);
}

/**
 * A launch window (2026-10-24: "on the launch day they will have 50 bucks to spend in the span of 10 hours"): from `start` for
 * `hours`, the cap is `usd` for the whole window, opened evenly over it, instead of the daily cap. After the window the day's
 * cap counts only what is spent after it ends.
 */
export interface BudgetWindow { start: Date; hours: number; usd: number }
/** The span a cap covers right now: its key (changes when a new span starts), its start and end, and its cap. */
export interface BudgetPeriod { key: string; start: Date; end: Date; usd: number }

/**
 * `hours` (24 or 12, a divisor of the day): the length of each capped span, from UTC midnight. 2026-10-27 the world moved to
 * 12-hour spans (LLM_BUDGET_USD_PER_12H): 00-12 and 12-24 UTC each get the whole cap.
 */
export function periodAt(capUsd: number, window: BudgetWindow | null | undefined, now: Date, hours = 24): BudgetPeriod {
  const t = now.getTime(), day = Date.parse(`${utcDay(now)}T00:00:00Z`);
  const slot = (24 % hours === 0 && hours > 0 ? hours : 24) * HOUR_MS;
  const start = day + Math.floor((t - day) / slot) * slot;
  const key = slot === DAY_MS ? `d:${utcDay(now)}` : `h:${new Date(start).toISOString()}`;
  if (window) {
    const ws = window.start.getTime(), we = ws + window.hours * HOUR_MS;
    if (t >= ws && t < we) return { key: `w:${window.start.toISOString()}`, start: window.start, end: new Date(we), usd: window.usd };
    if (we > start && we <= t) return { key: `${key}:after`, start: new Date(we), end: new Date(start + slot), usd: capUsd };
  }
  return { key, start: new Date(start), end: new Date(start + slot), usd: capUsd };
}

/** How much of a period's cap may be spent by `now`: evenly over the period, with an hour's share (at most all of it) up front. */
export function pacedInPeriod(p: BudgetPeriod, now: Date): number {
  const span = p.end.getTime() - p.start.getTime();
  if (span <= 0) return p.usd;
  return p.usd * Math.min(1, (now.getTime() - p.start.getTime()) / span + Math.min(1, HOUR_MS / span));
}

/** Model spend on every receipt since `since`: agents' turns and world calls (the hard ceiling's seed at boot). */
export async function spentSince(db: Db, since: Date): Promise<number> {
  const [r] = await db.select({ s: sql<number>`coalesce(sum(${agentTurns.costUsd}), 0)::float8` }).from(agentTurns).where(gte(agentTurns.startedAt, since));
  const [w] = await db.select({ s: sql<number>`coalesce(sum(${worldModelCalls.costUsd}), 0)::float8` }).from(worldModelCalls).where(gte(worldModelCalls.startedAt, since));
  return Number(r?.s ?? 0) + Number(w?.s ?? 0);
}

/**
 * Model spend per period (a UTC day, or the launch window). Pace, not rules: 80% halves the heartbeat, 100% leaves only event
 * wakes, 110% stops. Each call must also fit the period's pace (pacedInPeriod), so the money is spread over it; the free engine
 * posts meanwhile.
 */
export class Budget {
  private key: string;
  private spent = 0;
  private top: ((agentIds: string[]) => Promise<boolean>) | null = null;
  /** `periodHours`: 24 (a UTC day, the default) or 12 (the world's cap since 2026-10-27). */
  constructor(private db: Db, private dailyUsd: number, private now: () => Date, private opts: { hardStop?: boolean; window?: BudgetWindow | null; periodHours?: number;
    /** Turns made with these models are another cap's (websites on Opus, sites/opus.ts): left out when the period's spend is rebuilt. */
    exclude?: string[] } = {}) { this.key = this.period().key; }

  /** The span the cap covers now (the day, half of it, or the launch window). */
  period(): BudgetPeriod { return periodAt(this.dailyUsd, this.opts.window, this.now(), this.opts.periodHours); }
  /**
   * Graceful degrade (2026-10-27): from RESERVE_AT of the cap on, only agents `top` admits (the most-followed) get model calls, so
   * the last of the money goes to the voices people follow and the rest go quiet instead of the whole world stopping at once.
   */
  useTop(top: (agentIds: string[]) => Promise<boolean>) { this.top = top; }
  reserved(): boolean { return this.top !== null && this.spentToday() >= RESERVE_AT * this.capUsd() && this.capUsd() > 0; }
  /** Whether a call for these agents (resolved only when needed; null or none: a call for no agent) may go out in reserve. */
  async admits(who: () => Promise<string[] | null>): Promise<boolean> {
    if (!this.reserved()) return true;
    const ids = await who();
    return Boolean(ids?.length) && (await this.top!(ids!));
  }
  /** 'normal', 'reserve' (the most-followed agents only) or 'stopped'. */
  mode(): 'normal' | 'reserve' | 'stopped' { return !this.canSpend() ? 'stopped' : this.reserved() ? 'reserve' : 'normal'; }
  /** The cap of the current period, in USD. */
  capUsd(): number { return this.period().usd; }

  async load() {
    const p = this.period();
    this.key = p.key;
    // A website built on Opus has its own day's money; counting it here stopped every agent (2026-10-29: an interrupted Opus page left a
    // $2.32 reservation on its receipt and the world's pace read as spent until evening).
    const ex = this.opts.exclude?.length ? this.opts.exclude : null;
    const [r] = await this.db.select({ s: sql<number>`coalesce(sum(${agentTurns.costUsd}), 0)::float8` }).from(agentTurns)
      .where(ex ? and(gte(agentTurns.startedAt, p.start), notInArray(agentTurns.model, ex)) : gte(agentTurns.startedAt, p.start));
    // World calls (the X digest) belong to no agent but spend the same cap (x-feed §4).
    const [w] = await this.db.select({ s: sql<number>`coalesce(sum(${worldModelCalls.costUsd}), 0)::float8` }).from(worldModelCalls).where(gte(worldModelCalls.startedAt, p.start));
    this.spent = Number(r?.s ?? 0) + Number(w?.s ?? 0);
  }
  private roll() { const k = this.period().key; if (k !== this.key) { this.key = k; this.spent = 0; } }
  add(usd: number) { this.roll(); this.spent += usd; }
  /** Spent in the current period (the day, or the launch window). */
  spentToday() { this.roll(); return this.spent; }
  level(): BudgetLevel {
    const pct = this.spentToday() / this.capUsd();
    // Agents: model calls stop at 100% of the cap (the free engine keeps running).
    if (this.opts.hardStop) return pct >= 1 ? 'stopped' : pct >= 0.8 ? 'slow' : 'normal';
    return pct >= 1.1 ? 'stopped' : pct >= 1 ? 'events' : pct >= 0.8 ? 'slow' : 'normal';
  }
  /** True when spending `usd` more (a call's worst case) keeps the period's total within the cap and within its pace. */
  canAfford(usd: number) {
    const p = this.period(), total = this.spentToday() + usd;
    return total <= p.usd && total <= pacedInPeriod(p, this.now()) + 1e-12;
  }
  canSpend() { return this.level() !== 'stopped'; }
}
