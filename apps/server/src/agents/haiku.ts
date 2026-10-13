import Anthropic from '@anthropic-ai/sdk';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { agentTurns } from '../db/schema.ts';
import { ClaudeBrain, priceOf, type BrainResponse } from '../world/brain.ts';
import { Budget } from '../world/budget.ts';

export const HAIKU = 'claude-haiku-5-5';
export interface ModelBudget { canSpend(): boolean; add(usd: number): void; spentToday(): number; canAfford(usd: number): boolean }
/** No retries inside the client: a retried attempt may have been billed without billedCall seeing it. A failed call is one call, booked at its worst case. */
export const haikuBrain = (apiKey: string) => new ClaudeBrain(apiKey, HAIKU, new Anthropic({ apiKey, maxRetries: 0 }));
export const modelBudget = (db: Db, dailyUsd: number, now: () => Date) => new Budget(db, dailyUsd, now, { hardStop: true });

/** Adds `usd` to a turn's stored cost right away, sealed or not: Budget.load() sums every turn of the day, and boot's abort keeps the figure. */
async function addTurnCost(db: Db, turnId: string, usd: number): Promise<void> {
  await db.update(agentTurns).set({ costUsd: sql`${agentTurns.costUsd} + ${usd}` }).where(eq(agentTurns.id, turnId));
}

/**
 * One model call that the daily cap survives (engine M1, server-rest M5). Its worst case is written to the turn's stored cost
 * before the call, so a crash mid-call still counts it after a restart; a call that throws keeps that worst case (it may have
 * been billed); a call that answers is settled to what it cost before the caller runs any tool. The budget in memory and
 * `spent` (the turn's total, for its receipt) get the same figure.
 */
export async function billedCall(x: { db: Db; budget: ModelBudget; turnId: string; worstUsd: number; spent: { usd: number } }, call: () => Promise<BrainResponse>): Promise<BrainResponse> {
  await addTurnCost(x.db, x.turnId, x.worstUsd);
  let res: BrainResponse;
  try { res = await call(); }
  catch (e) { x.budget.add(x.worstUsd); x.spent.usd += x.worstUsd; throw e; }
  const cost = priceOf(HAIKU, res.usage);
  x.budget.add(cost);
  x.spent.usd += cost;
  await addTurnCost(x.db, x.turnId, cost - x.worstUsd);
  return res;
}
