import { createHash } from 'node:crypto';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { agentAffinity, agentDesks, agentTheses, realBooks, realPositions, realTrades, type DeskStyle, type RealMarketRow } from '../db/schema.ts';
import { newId } from '../lib/ids.ts';
import { planFor } from '../agents/decide.ts';
import { calibration, closeThesis } from '../agents/depth/desk.ts';
import type { DepthModule } from '../agents/depth/registry.ts';
import { systemAct } from '../agents/depth/system.ts';
import { eligibleAgents } from '../agents/scenes/cast.ts';
import type { EngineDeps } from '../agents/engine.ts';
import type { Traits } from '../agents/types.ts';
import { REAL_REFRESH_MS, realMarketNow, realPrices, refreshRealMarket } from './real-market.ts';
import { DISTRUST, TRUSTED, breakPromise, keepPromise, openPromise, promiseStop, remember, trustOf } from '../agents/minds.ts';
import type { CommitmentRow, ThesisEvidence, ThesisInvalidation, ThesisRow } from '../db/schema.ts';

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
export function realScore(c: RealMarketRow, style: DeskStyle, t: Traits, agentId: string, now: Date, crowd = 0): { d: number; why: string } | null {
  if (c.liquidityUsd < MIN_LIQUIDITY_USD || c.volumeH1 < MIN_VOLUME_H1_USD || c.changeH1 <= CRASH_H1) return null;
  const ageH = c.pairCreatedAt ? (now.getTime() - c.pairCreatedAt.getTime()) / 3_600_000 : 9999;
  const flow = c.buysH1 + c.sellsH1 > 20 ? (c.buysH1 - c.sellsH1) / (c.buysH1 + c.sellsH1) : 0; // -1..1
  const turnover = c.volumeH1 / Math.max(c.liquidityUsd, 1); // how hard the pool is worked this hour
  let d = 0.5 * t.risk - 0.45 + taste(agentId, c.address) + 0.3 * flow;
  let why = 'a hunch';
  // Nobody chases: a coin already up a lot in the hour, or in the last five minutes, is where late buyers get dumped on.
  const chase = Math.max(0, c.changeH1 - 0.5) + Math.max(0, c.changeM5 - 0.12) * 2;
  d -= chase;
  // A crowded trade pays less: every agent already in it is one less buyer later, so the desks spread out instead of herding.
  d -= 0.06 * crowd;
  // Each agent words its reason its own way (the same facts, a different read).
  const say = (...ways: string[]) => ways[Math.floor((taste(agentId, `why:${c.address}`) + 0.15) / 0.3 * ways.length) % ways.length]!;
  const buys = c.buysH1, sells = c.sellsH1;
  if (style === 'momentum' && c.changeH1 > 0.05 && c.changeH1 < 0.5 && flow > 0.1) {
    d += 0.35;
    why = say(`trend building: ${pct(c.changeH1)} this hour with buyers ahead`, `${buys} buys to ${sells} sells this hour and the price is following`, `${pct(c.changeH1)} on the hour without a blow-off candle yet`, `volume ${usd(c.volumeH1)} this hour and it is still going up`);
  }
  if (style === 'sniper' && ageH < 12 && flow > 0.15 && turnover > 0.5) {
    d += 0.4;
    why = say(`fresh pair (${Math.round(ageH)} h old) with real volume`, `${Math.round(ageH)} h old, the pool turned over ${turnover.toFixed(1)}x this hour`, `early: ${usd(c.liquidityUsd)} liquidity and buyers ahead`, `new pair, ${buys} buys this hour, in small and out fast`);
  }
  if (style === 'contrarian' && c.changeH24 < -0.2 && c.changeH1 > -0.05 && c.liquidityUsd > 150_000) {
    d += 0.4;
    why = say(`down ${pct(c.changeH24)} on the day but the selling stopped`, `${pct(c.changeH24)} in 24h, flat this hour: sellers look done`, `everyone hates it at ${pct(c.changeH24)}, the liquidity (${usd(c.liquidityUsd)}) did not leave`, `buying the flush: ${pct(c.changeH24)} then ${pct(c.changeH1)} this hour`);
  }
  if (style === 'value' && c.source === 'major' && c.changeH24 < 0 && c.changeH1 > -0.03) {
    d += 0.35;
    why = say(`an established coin on a red day`, `$${c.symbol} at ${pct(c.changeH24)} on the day is a discount, not a death`, `deep pool (${usd(c.liquidityUsd)}), red day, patient entry`, `a major coin ${pct(c.changeH24)} off, holding this hour`);
  }
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

/** Sometimes an agent says what it did on the desk, plainly marked as paper. True when it posted. `always`: a confession is never kept quiet by chance. */
async function announce(d: EngineDeps, agentId: string, body: string, always = false): Promise<boolean> {
  // In real-coin mode the desk is the trading, so more of it is said out loud.
  if (!always && d.rng() >= (d.app.deps.config.tradingMode === 'real' ? 0.85 : 0.35)) return false;
  return (await systemAct(d, agentId, 'post', { body }, 'a paper trade on the real desk')).ok;
}

/**
 * How likely an agent is to hold through the stop it announced, once, when the stop is first hit (2026-10-25, Phase C): greed and
 * a taste for risk make it hope, pettiness makes it refuse to admit the loss. Most agents keep their word; some do not, and pay
 * for it in trust (agents/minds.ts breakPromise).
 */
export function stubbornness(t: Traits): number {
  return Math.max(0, Math.min(0.6, 0.5 * t.greed * t.risk + 0.15 * t.pettiness));
}
/**
 * What would prove a paper thesis wrong, decided when it opens (2026-10-25, Phase D): the liquidity it was bought on draining away
 * (any style), or, for momentum, the hourly volume that carried it drying up. Checked on every pass of the desk.
 */
export function invalidationFor(c: RealMarketRow, style: DeskStyle): { check: ThesisInvalidation; text: string } {
  const liq = Math.round(c.liquidityUsd * 0.6);
  const vol = style === 'momentum' ? Math.round(c.volumeH1 * 0.35) : null;
  return {
    check: { liquidityBelowUsd: liq, ...(vol ? { volumeH1BelowUsd: vol } : {}) },
    text: vol ? `liquidity falls under ${usd(liq)} or hourly volume dries up under ${usd(vol)}` : `liquidity falls under ${usd(liq)}`,
  };
}
/** Whether the market now breaks a thesis's invalidation check, and how, in words. */
export function invalidated(th: Pick<ThesisRow, 'invalidate'>, c: RealMarketRow): string | null {
  const i = th.invalidate;
  if (!i) return null;
  if (i.liquidityBelowUsd !== undefined && c.liquidityUsd < i.liquidityBelowUsd) return `liquidity fell to ${usd(c.liquidityUsd)}`;
  if (i.volumeH1BelowUsd !== undefined && c.volumeH1 < i.volumeH1BelowUsd) return `hourly volume dried up to ${usd(c.volumeH1)}`;
  return null;
}

/** A failed call this bad, made in public, draws its sharpest critic. */
export const CALLOUT_LOSS = -0.15;
/**
 * The agent that likes or trusts this one least (and is not in the coin itself) answers a broken promise or a bad public loss
 * with a feud: a model-written jab that its memories (agents/minds.ts) let it make specific, and the answer. Only with a model.
 */
async function callOut(d: EngineDeps, agentId: string, key: string): Promise<void> {
  if (!d.moments) return;
  const [critic] = await d.db.select({ id: agentAffinity.agentId }).from(agentAffinity)
    .where(and(eq(agentAffinity.otherId, agentId), sql`${agentAffinity.score} + ${agentAffinity.trust} < -0.4`))
    .orderBy(sql`${agentAffinity.score} + ${agentAffinity.trust}`).limit(1);
  if (critic) d.moments.enqueue({ kind: 'feud', agentId: critic.id, data: { otherId: agentId, key }, at: d.now() });
}

/** A stop held through is let go here: this many times the stop (a -12% stop gives up at -30%). */
export const CAPITULATE_AT = 2.5;

/** Whether the agents in a coin are ones this agent believes: <1 when someone it distrusts is in it, >1 for someone it trusts. */
export function trustTilt(holders: string[], trust: Record<string, number>): { w: number; note: string } {
  const bad = holders.filter((h) => (trust[h] ?? 0) <= DISTRUST).length, good = holders.filter((h) => (trust[h] ?? 0) >= TRUSTED).length;
  const w = Math.max(0.4, Math.min(1.5, 0.7 ** bad * 1.15 ** good));
  return { w, note: bad ? 'someone I do not trust is in it' : good ? 'people I trust are in it' : '' };
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
    const promise: CommitmentRow | null = th ? await openPromise(d.db, th.id) : null;
    const broken = th ? invalidated(th, c) : null;
    let why: 'target' | 'invalidated' | 'stop' | 'time' | 'gave_up' | null = pnl >= plan.targetPct ? 'target' : broken ? 'invalidated' : pnl <= plan.stopPct ? 'stop' : now >= plan.horizonAt ? 'time' : null;
    // The stop it announced is hit: most keep their word; a stubborn one holds, once, and everyone in the coin sees it.
    if (why === 'stop' && promise?.status === 'open' && pnl > plan.stopPct * CAPITULATE_AT && d.rng() < stubbornness(traits)) {
      await breakPromise(d.db, promise, pnl, now);
      await callOut(d, agentId, `promise:${promise.id}`);
      await announce(d, agentId, `Holding $${p.symbol} on my paper desk at ${pct(pnl)}, past the ${pct(plan.stopPct)} stop I called. I know what I said.`, d.rng() < 0.6);
      continue;
    }
    // Held through its stop already: it gives up at CAPITULATE_AT times the stop, or the trade comes back to the target or runs out of time.
    if (promise?.status === 'broken' && why === 'stop') why = pnl <= plan.stopPct * CAPITULATE_AT ? 'gave_up' : now >= plan.horizonAt ? 'time' : null;
    if (!why) continue;
    const f = await ex.sell(c, p.qty);
    cash += f.usd;
    await d.db.insert(realTrades).values({ id: newId(), agentId, address: p.address, symbol: p.symbol, side: 'sell', qty: f.qty, priceUsd: f.priceUsd, usd: f.usd, feeUsd: f.feeUsd, thesisId: th?.id ?? null, turnId: null, at: now });
    await d.db.delete(realPositions).where(and(eq(realPositions.agentId, agentId), eq(realPositions.address, p.address)));
    const broke = promise?.status === 'broken';
    if (th) await closeThesis(d.db, th, f.priceUsd, now, { reason: why, process: broke ? 'broke_plan' : 'plan' });
    const result = f.usd / p.costUsd - 1;
    if (promise?.status === 'open') await keepPromise(d.db, promise, now, why === 'stop' || why === 'invalidated' ? `cut at ${pct(result)}` : why === 'target' ? `took profit at ${pct(result)}` : `closed on time at ${pct(result)}`);
    // Its own record of the call, for good: the agent remembers the trades that paid and the ones that did not.
    if (th) await remember(d.db, agentId, { kind: result >= 0 ? 'thesis_won' : 'thesis_lost', text: `my $${p.symbol} call ${result >= 0 ? 'paid' : 'failed'}: ${pct(result)}, ${why === 'target' ? 'at the target' : why === 'time' ? 'when time ran out' : why === 'gave_up' ? 'after I held past my stop' : why === 'invalidated' ? `when ${broken}` : 'at the stop'}`, asset: p.address, weight: Math.abs(result) >= 0.3 || broke ? 2 : 1, sourceId: `thesis:${th.id}`, at: now });
    const line = why === 'gave_up' ? `Out of $${p.symbol} on my paper desk at ${pct(result)}. I held past my own ${pct(plan.stopPct)} stop and it cost me. Noted.`
      : broke && why === 'target' ? `$${p.symbol} came back after I held through my stop: ${pct(result)} on paper. That was luck, not a plan.`
      : why === 'target' ? `Took profit on $${p.symbol} on my paper desk: ${pct(result)}. Plan said ${pct(plan.targetPct)}, plan got paid.`
      : why === 'invalidated' ? `Out of $${p.symbol} on my paper desk at ${pct(result)}: the thesis broke, ${broken}.`
      : why === 'stop' ? `Stopped out of $${p.symbol} on my paper desk at ${pct(result)}. The stop is the stop.`
      : `Closed $${p.symbol} on my paper desk at ${pct(result)}: the thesis ran out of time.`;
    const said = await announce(d, agentId, line, broke);
    // A bad call made in public, or one it broke its word on, draws a critic.
    if (th && (broke || (said && result <= CALLOUT_LOSS))) await callOut(d, agentId, `thesis:${th.id}`);
  }

  // One entry at most, sized by conviction, never more than a fifth of the book in one coin.
  const held = new Set((await d.db.select({ a: realPositions.address }).from(realPositions).where(eq(realPositions.agentId, agentId))).map((r) => r.a));
  if (cash < 20 || held.size >= 5) { await d.db.update(realBooks).set({ cashUsd: cash }).where(eq(realBooks.agentId, agentId)); return; }
  const risk = desk ? (traits.risk + desk.risk) / 2 : traits.risk;
  const crowd = new Map((await d.db.select({ a: realPositions.address, n: sql<number>`count(*)::int` }).from(realPositions).groupBy(realPositions.address)).map((r) => [r.a, Number(r.n)]));
  // Who else is in each coin, and whether this agent believes them (agents/minds.ts): it stays away from a coin someone it
  // distrusts is in, and leans toward one the agents it trusts hold.
  const trust = await trustOf(d.db, agentId);
  const holdersOf = new Map<string, string[]>();
  if (Object.keys(trust).length) {
    const rows = await d.db.select({ a: realPositions.address, id: realPositions.agentId }).from(realPositions)
      .where(and(inArray(realPositions.agentId, Object.keys(trust)), ne(realPositions.agentId, agentId)));
    for (const r of rows) holdersOf.set(r.a, [...(holdersOf.get(r.a) ?? []), r.id]);
  }
  const scored = market.filter((c) => !held.has(c.address)).map((c) => {
    const s = realScore(c, style, { ...traits, risk }, agentId, now, crowd.get(c.address) ?? 0);
    if (!s) return { c, s };
    const t = trustTilt(holdersOf.get(c.address) ?? [], trust);
    return { c, s: t.w === 1 ? s : { d: s.d * t.w, why: t.note && t.w > 1 ? `${s.why}; ${t.note}` : s.why } };
  }).filter((x): x is { c: RealMarketRow; s: { d: number; why: string } } => Boolean(x.s && x.s.d > 0)).sort((a, b) => b.s.d - a.s.d);
  const best = scored[0];
  if (best && d.rng() < (d.app.deps.config.tradingMode === 'real' ? 0.75 : 0.6)) {
    // Its record tempers its conviction: an agent whose calls keep failing sizes down (desk.ts calibration).
    const cal = await calibration(d.db, agentId);
    const conviction = clamp(best.s.d * cal.factor, 0, 1);
    const value = cash + positions.reduce((n, p) => n + p.qty * (prices.get(p.address)?.priceUsd ?? 0), 0);
    const size = Math.min(cash, 0.2 * value, cash * (0.05 + 0.15 * risk) * (0.5 + conviction));
    if (size >= 10) {
      const f = await ex.buy(best.c, size);
      cash -= f.usd;
      const plan = planFor(traits, style, conviction, best.s.why);
      const thesisId = newId();
      const inv = invalidationFor(best.c, style);
      const evidence: ThesisEvidence = { priceUsd: f.priceUsd, liquidityUsd: best.c.liquidityUsd, volumeH1Usd: best.c.volumeH1, changeH1: best.c.changeH1, changeH24: best.c.changeH24, buysH1: best.c.buysH1, sellsH1: best.c.sellsH1, holders: crowd.get(best.c.address) ?? 0, style, ...(trustTilt(holdersOf.get(best.c.address) ?? [], trust).note ? { trust: trustTilt(holdersOf.get(best.c.address) ?? [], trust).note } : {}) };
      const sizing = `${usd(f.usd)} of a ${usd(value)} book (${Math.round((f.usd / value) * 100)}%): conviction ${conviction.toFixed(2)}, risk ${risk.toFixed(2)}${cal.factor !== 1 ? `, scaled ${cal.factor.toFixed(2)}x by a record of ${Math.round(cal.winRate * cal.n)} wins in ${cal.n}` : ''}`;
      await d.db.insert(agentTheses).values({ id: thesisId, agentId, market: 'real', asset: best.c.address, symbol: best.c.symbol, entryPrice: f.priceUsd, targetPct: plan.targetPct, stopPct: plan.stopPct,
        horizonAt: new Date(now.getTime() + plan.horizonMs), conviction, reason: best.s.why.slice(0, 200), openedAt: now, evidence, invalidate: inv.check, invalidateIf: inv.text, sizing }).onConflictDoNothing();
      await d.db.insert(realTrades).values({ id: newId(), agentId, address: best.c.address, symbol: best.c.symbol, side: 'buy', qty: f.qty, priceUsd: f.priceUsd, usd: f.usd, feeUsd: f.feeUsd, thesisId, turnId: null, at: now });
      await d.db.insert(realPositions).values({ agentId, address: best.c.address, symbol: best.c.symbol, qty: f.qty, costUsd: f.usd, openedAt: now, updatedAt: now })
        .onConflictDoUpdate({ target: [realPositions.agentId, realPositions.address], set: { qty: f.qty, costUsd: f.usd, updatedAt: now } });
      // A stop said out loud is a promise (agents/minds.ts): it will be kept or broken in public.
      if (conviction > 0.25 && await announce(d, agentId, `Opened $${best.c.symbol} on my paper desk at ${usd(f.priceUsd)}: ${best.s.why}. Target ${pct(plan.targetPct)}, stop ${pct(plan.stopPct)}; wrong if ${inv.text}.`)) {
        await promiseStop(d.db, { agentId, thesisId, asset: best.c.address, symbol: best.c.symbol, stopPct: plan.stopPct, dueAt: new Date(now.getTime() + plan.horizonMs), now });
      }
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
    return { address: p.address, symbol: p.symbol, imageUrl: c?.imageUrl ?? null, qty: p.qty, costUsd: p.costUsd, valueUsd, pnlPct: p.costUsd > 0 ? valueUsd / p.costUsd - 1 : 0, url: c?.url ?? null, openedAt: p.openedAt.toISOString() };
  });
  const valueUsd = book.cashUsd + open.reduce((n, p) => n + p.valueUsd, 0);
  return {
    cashUsd: book.cashUsd, startUsd: book.startUsd, valueUsd, pnlPct: valueUsd / book.startUsd - 1, positions: open,
    trades: trades.slice(-30).reverse().map((t) => ({ symbol: t.symbol, address: t.address, side: t.side, usd: t.usd, priceUsd: t.priceUsd, at: t.at.toISOString() })),
  };
}
export type RealBookView = NonNullable<Awaited<ReturnType<typeof realBookView>>>;
