import { desc, eq } from 'drizzle-orm';
import type { Config } from '../../config.ts';
import type { Db } from '../../db/client.ts';
import { agents, realMarket } from '../../db/schema.ts';
import { AppError, errors } from '../../lib/errors.ts';
import type { SolBank } from '../../world/sol-trade.ts';
import type { SolHandles } from '../../world/sol-world.ts';
import { TRADABLE_DEXES } from '../../world/sol-net.ts';
import { effectiveRules, hardLimitRefusal, savedRules } from './limits-hard.ts';

/**
 * An outside agent's trades on mainnet (2026-10-28): buy and sell are real trades from its own vault wallet through the real-SOL
 * bank (PumpPortal), on the real coins Shillex follows (real_market), inside its owner's limits (the mainnet defaults until the
 * owner sets their own). A launch (2026-10-29) is a real pump.fun coin from its own wallet, when MAINNET_LAUNCH is on and its owner
 * switched launching on (world/sol-launch.ts). Devnet coins are never touched.
 */
export interface RealActDeps { db: Db; config: Config; now: () => Date; bank: Pick<SolBank, 'buy' | 'sell'>; launch?: SolHandles['launch'] }
export const MIN_REAL_TRADE_SOL = 0.002;

const refuse = (status: number, code: string, message: string) => new AppError(status, code, message);

/** The real coins an agent may buy, busiest first: what GET /agent/coins answers on mainnet. */
export async function realCoins(db: Db, limit = 40) {
  const rows = await db.select().from(realMarket).orderBy(desc(realMarket.volumeH1)).limit(limit * 2);
  return rows.filter((c) => TRADABLE_DEXES.has(c.dexId)).slice(0, limit).map((c) => ({
    mint: c.address, symbol: c.symbol, name: c.name, dex: c.dexId, price_usd: c.priceUsd, mcap_usd: c.fdvUsd ?? null, liquidity_usd: c.liquidityUsd,
    change_h1_pct: c.changeH1, change_h24_pct: c.changeH24, volume_h1_usd: c.volumeH1, buys_h1: c.buysH1, sells_h1: c.sellsH1,
  }));
}

/**
 * A buy's thesis (owner, 2026-10-29: agents trade on their own and come up with a thesis): its reason, and the target, stop and
 * hours it gives the trade, kept with the position as "<why> [plan target=+50 stop=-20 until=<ISO>]" so /agent/me can say when
 * the plan is due. The owner's hard limits and stop loss still win.
 */
export function thesisText(i: Record<string, unknown>, now: Date): string {
  const why = typeof i.why === 'string' && i.why.trim() ? i.why.trim().replace(/\s+/g, ' ').slice(0, 180) : 'no reason given';
  const num = (x: unknown, lo: number, hi: number) => { const v = Number(x); return Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v) : null; };
  const target = num(i.target_pct, 1, 10_000), stop = num(i.stop_pct, 1, 99), hours = num(i.hours, 1, 24 * 30);
  if (target === null && stop === null && hours === null) return why;
  const until = hours === null ? '' : ` until=${new Date(now.getTime() + hours * 3_600_000).toISOString()}`;
  return `${why} [plan${target === null ? '' : ` target=+${target}`}${stop === null ? '' : ` stop=-${stop}`}${until}]`;
}

/** A position's thesis read back: the reason, the plan, and what of it is due now given its P&L. */
export function thesisOf(why: string | null, pnlPct: number | null, now: Date) {
  const m = /^(.*?)\s*\[plan((?: target=\+\d+)?)((?: stop=-\d+)?)((?: until=\S+)?)\]$/.exec(why ?? '');
  const reason = (m ? m[1] : why) ?? null;
  const target = m?.[2] ? Number(m[2].split('+')[1]) : null, stop = m?.[3] ? Number(m[3].split('-')[1]) : null, until = m?.[4] ? m[4].split('=')[1]! : null;
  const pct = pnlPct === null ? null : pnlPct * 100;
  const due = pct !== null && target !== null && pct >= target ? 'target' : pct !== null && stop !== null && pct <= -stop ? 'stop' : until && Date.parse(until) <= now.getTime() ? 'time' : null;
  return { thesis: reason, plan: target === null && stop === null && until === null ? null : { target_pct: target, stop_pct: stop, until }, due };
}

