import type { OwnerRules } from '@shillex/shared';
import { PUMP_DEXES } from './sol-net.ts';

/**
 * An owner's rules for its agent's SOL (2026-10-27, owner: "no platform trading rules"): only what the owner set limits a trade.
 * normalizeRules keeps what is sane and drops the rest; buyRefusal and exitFor are what runs before every trade and each minute.
 */
const num = (v: unknown, lo: number, hi: number): number | undefined => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi ? n : undefined;
};
const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined);

/** The rules as saved: unknown keys dropped, numbers in range, the ladder sorted. Throws on nothing; bad values are just unset. */
export function normalizeRules(raw: unknown): OwnerRules {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const ladder = Array.isArray(r.takeProfit)
    ? (r.takeProfit as unknown[]).flatMap((s) => {
      const o = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
      const x = num(o.x, 1.01, 1000), p = num(o.sellPct, 0.01, 1);
      return x !== undefined && p !== undefined ? [{ x, sellPct: p }] : [];
    }).sort((a, b) => a.x - b.x).slice(0, 5)
    : undefined;
  const blacklist = Array.isArray(r.blacklist) ? [...new Set((r.blacklist as unknown[]).filter((b): b is string => typeof b === 'string').map((b) => b.trim()).filter((b) => b && b.length <= 64))].slice(0, 100) : undefined;
  const out: OwnerRules = {
    tradingOn: bool(r.tradingOn), launchingOn: bool(r.launchingOn), dailyLossBreakPct: num(r.dailyLossBreakPct, 0.01, 0.99), maxSolPerTrade: num(r.maxSolPerTrade, 0.001, 1000), maxTradesPerDay: num(r.maxTradesPerDay, 0, 1000),
    stopLossPct: num(r.stopLossPct, 0.01, 0.99), takeProfit: ladder?.length ? ladder : undefined,
    maxLossPerDaySol: num(r.maxLossPerDaySol, 0.001, 1e6), maxLossTotalSol: num(r.maxLossTotalSol, 0.001, 1e6),
    pumpOnly: bool(r.pumpOnly), minMcapUsd: num(r.minMcapUsd, 0, 1e12), minHolders: num(r.minHolders, 0, 1e7), minLiquidityUsd: num(r.minLiquidityUsd, 0, 1e12),
    blacklist: blacklist?.length ? blacklist : undefined,
    canBuyServices: bool(r.canBuyServices), canSellServices: bool(r.canSellServices), maxServiceSpendPerDaySol: num(r.maxServiceSpendPerDaySol, 0, 1e6),
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as OwnerRules;
}

export interface CoinFacts { address: string; symbol: string; dexId: string; fdvUsd: number | null; liquidityUsd: number }

/** Why the owner's rules refuse this buy, or null. Holders are checked by the caller (they need the network). */
export function buyRefusal(r: OwnerRules, c: CoinFacts, o: { sol: number; buysToday: number; paused: string | null }): string | null {
  if (o.paused) return `trading is paused: ${o.paused}`;
  if (r.tradingOn === false) return 'my owner has switched my trading off';
  if (r.maxSolPerTrade !== undefined && o.sol > r.maxSolPerTrade + 1e-9) return `my owner caps me at ${r.maxSolPerTrade} SOL a trade`;
  if (r.maxTradesPerDay !== undefined && o.buysToday >= r.maxTradesPerDay) return `my owner allows ${r.maxTradesPerDay} trades a day and I have made them`;
  if (r.pumpOnly && !PUMP_DEXES.has(c.dexId)) return 'my owner lets me buy pump.fun coins only';
  if (r.minMcapUsd !== undefined && (c.fdvUsd ?? 0) < r.minMcapUsd) return `my owner wants a market cap of at least $${r.minMcapUsd}`;
  if (r.minLiquidityUsd !== undefined && c.liquidityUsd < r.minLiquidityUsd) return `my owner wants at least $${r.minLiquidityUsd} of liquidity`;
  const banned = new Set((r.blacklist ?? []).map((b) => b.replace(/^\$/, '').toUpperCase()));
  if (banned.has(c.address.toUpperCase()) || banned.has(c.symbol.toUpperCase())) return `my owner has blacklisted $${c.symbol}`;
  return null;
}

/**
 * What the owner's rules sell now: everything at the stop loss, or the next take-profit step not yet taken. `ladderDone`: the
 * steps (their x) already sold. pct is of what is still held.
 */
export function exitFor(r: OwnerRules, o: { entryPriceUsd: number; priceUsd: number; ladderDone: number[] }): { pct: number; by: 'stop_loss' | 'take_profit'; step?: number } | null {
  if (!(o.entryPriceUsd > 0) || !(o.priceUsd > 0)) return null;
  const x = o.priceUsd / o.entryPriceUsd;
  if (r.stopLossPct !== undefined && x <= 1 - r.stopLossPct) return { pct: 1, by: 'stop_loss' };
  const step = (r.takeProfit ?? []).find((s) => x >= s.x && !o.ladderDone.includes(s.x));
  return step ? { pct: step.sellPct, by: 'take_profit', step: step.x } : null;
}

/** The pause a loss limit calls for now, or null. dayLoss / totalLoss: realized losses as positive SOL. */
export function lossPause(r: OwnerRules, o: { dayLoss: number; totalLoss: number; now: Date }): { until: Date | null; reason: string } | null {
  if (r.maxLossTotalSol !== undefined && o.totalLoss >= r.maxLossTotalSol) return { until: null, reason: `lost ${o.totalLoss.toFixed(3)} SOL in total, my owner's limit is ${r.maxLossTotalSol}` };
  if (r.maxLossPerDaySol !== undefined && o.dayLoss >= r.maxLossPerDaySol) {
    const next = new Date(Date.UTC(o.now.getUTCFullYear(), o.now.getUTCMonth(), o.now.getUTCDate() + 1));
    return { until: next, reason: `lost ${o.dayLoss.toFixed(3)} SOL today, my owner's daily limit is ${r.maxLossPerDaySol}` };
  }
  return null;
}

/** The rules as the agent reads them about itself. */
export function rulesLine(r: OwnerRules | null): string {
  if (!r || !Object.keys(r).length) return 'YOUR OWNER SET NO RULES: you decide freely within your balance.';
  const p: string[] = [];
  if (r.tradingOn === false) p.push('trading switched OFF');
  if (r.launchingOn === false) p.push('launching coins switched OFF');
  if (r.launchingOn === true) p.push('launching coins allowed');
  if (r.dailyLossBreakPct !== undefined) p.push(`a break until midnight UTC once you are down ${Math.round(r.dailyLossBreakPct * 100)}% in a day`);
  if (r.maxSolPerTrade !== undefined) p.push(`at most ${r.maxSolPerTrade} SOL a trade`);
  if (r.maxTradesPerDay !== undefined) p.push(`at most ${r.maxTradesPerDay} trades a day`);
  if (r.stopLossPct !== undefined) p.push(`a stop loss at -${Math.round(r.stopLossPct * 100)}% (sold for you)`);
  if (r.takeProfit?.length) p.push(`take profit ${r.takeProfit.map((s) => `${Math.round(s.sellPct * 100)}% at ${s.x}x`).join(', ')} (sold for you)`);
  if (r.maxLossPerDaySol !== undefined) p.push(`pause after losing ${r.maxLossPerDaySol} SOL in a day`);
  if (r.maxLossTotalSol !== undefined) p.push(`pause after losing ${r.maxLossTotalSol} SOL in total`);
  if (r.pumpOnly) p.push('pump.fun coins only');
  if (r.minMcapUsd !== undefined) p.push(`market cap at least $${r.minMcapUsd}`);
  if (r.minHolders !== undefined) p.push(`at least ${r.minHolders} holders`);
  if (r.minLiquidityUsd !== undefined) p.push(`liquidity at least $${r.minLiquidityUsd}`);
  if (r.blacklist?.length) p.push(`never ${r.blacklist.slice(0, 5).join(', ')}`);
  if (r.canBuyServices === false) p.push('may not buy services');
  if (r.canSellServices === false) p.push('may not sell services');
  if (r.maxServiceSpendPerDaySol !== undefined) p.push(`at most ${r.maxServiceSpendPerDaySol} SOL a day on services`);
  return `YOUR OWNER'S RULES (enforced; you may talk about them): ${p.join('; ')}.`;
}
