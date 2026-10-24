import Anthropic from '@anthropic-ai/sdk';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { agentTurns, worldModelCalls } from '../db/schema.ts';
import { ClaudeBrain, priceOf, type BrainResponse } from '../world/brain.ts';
import { Budget, type BudgetWindow } from '../world/budget.ts';
import { anthropicClient } from '../lib/anthropic.ts';

export const HAIKU = 'claude-haiku-5-5';
export interface ModelBudget { canSpend(): boolean; add(usd: number): void; spentToday(): number; canAfford(usd: number): boolean; /** The current period's cap (the day, or the launch window). */ capUsd?(): number }
/** No retries inside the client: a retried attempt may have been billed without billedCall seeing it. A failed call is one call, booked at its worst case. */
export const haikuBrain = (apiKey: string) => new ClaudeBrain(apiKey, HAIKU, anthropicClient(apiKey, 0));
export const modelBudget = (db: Db, dailyUsd: number, now: () => Date, window: BudgetWindow | null = null) => new Budget(db, dailyUsd, now, { hardStop: true, window });

/** Where a call's cost is written: an agent's turn, or a world call that belongs to no agent (the X digest, x-feed §4). */
export type CostTarget = { turnId: string } | { worldCallId: string };

/** Adds `usd` to the target's stored cost right away, sealed or not: Budget.load() sums every turn and world call of the day, and boot's abort keeps the figure. */
async function addCost(db: Db, t: CostTarget, usd: number): Promise<void> {
  if ('worldCallId' in t) await db.update(worldModelCalls).set({ costUsd: sql`${worldModelCalls.costUsd} + ${usd}` }).where(eq(worldModelCalls.id, t.worldCallId));
  else await db.update(agentTurns).set({ costUsd: sql`${agentTurns.costUsd} + ${usd}` }).where(eq(agentTurns.id, t.turnId));
}

/** The API answered with an error status (400, 401, 403, 404, 413, 429, 5xx, 529): such a request is not billed. */
const answeredWithError = (e: unknown) => e instanceof Anthropic.APIError && typeof e.status === 'number';

/**
 * One model call that the daily cap survives (engine M1, server-rest M5). Its worst case is written to the turn's stored cost
 * before the call, so a crash mid-call still counts it after a restart; a call that answers is settled to what it cost before
 * the caller runs any tool. A call that throws costs nothing when the API answered with an error status, and keeps its worst
 * case otherwise (a network error, a timeout, an abort or a dropped response may have been billed). The budget in memory and
 * `spent` (the turn's total, for its receipt) get the same figure.
 */
export async function billedCall(x: { db: Db; budget: ModelBudget; worstUsd: number; spent: { usd: number }; /** Priced as this model (default Haiku). */ model?: string } & CostTarget, call: () => Promise<BrainResponse>): Promise<BrainResponse> {
  await addCost(x.db, x, x.worstUsd);
  let res: BrainResponse;
  try { res = await call(); }
  catch (e) {
    if (!answeredWithError(e)) { x.budget.add(x.worstUsd); x.spent.usd += x.worstUsd; }
    // If the reservation cannot be taken back, it stays: the cap errs safe.
    else await addCost(x.db, x, -x.worstUsd).catch((err) => console.error('[agents] could not release a model call reservation', 'worldCallId' in x ? x.worldCallId : x.turnId, err));
    throw e;
  }
  const cost = priceOf(x.model ?? HAIKU, res.usage);
  x.budget.add(cost);
  x.spent.usd += cost;
  await addCost(x.db, x, cost - x.worstUsd);
  return res;
}
