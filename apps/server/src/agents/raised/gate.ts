import { and, eq, gte, inArray, like, or, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { agentSeeds, agentTurns, agents } from '../../db/schema.ts';
import { priceOf } from '../../world/brain.ts';
import { HAIKU, type ModelBudget } from '../haiku.ts';
import { HUMAN_TRIPS, MOMENT_WORST } from '../moments.ts';
import { PHRASEBOOK_MAX_TOKENS } from '../phrasebook-writer.ts';
import { HUMAN_PURPOSE, type Moment } from '../types.ts';

export const HATCH_PROMPT_VERSION = 'hatch-v1';
/** A hatch call's worst case: every max token of a phrasebook billed as Haiku output. */
export const HATCH_WORST = priceOf(HAIKU, { input: 0, output: PHRASEBOOK_MAX_TOKENS, cacheRead: 0, cacheWrite: 0 });
/** An owner chat reply's worst case: every trip a human reply may use. */
export const OWNER_REPLY_WORST = HUMAN_TRIPS * MOMENT_WORST;
const dayOf = (d: Date) => d.toISOString().slice(0, 10);

export interface RaisedGateOptions { db: Db; now: () => Date; dailyUsd: number; share: number; ownerRepliesPerDay: number }

/**
 * Raised agents' slice of the owner's $1/day (spec §7). Hatches, owner chat replies and raised agents' phrasebook refreshes
 * book against `share` of the daily cap as well as the Budget, whose hard stop at 100% still covers everything. The share
 * keeps raised agents from crowding out the wild 50. Held in memory and seeded from today's receipts by load(); counting a
 * raised agent's reply to someone other than its owner as an owner reply errs safe.
 */
export class RaisedGate {
  private day: string;
  private spent = 0;
  private raised = new Set<string>();
  private owners = new Map<string, string>();
  private replies = new Map<string, number>();
  constructor(private o: RaisedGateOptions) { this.day = dayOf(o.now()); }

  private roll() { const d = dayOf(this.o.now()); if (d !== this.day) { this.day = d; this.spent = 0; this.replies.clear(); } }
  cap() { return this.o.share * this.o.dailyUsd; }
  spentToday() { this.roll(); return this.spent; }
  canAfford(usd: number) { return this.spentToday() + usd <= this.cap() + 1e-12; }
  add(usd: number) { this.roll(); this.spent += usd; }
  isRaised(agentId: string) { return this.raised.has(agentId); }
  ownerOf(agentId: string) { return this.owners.get(agentId) ?? null; }
  /** Hatch, release and retire keep the roster current. */
  setOwner(agentId: string, ownerId: string | null) {
    this.raised.add(agentId);
    if (ownerId) this.owners.set(agentId, ownerId); else this.owners.delete(agentId);
  }
  repliesLeft(ownerId: string) { this.roll(); return Math.max(0, this.o.ownerRepliesPerDay - (this.replies.get(ownerId) ?? 0)); }

  async load(): Promise<void> {
    const { db } = this.o;
    const rows = await db.select({ id: agents.userId, ownerId: agents.ownerId }).from(agents).where(eq(agents.origin, 'raised'));
    this.raised = new Set(rows.map((r) => r.id));
    this.owners = new Map(rows.filter((r) => r.ownerId).map((r) => [r.id, r.ownerId!]));
    this.day = dayOf(this.o.now());
    this.replies.clear();
    const start = new Date(`${this.day}T00:00:00Z`);
    const sum = sql<number>`coalesce(sum(${agentTurns.costUsd}), 0)::float8`;
    const humanNote = sql`${agentTurns.triggers} @> ${JSON.stringify([{ note: HUMAN_PURPOSE }])}::jsonb`;
    const [h] = await db.select({ s: sum }).from(agentTurns).where(and(gte(agentTurns.startedAt, start), eq(agentTurns.promptVersion, HATCH_PROMPT_VERSION)));
    const ids = [...this.raised];
    const [r] = ids.length
      ? await db.select({ s: sum }).from(agentTurns).where(and(gte(agentTurns.startedAt, start), inArray(agentTurns.agentId, ids), or(humanNote, like(agentTurns.promptVersion, 'phrasebook-%'))))
      : [{ s: 0 }];
    this.spent = Number(h?.s ?? 0) + Number(r?.s ?? 0);
    const owned = [...this.owners.keys()];
    if (owned.length) {
      const counts = await db.select({ a: agentTurns.agentId, n: sql<number>`count(*)::int` }).from(agentTurns)
        .where(and(gte(agentTurns.startedAt, start), inArray(agentTurns.agentId, owned), humanNote, sql`${agentTurns.context} @> ${JSON.stringify([{ kind: 'private' }])}::jsonb`))
        .groupBy(agentTurns.agentId);
      for (const c of counts) { const owner = this.owners.get(c.a); if (owner) this.replies.set(owner, (this.replies.get(owner) ?? 0) + c.n); }
    }
  }

  /**
   * The moment queue asks this last, right before it queues a moment. False sends a human's message back to the
   * phrasebook, leaves a hatch request queued, or skips a raised agent's refresh. An admitted owner reply is counted here.
   */
  admits(m: Moment): boolean {
    if (m.kind === 'hatch') return this.canAfford(HATCH_WORST);
    if (m.kind === 'phrasebook') return !this.isRaised(m.agentId) || this.canAfford(HATCH_WORST);
    if (m.kind === 'human_reply') {
      const owner = this.ownerOf(m.agentId);
      if (!owner || owner !== String(m.data.humanId)) return true;
      if (this.repliesLeft(owner) <= 0 || !this.canAfford(OWNER_REPLY_WORST)) return false;
      this.replies.set(owner, (this.replies.get(owner) ?? 0) + 1);
      return true;
    }
    return true;
  }

  /**
   * The budget a model call books against: the Budget alone, or the Budget plus this share for a hatch, a raised agent's
   * refresh and its reply to its own owner (`humanId`). Its replies to anyone else are ordinary human replies (spec §7).
   */
  budgetFor(agentId: string, purpose: string, budget: ModelBudget, humanId?: string): ModelBudget {
    const ownerReply = purpose === HUMAN_PURPOSE && humanId !== undefined && this.ownerOf(agentId) === humanId;
    const counts = purpose === 'hatch' || (this.isRaised(agentId) && (ownerReply || purpose === 'phrasebook'));
    if (!counts) return budget;
    return {
      canSpend: () => budget.canSpend(),
      canAfford: (usd) => budget.canAfford(usd) && this.canAfford(usd),
      add: (usd) => { budget.add(usd); this.add(usd); },
      spentToday: () => budget.spentToday(),
      ...(budget.admits ? { admits: (who: () => Promise<string[] | null>) => budget.admits!(who) } : {}),
    };
  }

  /** A raised agent's private description, for its phrasebook refreshes; null for every other agent. */
  async wishOf(agentId: string): Promise<string | null> {
    if (!this.isRaised(agentId)) return null;
    const [s] = await this.o.db.select({ d: agentSeeds.description }).from(agentSeeds).where(eq(agentSeeds.agentId, agentId));
    return s?.d ?? null;
  }
}
