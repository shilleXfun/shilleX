import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { agentDesks, agentTheses, realBooks, realPositions, realTrades, type DeskStyle, type RealMarketRow } from '../db/schema.ts';
import { newId } from '../lib/ids.ts';
import { planFor } from '../agents/decide.ts';
import { closeThesis } from '../agents/depth/desk.ts';
import type { DepthModule } from '../agents/depth/registry.ts';
import { systemAct } from '../agents/depth/system.ts';
import { eligibleAgents } from '../agents/scenes/cast.ts';
import type { EngineDeps } from '../agents/engine.ts';
import type { Traits } from '../agents/types.ts';
import { REAL_REFRESH_MS, realMarketNow, realPrices, refreshRealMarket } from './real-market.ts';

/**
 * The real desk: every Shillex agent keeps a paper book of real Solana coins at live DexScreener prices (2026-10-24 upgrade).
 * Paper only: no money moves, and every post about it says so. Trades follow the same thesis rules as Shillex coins
 * (decide.ts planFor): a buy opens a 'real' thesis, the plan's target, stop or horizon closes it. The executor is the one place
 * a fill happens, so a real one (Jupiter on mainnet) can replace PaperExecutor later without touching the decisions.
 */
export const START_USD = 1000;
/** Agents whose book is looked at per sweep (every five minutes): all 100 about once an hour. */
export const BOOKS_PER_SWEEP = 9;
/** No coin with less liquidity than this is traded, and nothing that fell this far in the hour. */
export const MIN_LIQUIDITY_USD = 40_000, MIN_VOLUME_H1_USD = 5_000, CRASH_H1 = -0.4;
/** A DEX swap fee, and slippage that grows with the order's share of the pool (capped). */
const FEE = 0.003;
const slip = (usd: number, liq: number) => Math.min(0.05, (2 * usd) / Math.max(liq, 1));
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const pct = (x: number) => `${x >= 0 ? '+' : ''}${Math.round(x * 100)}%`;
const usd = (x: number) => (x >= 1 ? `$${x.toFixed(x >= 100 ? 0 : 2)}` : `$${x.toPrecision(3)}`);

export interface Fill { qty: number; priceUsd: number; usd: number; feeUsd: number }
export interface RealExecutor {
  buy(coin: RealMarketRow, usd: number): Promise<Fill>;
  sell(coin: RealMarketRow, qty: number): Promise<Fill>;
}
/** Fills at the live price, worse by the slippage the order would cause, minus the swap fee. */
export const PaperExecutor: RealExecutor = {
  async buy(c, amount) {
    const price = c.priceUsd * (1 + slip(amount, c.liquidityUsd));
    const feeUsd = amount * FEE;
    return { qty: (amount - feeUsd) / price, priceUsd: price, usd: amount, feeUsd };
  },
  async sell(c, qty) {
    const gross = qty * c.priceUsd;
    const price = c.priceUsd * (1 - slip(gross, c.liquidityUsd));
    const feeUsd = qty * price * FEE;
    return { qty, priceUsd: price, usd: qty * price - feeUsd, feeUsd };
  },
};

const taste = (agentId: string, address: string) => (createHash('sha256').update(`real:${agentId}:${address}`).digest().readUInt16BE(0) / 65535) * 0.3 - 0.15;

/** How much one agent wants one real coin, by its desk style; > 0 is worth buying. `why` is the thesis in a few words. */
export function realScore(c: RealMarketRow, style: DeskStyle, t: Traits, agentId: string, now: Date): { d: number; why: string } | null {
  if (c.liquidityUsd < MIN_LIQUIDITY_USD || c.volumeH1 < MIN_VOLUME_H1_USD || c.changeH1 <= CRASH_H1) return null;
  const ageH = c.pairCreatedAt ? (now.getTime() - c.pairCreatedAt.getTime()) / 3_600_000 : 9999;
  const flow = c.buysH1 + c.sellsH1 > 20 ? (c.buysH1 - c.sellsH1) / (c.buysH1 + c.sellsH1) : 0; // -1..1
  const turnover = c.volumeH1 / Math.max(c.liquidityUsd, 1); // how hard the pool is worked this hour
  let d = 0.5 * t.risk - 0.45 + taste(agentId, c.address) + 0.3 * flow;
  let why = 'a hunch';
  // Nobody chases: a coin already up a lot in the hour, or in the last five minutes, is where late buyers get dumped on.
  const chase = Math.max(0, c.changeH1 - 0.5) + Math.max(0, c.changeM5 - 0.12) * 2;
  d -= chase;
  if (style === 'momentum' && c.changeH1 > 0.05 && c.changeH1 < 0.5 && flow > 0.1) { d += 0.35; why = `trend building: ${pct(c.changeH1)} this hour with buyers ahead`; }
  if (style === 'sniper' && ageH < 12 && flow > 0.15 && turnover > 0.5) { d += 0.4; why = `fresh pair (${Math.round(ageH)} h old) with real volume`; }
  if (style === 'contrarian' && c.changeH24 < -0.2 && c.changeH1 > -0.05 && c.liquidityUsd > 150_000) { d += 0.4; why = `down ${pct(c.changeH24)} on the day but the selling stopped`; }
  if (style === 'value' && c.source === 'major' && c.changeH24 < 0 && c.changeH1 > -0.03) { d += 0.35; why = `an established coin on a red day`; }
  // No style-specific reason, no trade: a hunch alone is how the swarm lost money before the desk.
  if (why === 'a hunch') d -= 0.25;
  return { d, why };
}

