import Anthropic from '@anthropic-ai/sdk';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { agentTurns, worldModelCalls } from '../db/schema.ts';
import { ClaudeBrain, PRICE_OF_HAIKU, isProviderModel, knownPrice, priceOf, registerPrice, type AgentBrain, type BrainResponse } from '../world/brain.ts';
import { RoutedBrain } from '../world/brain-openai.ts';
import type { Config } from '../config.ts';
import { Budget } from '../world/budget.ts';
import { anthropicClient } from '../lib/anthropic.ts';

export const HAIKU = 'claude-haiku-5-5';
export interface ModelBudget { canSpend(): boolean; add(usd: number): void; spentToday(): number; canAfford(usd: number): boolean; /** The current period's cap (the day, or the launch window). */ capUsd?(): number;
  /** Reserve (Budget.admits): whether a call for these agents may go out; absent, every call may. */ admits?(who: () => Promise<string[] | null>): Promise<boolean> }
/** No retries inside the client: a retried attempt may have been billed without billedCall seeing it. A failed call is one call, booked at its worst case. */
export const haikuBrain = (apiKey: string, strong?: string) => new ClaudeBrain(apiKey, HAIKU, anthropicClient(apiKey, 0), strong);
/**
 * The model every receipt names and the factor worst cases are scaled by (2026-10-25, Phase B). Worst cases are written in Haiku
 * prices across the code; a provider dearer than Haiku scales them up, a cheaper or free one leaves them (the reservation is then
 * generous and is settled to the real cost after the call).
 */
let modelLabel = HAIKU, worstScale = 1;
export const modelName = () => modelLabel;

/** The brain the configuration asks for (config.llm): the routed providers, Claude Haiku, or none (the free engine only; always with BRAIN_KILL_SWITCH). */
export function brainFromConfig(config: Pick<Config, 'llm' | 'anthropicApiKey'> & Partial<Pick<Config, 'anthropicModelStrong' | 'brainKillSwitch'>>, now: () => Date): AgentBrain | null {
  let brain: AgentBrain | null = null;
  if (config.brainKillSwitch) { modelLabel = HAIKU; return null; }
  if (config.llm.mode === 'openai' && config.llm.providers.length) {
    const haiku = PRICE_OF_HAIKU();
    for (const p of config.llm.providers) {
      if (p.priceInPerM === null || p.priceOutPerM === null) continue;
      for (const m of new Set([p.model, p.modelStrong])) if (m) registerPrice(m, p.priceInPerM, p.priceOutPerM);
      worstScale = Math.max(worstScale, p.priceOutPerM / haiku.output, p.priceInPerM / haiku.input);
    }
    brain = new RoutedBrain(config.llm.providers, now);
  } else if (config.llm.mode === 'anthropic' && config.anthropicApiKey) {
    const strong = config.anthropicModelStrong;
    // Worst cases are written in Haiku prices: a dearer strong model scales every reservation up (settled to the real cost after).
    const p = strong ? knownPrice(strong) : null;
    if (p) { const haiku = PRICE_OF_HAIKU(); worstScale = Math.max(1, p.output / haiku.output, p.input / haiku.input); }
    brain = haikuBrain(config.anthropicApiKey, p ? strong : undefined);
  }
  modelLabel = brain?.name ?? HAIKU;
  return brain;
}

export const modelBudget = (db: Db, capUsd: number, now: () => Date, periodHours = 24) => new Budget(db, capUsd, now, { hardStop: true, periodHours });

/** Where a call's cost is written: an agent's turn, or a world call that belongs to no agent (the X digest, x-feed §4). */
export type CostTarget = { turnId: string } | { worldCallId: string };

/** Adds `usd` to the target's stored cost right away, sealed or not: Budget.load() sums every turn and world call of the day, and boot's abort keeps the figure. */
async function addCost(db: Db, t: CostTarget, usd: number): Promise<void> {
  if ('worldCallId' in t) await db.update(worldModelCalls).set({ costUsd: sql`${worldModelCalls.costUsd} + ${usd}` }).where(eq(worldModelCalls.id, t.worldCallId));
  else await db.update(agentTurns).set({ costUsd: sql`${agentTurns.costUsd} + ${usd}` }).where(eq(agentTurns.id, t.turnId));
}

/** The provider answered with an error status (400, 401, 403, 404, 413, 429, 5xx, 529): such a request is not billed. */
const answeredWithError = (e: unknown) => e instanceof Anthropic.APIError ? typeof e.status === 'number' : typeof (e as { status?: unknown })?.status === 'number';

/** The cap (or this caller's share of it) has no room for this call's worst case right now. Nothing was sent. */
export class BudgetClosed extends Error { readonly category = 'budget' }

/**
 * One model call that the daily cap survives (engine M1, server-rest M5). The call's worst case is reserved in the budget in
 * memory before the first await, so callers running at once (moments, scenes, stories) each see the others' reservations and
 * together never pass the cap (2026-10-25); a call with no room throws BudgetClosed and sends nothing. The worst case is also
 * written to the receipt before the call, so a crash mid-call still counts it after a restart; a call that answers is settled
 * to what it cost before the caller runs any tool. A call that throws costs nothing when the provider answered with an error
 * status, and keeps its worst case otherwise (a network error, a timeout, an abort or a dropped response may have been billed).
 * The budget in memory and `spent` (the turn's total, for its receipt) get the same figure.
 */
export async function billedCall(x: { db: Db; budget: ModelBudget; worstUsd: number; spent: { usd: number }; /** Priced as this model (default Haiku). */ model?: string;
  /** The agents a world call speaks for (a scene's cast, a thread's author): in reserve it goes out only for the most-followed. */ agentIds?: string[] } & CostTarget, call: () => Promise<BrainResponse>): Promise<BrainResponse> {
  const worst = x.worstUsd * worstScale;
  // Reserve first (it may read the database), so the cap check and the booking below stay together with no await between them.
  if (x.budget.admits && !(await x.budget.admits(async () => x.agentIds ?? ('turnId' in x ? (await x.db.select({ a: agentTurns.agentId }).from(agentTurns).where(eq(agentTurns.id, x.turnId))).map((r) => r.a) : null))))
    throw new BudgetClosed('the budget is in reserve: only the most-followed agents get model calls now');
  if (!(x.budget.canSpend() && x.budget.canAfford(worst))) throw new BudgetClosed(`no room under the model cap for a call of up to $${worst.toFixed(4)}`);
  const book = (usd: number) => { x.budget.add(usd); x.spent.usd += usd; };
  book(worst);
  try { await addCost(x.db, x, worst); }
  catch (e) { book(-worst); throw e; }
  let res: BrainResponse;
  try { res = await call(); }
  catch (e) {
    if (answeredWithError(e)) {
      book(-worst);
      // If the reservation cannot be taken back from the receipt, it stays there: the cap errs safe.
      await addCost(x.db, x, -worst).catch((err) => console.error('[agents] could not release a model call reservation', 'worldCallId' in x ? x.worldCallId : x.turnId, err));
    }
    throw e;
  }
  // A configured provider's model (registered at boot) is priced as itself; anything else as the caller says, Haiku by default.
  const cost = priceOf(isProviderModel(res.model) ? res.model : x.model ?? HAIKU, res.usage);
  book(cost - worst);
  await addCost(x.db, x, cost - worst);
  return res;
}
