import { and, eq } from 'drizzle-orm';
import type { OwnerRules } from '@shillex/shared';
import type { Db } from '../../db/client.ts';
import { agentDayMarks, agentRules } from '../../db/schema.ts';
import type { Chain } from '../../world/chain.ts';
import { walletFacts } from '../../world/market.ts';
import type { SolanaNetwork } from '../../world/network.ts';

/**
 * Hard limits (2026-10-28 brief §2): what an owner sets that the server enforces on every act, whatever the agent wants.
 * Trading on/off (buys and sells), launching on/off, max SOL per trade (a buy, or a launch's first buy), and the daily loss
 * break: once the wallet (SOL and coins at their price) is down the owner's share from the UTC day's start, no buys or launches
 * until midnight UTC. Sells stay open in a break, so an agent can still get out. Outside agents start with launching off; on
 * mainnet every agent starts at 0.1 SOL a trade and a 20% daily break unless its owner says otherwise.
 */
export type LimitCode = 'TRADING_OFF' | 'LAUNCHING_OFF' | 'OVER_TRADE_LIMIT' | 'LOSS_BREAK';
export interface Refusal { code: LimitCode; message: string }
export const MAINNET_DEFAULT_RULES: OwnerRules = { maxSolPerTrade: 0.1, dailyLossBreakPct: 0.2 };

export const nextUtcMidnight = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
const utcDay = (now: Date) => now.toISOString().slice(0, 10);

/** The rules that apply: the defaults for this agent and network under whatever its owner saved. */
export function effectiveRules(saved: OwnerRules | null | undefined, o: { origin: string; network: SolanaNetwork }): OwnerRules {
  return { ...(o.origin === 'external' ? { launchingOn: false } : {}), ...(o.network === 'mainnet' ? MAINNET_DEFAULT_RULES : {}), ...(saved ?? {}) };
}

export function hardLimitRefusal(r: OwnerRules, act: { kind: string; sol?: number }, s: { pausedUntil: Date | null; pausedReason: string | null; now: Date }): Refusal | null {
  const paused = s.pausedUntil !== null && s.pausedUntil > s.now;
  const over = r.maxSolPerTrade !== undefined && (act.sol ?? 0) > r.maxSolPerTrade + 1e-12;
  const cap = () => ({ code: 'OVER_TRADE_LIMIT' as const, message: `Your owner caps you at ${r.maxSolPerTrade} SOL a trade` });
  const brk = () => ({ code: 'LOSS_BREAK' as const, message: `You are on a loss break until ${s.pausedUntil!.toISOString()}${s.pausedReason ? ` (${s.pausedReason})` : ''}: no buys or launches, sells are open` });
  switch (act.kind) {
    case 'buy':
      if (r.tradingOn === false) return { code: 'TRADING_OFF', message: 'Your owner has switched your trading off' };
      if (paused) return brk();
      return over ? cap() : null;
    case 'sell':
      return r.tradingOn === false ? { code: 'TRADING_OFF', message: 'Your owner has switched your trading off' } : null;
    case 'launch':
      if (r.launchingOn === false) return { code: 'LAUNCHING_OFF', message: 'Your owner has not switched launching on' };
      if (paused) return brk();
      return over ? cap() : null;
    default:
      return null;
  }
}

/** The wallet's worth now: SOL plus coins at their price, in lamports. */
async function worthLamports(db: Db, chain: Chain, agentId: string): Promise<number | null> {
  const w = await walletFacts(db, chain, agentId).catch(() => null);
  return w ? Math.round((w.sol + w.positions.reduce((n, p) => n + p.valueSol, 0)) * 1e9) : null;
}

/**
 * Takes today's starting mark when there is none yet, and starts the break when the wallet is down the owner's share from it.
 * Returns the break (set on agent_rules) or null.
 */
export async function lossBreakCheck(db: Db, chain: Chain, agentId: string, r: OwnerRules, now: Date): Promise<{ until: Date; reason: string } | null> {
  if (!r.dailyLossBreakPct) return null;
  const worth = await worthLamports(db, chain, agentId);
  if (worth === null) return null;
  const day = utcDay(now);
  const [mark] = await db.select({ start: agentDayMarks.startLamports }).from(agentDayMarks).where(and(eq(agentDayMarks.agentId, agentId), eq(agentDayMarks.day, day)));
  if (!mark) { await db.insert(agentDayMarks).values({ agentId, day, startLamports: worth }).onConflictDoNothing(); return null; }
  const start = Number(mark.start);
  if (!(start > 0)) return null;
  const down = (start - worth) / start;
  if (down + 1e-12 < r.dailyLossBreakPct) return null;
  const until = nextUtcMidnight(now);
  const reason = `down ${Math.round(down * 100)}% today, the owner's break is at ${Math.round(r.dailyLossBreakPct * 100)}%`;
  await db.insert(agentRules).values({ agentId, rules: {}, signedBy: 'system', updatedAt: now, pausedUntil: until, pausedReason: reason })
    .onConflictDoUpdate({ target: agentRules.agentId, set: { pausedUntil: until, pausedReason: reason } });
  return { until, reason };
}

/** The saved rules row's parts the checks need. */
export async function savedRules(db: Db, agentId: string): Promise<{ rules: OwnerRules | null; pausedUntil: Date | null; pausedReason: string | null }> {
  const [row] = await db.select({ rules: agentRules.rules, pausedUntil: agentRules.pausedUntil, pausedReason: agentRules.pausedReason }).from(agentRules).where(eq(agentRules.agentId, agentId));
  return { rules: row?.rules ?? null, pausedUntil: row?.pausedUntil ?? null, pausedReason: row?.pausedReason ?? null };
}

/** Every check for one act, in order: the rules that apply, a loss break due now, then the refusal (or null). */
export async function checkHardLimits(d: { db: Db; chain: Chain; now: Date; network: SolanaNetwork }, agent: { id: string; origin: string }, act: { kind: string; sol?: number }): Promise<Refusal | null> {
  if (act.kind !== 'buy' && act.kind !== 'sell' && act.kind !== 'launch') return null;
  const saved = await savedRules(d.db, agent.id);
  const rules = effectiveRules(saved.rules, { origin: agent.origin, network: d.network });
  let { pausedUntil, pausedReason } = saved;
  if (act.kind !== 'sell' && !(pausedUntil && pausedUntil > d.now)) {
    const b = await lossBreakCheck(d.db, d.chain, agent.id, rules, d.now);
    if (b) { pausedUntil = b.until; pausedReason = b.reason; }
  }
  return hardLimitRefusal(rules, act, { pausedUntil, pausedReason, now: d.now });
}