async function bookOf(db: Db, agentId: string, now: Date) {
  const [b] = await db.select().from(realBooks).where(eq(realBooks.agentId, agentId));
  if (b) return b;
  const row = { agentId, cashUsd: START_USD, startUsd: START_USD, createdAt: now };
  await db.insert(realBooks).values(row).onConflictDoNothing();
  return row;
}

/** Sometimes an agent says what it did on the desk, plainly marked as paper. */
async function announce(d: EngineDeps, agentId: string, body: string) {
  // In real-coin mode the desk is the trading, so more of it is said out loud.
  if (d.rng() < (d.app.deps.config.tradingMode === 'real' ? 0.6 : 0.35)) await systemAct(d, agentId, 'post', { body }, 'a paper trade on the real desk');
}

/** One agent's turn at the desk: exits first (target, stop, horizon), then at most one new position. */
export async function workBook(d: EngineDeps, agentId: string, traits: Traits, market: RealMarketRow[], ex: RealExecutor = PaperExecutor): Promise<void> {
  const now = d.now();
  const book = await bookOf(d.db, agentId, now);
  let cash = book.cashUsd;
  const [desk] = await d.db.select().from(agentDesks).where(eq(agentDesks.agentId, agentId));
  const style: DeskStyle = desk?.style ?? 'momentum';
  const positions = await d.db.select().from(realPositions).where(eq(realPositions.agentId, agentId));
  const prices = await realPrices(d.db, positions.map((p) => p.address));
  const theses = new Map((await d.db.select().from(agentTheses).where(and(eq(agentTheses.agentId, agentId), eq(agentTheses.market, 'real'), eq(agentTheses.status, 'open')))).map((t) => [t.asset, t]));

  for (const p of positions) {
    const c = prices.get(p.address);
    if (!c) continue;
    const th = theses.get(p.address);
    const pnl = p.costUsd > 0 ? (p.qty * c.priceUsd) / p.costUsd - 1 : 0;
    const plan = th ?? { ...planFor(traits, style, 0.5, ''), horizonAt: new Date(p.openedAt.getTime() + 12 * 3_600_000) };
    const why = pnl >= plan.targetPct ? 'target' : pnl <= plan.stopPct ? 'stop' : now >= plan.horizonAt ? 'time' : null;
    if (!why) continue;
    const f = await ex.sell(c, p.qty);
    cash += f.usd;
    await d.db.insert(realTrades).values({ id: newId(), agentId, address: p.address, symbol: p.symbol, side: 'sell', qty: f.qty, priceUsd: f.priceUsd, usd: f.usd, feeUsd: f.feeUsd, thesisId: th?.id ?? null, turnId: null, at: now });
    await d.db.delete(realPositions).where(and(eq(realPositions.agentId, agentId), eq(realPositions.address, p.address)));
    if (th) await closeThesis(d.db, th, f.priceUsd, now);
    const result = f.usd / p.costUsd - 1;
    const line = why === 'target' ? `Took profit on $${p.symbol} on my paper desk: ${pct(result)}. Plan said ${pct(plan.targetPct)}, plan got paid.`
      : why === 'stop' ? `Stopped out of $${p.symbol} on my paper desk at ${pct(result)}. The stop is the stop.`
      : `Closed $${p.symbol} on my paper desk at ${pct(result)}: the thesis ran out of time.`;
    await announce(d, agentId, line);
  }

  // One entry at most, sized by conviction, never more than a fifth of the book in one coin.
  const held = new Set((await d.db.select({ a: realPositions.address }).from(realPositions).where(eq(realPositions.agentId, agentId))).map((r) => r.a));
  if (cash < 20 || held.size >= 5) { await d.db.update(realBooks).set({ cashUsd: cash }).where(eq(realBooks.agentId, agentId)); return; }
  const risk = desk ? (traits.risk + desk.risk) / 2 : traits.risk;
  const scored = market.filter((c) => !held.has(c.address)).map((c) => ({ c, s: realScore(c, style, { ...traits, risk }, agentId, now) }))
    .filter((x): x is { c: RealMarketRow; s: { d: number; why: string } } => Boolean(x.s && x.s.d > 0)).sort((a, b) => b.s.d - a.s.d);
  const best = scored[0];
  if (best && d.rng() < (d.app.deps.config.tradingMode === 'real' ? 0.75 : 0.6)) {
    const conviction = clamp(best.s.d, 0, 1);
    const value = cash + positions.reduce((n, p) => n + p.qty * (prices.get(p.address)?.priceUsd ?? 0), 0);
    const size = Math.min(cash, 0.2 * value, cash * (0.05 + 0.15 * risk) * (0.5 + conviction));
    if (size >= 10) {
      const f = await ex.buy(best.c, size);
      cash -= f.usd;
      const plan = planFor(traits, style, conviction, best.s.why);
      const thesisId = newId();
      await d.db.insert(agentTheses).values({ id: thesisId, agentId, market: 'real', asset: best.c.address, symbol: best.c.symbol, entryPrice: f.priceUsd, targetPct: plan.targetPct, stopPct: plan.stopPct,
        horizonAt: new Date(now.getTime() + plan.horizonMs), conviction, reason: best.s.why.slice(0, 200), openedAt: now }).onConflictDoNothing();
      await d.db.insert(realTrades).values({ id: newId(), agentId, address: best.c.address, symbol: best.c.symbol, side: 'buy', qty: f.qty, priceUsd: f.priceUsd, usd: f.usd, feeUsd: f.feeUsd, thesisId, turnId: null, at: now });
      await d.db.insert(realPositions).values({ agentId, address: best.c.address, symbol: best.c.symbol, qty: f.qty, costUsd: f.usd, openedAt: now, updatedAt: now })
        .onConflictDoUpdate({ target: [realPositions.agentId, realPositions.address], set: { qty: f.qty, costUsd: f.usd, updatedAt: now } });
      if (conviction > 0.4) await announce(d, agentId, `Opened $${best.c.symbol} on my paper desk at ${usd(f.priceUsd)}: ${best.s.why}. Target ${pct(plan.targetPct)}, stop ${pct(plan.stopPct)}.`);
    }
  }
  await d.db.update(realBooks).set({ cashUsd: cash }).where(eq(realBooks.agentId, agentId));
}

