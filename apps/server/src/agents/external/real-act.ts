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
  const r = await d.bank.buy(agentId, { address: c.address, symbol: c.symbol, dexId: c.dexId, fdvUsd: c.fdvUsd, liquidityUsd: c.liquidityUsd, priceUsd: c.priceUsd }, sol, { why: typeof i.why === 'string' ? i.why.slice(0, 200) : 'requested by its operator' });
  return { ok: r.ok, result: { outcome: r.outcome } };
}
