import type { Config } from '../config.ts';

export const SOL = 1_000_000_000;
const MIN = 60_000, HOUR = 60 * MIN;

/** Every money rule of the ledger (mainnet spec §2–3), in one place so tests can tighten any of them. */
export interface LedgerRules {
  /** The house's part of the 1% trade fee; the creator gets the rest. */
  houseFeeBps: number;
  launchFeeLamports: number;
  maxTradeLamports: number;
  maxSendLamports: number;
  maxSendDailyLamports: number;
  vestingMs: number;
  maxCreatorSaleShare: number;
  rugMinShare: number;
  breakerDrop: number;
  breakerWindowMs: number;
  breakerPauseMs: number;
}

export const DEFAULT_RULES: LedgerRules = {
  houseFeeBps: 50, launchFeeLamports: 10_000_000, maxTradeLamports: 50_000_000, maxSendLamports: 10_000_000, maxSendDailyLamports: 50_000_000,
  vestingMs: 24 * HOUR, maxCreatorSaleShare: 0.3, rugMinShare: 0.25, breakerDrop: 0.5, breakerWindowMs: 10 * MIN, breakerPauseMs: 10 * MIN,
};

export function rulesFromConfig(c: Config): LedgerRules {
  return { ...DEFAULT_RULES, houseFeeBps: c.mainnetLimits.houseFeeBps, maxTradeLamports: Math.round(c.mainnetLimits.maxTradeSol * SOL) };
}