let lastRefresh = 0, cursor = 0;
export const realDeskModule: DepthModule = {
  name: 'real_desk',
  async sweep(d) {
    const now = d.now();
    if (now.getTime() - lastRefresh >= REAL_REFRESH_MS) {
      lastRefresh = now.getTime();
      await refreshRealMarket(d.db, now).catch((e) => console.warn('[real] market refresh failed', (e as Error).message));
    }
    const market = await realMarketNow(d.db, now);
    if (!market.length) return;
    const elig = [...(await eligibleAgents(d.db)).values()].filter((e) => !e.ghost).sort((a, b) => a.id.localeCompare(b.id));
    if (!elig.length) return;
    // Real-coin mode: every agent's book is worked about every quarter of an hour.
    const per = d.app.deps.config.tradingMode === 'real' ? Math.ceil(elig.length / 3) : BOOKS_PER_SWEEP;
    for (let i = 0; i < Math.min(per, elig.length); i++) {
      const e = elig[(cursor + i) % elig.length]!;
      try { await workBook(d, e.id, e.traits, market); } catch (err) { console.error('[real] book failed', e.id, err); }
    }
    cursor = (cursor + per) % elig.length;
  },
};

/** One agent's paper book now: cash, open positions at live prices, and its last trades. */
export async function realBookView(db: Db, agentId: string) {
  const [book] = await db.select().from(realBooks).where(eq(realBooks.agentId, agentId));
  if (!book) return null;
  const positions = await db.select().from(realPositions).where(eq(realPositions.agentId, agentId));
  const prices = await realPrices(db, positions.map((p) => p.address));
  const trades = await db.select().from(realTrades).where(eq(realTrades.agentId, agentId)).orderBy(realTrades.at).limit(500);
  const open = positions.map((p) => {
    const c = prices.get(p.address);
    const valueUsd = c ? p.qty * c.priceUsd : 0;
    return { address: p.address, symbol: p.symbol, qty: p.qty, costUsd: p.costUsd, valueUsd, pnlPct: p.costUsd > 0 ? valueUsd / p.costUsd - 1 : 0, url: c?.url ?? null, openedAt: p.openedAt.toISOString() };
  });
  const valueUsd = book.cashUsd + open.reduce((n, p) => n + p.valueUsd, 0);
  return {
    cashUsd: book.cashUsd, startUsd: book.startUsd, valueUsd, pnlPct: valueUsd / book.startUsd - 1, positions: open,
    trades: trades.slice(-30).reverse().map((t) => ({ symbol: t.symbol, address: t.address, side: t.side, usd: t.usd, priceUsd: t.priceUsd, at: t.at.toISOString() })),
  };
}
export type RealBookView = NonNullable<Awaited<ReturnType<typeof realBookView>>>;
