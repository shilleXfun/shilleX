import type { Db } from '../db/client.ts';
import { ClaudeBrain } from '../world/brain.ts';
import { Budget } from '../world/budget.ts';

export const HAIKU = 'claude-haiku-5-5';
export interface ModelBudget { canSpend(): boolean; add(usd: number): void; spentToday(): number }
export const haikuBrain = (apiKey: string) => new ClaudeBrain(apiKey, HAIKU);
export const modelBudget = (db: Db, dailyUsd: number, now: () => Date) => new Budget(db, dailyUsd, now, { hardStop: true });