export async function realAct(d: RealActDeps, agentId: string, kind: 'buy' | 'sell' | 'launch', i: Record<string, unknown>): Promise<{ ok: boolean; result: { outcome: string; mint?: string; signature?: string } }> {
  if (kind === 'launch' && (!d.config.mainnetLaunch || !d.launch)) throw refuse(403, 'LAUNCH_UNAVAILABLE', 'Launching coins is not open on mainnet yet');
  const [a] = await d.db.select({ origin: agents.origin }).from(agents).where(eq(agents.userId, agentId));
  const saved = await savedRules(d.db, agentId);
  const rules = effectiveRules(saved.rules, { origin: a?.origin ?? 'external', network: 'mainnet' });
  if (kind === 'launch') {
    const no = hardLimitRefusal(rules, { kind: 'launch' }, { pausedUntil: saved.pausedUntil, pausedReason: saved.pausedReason, now: d.now() });
    if (no) throw refuse(403, no.code, no.message);
    const text = (x: unknown, max: number) => (typeof x === 'string' ? x.trim().slice(0, max) : '');
    const r = await d.launch!(agentId, { name: text(i.name, 32), symbol: text(i.symbol, 12).replace(/^\$/, '').toUpperCase(), description: text(i.description, 240) || text(i.name, 32) });
    return { ok: r.ok, result: { outcome: r.outcome, ...(r.mint ? { mint: r.mint, signature: r.sig } : {}) } };
  }
  const mint = typeof i.mint === 'string' ? i.mint.trim() : '';
  if (!mint) throw errors.badRequest('VALIDATION', 'mint is required');
  if (kind === 'sell') {
    const pct = Number(i.pct ?? 100);
    if (!(pct > 0 && pct <= 100)) throw errors.badRequest('BAD_AMOUNT', 'pct is more than 0 and at most 100');
    const no = hardLimitRefusal(rules, { kind: 'sell' }, { pausedUntil: saved.pausedUntil, pausedReason: saved.pausedReason, now: d.now() });
    if (no) throw refuse(403, no.code, no.message);
    const r = await d.bank.sell(agentId, mint, pct / 100, 'agent');
    return { ok: r.ok, result: { outcome: r.outcome } };
  }
  const sol = Number(i.sol);
  if (!Number.isFinite(sol) || sol <= 0) throw errors.badRequest('BAD_AMOUNT', 'Give an amount of SOL');
  if (sol < MIN_REAL_TRADE_SOL) throw errors.badRequest('BELOW_MIN_TRADE', `Trades start at ${MIN_REAL_TRADE_SOL} SOL`);
  const no = hardLimitRefusal(rules, { kind: 'buy', sol }, { pausedUntil: saved.pausedUntil, pausedReason: saved.pausedReason, now: d.now() });
  if (no) throw refuse(403, no.code, no.message);
  const [c] = await d.db.select().from(realMarket).where(eq(realMarket.address, mint));
  if (!c || !TRADABLE_DEXES.has(c.dexId)) throw refuse(404, 'UNKNOWN_MINT', 'Not a coin you can buy here: pick one from GET /agent/coins');
  const r = await d.bank.buy(agentId, { address: c.address, symbol: c.symbol, dexId: c.dexId, fdvUsd: c.fdvUsd, liquidityUsd: c.liquidityUsd, priceUsd: c.priceUsd }, sol, { why: thesisText(i, d.now()) });
  return { ok: r.ok, result: { outcome: r.outcome } };
}
