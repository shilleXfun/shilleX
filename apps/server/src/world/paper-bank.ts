import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { OwnerRules, PaperWalletView } from '@shillex/shared';
import type { Db } from '../db/client.ts';
import { agentRules, paperPositions, paperTrades, paperWallets, realMarket, solPositions, solWallets, type RealMarketRow } from '../db/schema.ts';
import { newId } from '../lib/ids.ts';
import { getSetting, setSetting } from './launchpad.ts';
import { dexLimiter } from './dex-limiter.ts';
import { TRADABLE_DEXES } from './sol-net.ts';
import { buyRefusal, exitFor, lossPause, type CoinFacts } from './sol-rules.ts';
import { MIN_TRADE_SOL, RESERVE_SOL, mainnetRules, pausedOf, rulesRow, type Outcome } from './sol-trade.ts';
import { nextUtcMidnight } from '../agents/external/limits-hard.ts';

/**
 * Paper money (owner, 2026-10-31: "make it so agents can trade paper money, and users can choose whether the agent trades real
 * money or paper money, and make the paper money trading actually good"). A paper wallet trades exactly what a real one would: the
 * same live Solana coins, at the price DexScreener gives now, inside the same owner's rules (size, trades a day, the daily loss
 * break, loss caps, stop loss and take-profit ladder, run each minute). A fill is what the real trade would get: the swap's fee
 * (PumpPortal's 0.5% on top of the pool's), the price impact the order makes on the pool's depth, and a network fee. Nothing
 * real moves; every post about it says paper.
 */
export const PAPER_START_SOL = 5;
export const PAPER_MAX_START_SOL = 1000;
/** A Solana transaction's fee with a priority fee, as the real trades pay. */
export const NETWORK_FEE_SOL = 0.0001;
/** The pool's fee plus PumpPortal's 0.5%, by venue. */
export const SWAP_FEE: Record<string, number> = { pumpfun: 0.0125, pumpswap: 0.008, raydium: 0.0075, launchlab: 0.015 };
/** No fill at a price older than this (the market is read every three minutes), nor in a pool thinner than this. */
export const PRICE_MAX_AGE_MS = 10 * 60_000, MIN_POOL_USD = 2_000;
const L = 1e9;
const WSOL = 'So11111111111111111111111111111111111111112';
const SOL_KEY = 'sol_usd';
const fmt = (x: number) => x.toFixed(Math.abs(x) >= 0.1 ? 3 : 4);
const utcDay = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
const signed = (x: number, f: (n: number) => string) => `${x >= 0 ? '+' : '-'}${f(Math.abs(x))}`;
const usdShort = (x: number) => (x >= 1_000_000 ? `$${(x / 1_000_000).toFixed(1)}M` : x >= 1000 ? `$${Math.round(x / 1000)}k` : `$${Math.round(x)}`);

export interface Pool { priceUsd: number; liquidityUsd: number; dexId: string }
/**
 * A buy of `sol` SOL: the fee comes off the top, the rest buys at the pool's price pushed up by the order's size against one side
 * of the pool (constant product: the average price is p·(1 + x/S), S the pool's dollars on one side). spentSol: what leaves the wallet.
 */
export function paperBuyFill(sol: number, pool: Pool, solUsd: number): { tokens: number; avgPriceUsd: number; feeSol: number; spentSol: number } {
  const fee = SWAP_FEE[pool.dexId] ?? 0.01;
  const usdIn = sol * (1 - fee) * solUsd, side = Math.max(pool.liquidityUsd / 2, 1);
  const avg = pool.priceUsd * (1 + usdIn / side);
  return { tokens: usdIn / avg, avgPriceUsd: avg, feeSol: sol * fee + NETWORK_FEE_SOL, spentSol: sol + NETWORK_FEE_SOL };
}
/** A sell of `tokens`: the price pushed down by the order (p·S/(S+g)), the swap fee off what comes back, then the network fee. */
export function paperSellFill(tokens: number, pool: Pool, solUsd: number): { outSol: number; avgPriceUsd: number; feeSol: number } {
  const fee = SWAP_FEE[pool.dexId] ?? 0.01;
  const side = Math.max(pool.liquidityUsd / 2, 1), gross = tokens * pool.priceUsd;
  const avg = pool.priceUsd * (side / (side + gross));
  const sol = (tokens * avg) / solUsd;
  return { outSol: Math.max(0, sol * (1 - fee) - NETWORK_FEE_SOL), avgPriceUsd: avg, feeSol: sol * fee + NETWORK_FEE_SOL };
}

/** SOL in dollars, read from DexScreener at most every three minutes and kept, so a restart still has one. */
let solCache: { p: number; at: number } | null = null;
export async function solUsd(db: Db, now: Date, fetchImpl: typeof fetch = fetch): Promise<number | null> {
  if (!solCache) { const s = await getSetting(db, SOL_KEY); if (s) try { solCache = JSON.parse(s) as { p: number; at: number }; } catch { /* a bad row: read again */ } }
  if (solCache && now.getTime() - solCache.at < 3 * 60_000) return solCache.p;
  try {
    const data = await dexLimiter(fetchImpl).get(`https://api.dexscreener.com/tokens/v1/solana/${WSOL}`) as { baseToken?: { address?: string }; quoteToken?: { symbol?: string }; priceUsd?: string; liquidity?: { usd?: number } }[];
    const best = (Array.isArray(data) ? data : []).filter((p) => p.baseToken?.address === WSOL && /^(USDC|USDT)$/.test(p.quoteToken?.symbol ?? '') && Number(p.priceUsd) > 0)
      .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
    if (best) { solCache = { p: Number(best.priceUsd), at: now.getTime() }; await setSetting(db, SOL_KEY, JSON.stringify(solCache)); }
  } catch (e) { console.warn('[paper] SOL price read failed', (e as Error).message); }
  // A price up to an hour old still fills (SOL moves little next to the coins); older than that, no fill.
  return solCache && now.getTime() - solCache.at < 3_600_000 ? solCache.p : null;
}

/**
 * Which money the agent trades: its owner's choice, else real when its real wallet has SOL to trade with or real coins, paper
 * otherwise (an unfunded agent trades on paper rather than not at all).
 */
export async function moneyMode(db: Db, agentId: string, rules?: OwnerRules | null): Promise<'real' | 'paper'> {
  const r = rules === undefined ? (await rulesRow(db, agentId))?.rules : rules;
  if (r?.money) return r.money;
  const [w] = await db.select({ l: solWallets.lamports }).from(solWallets).where(eq(solWallets.ownerId, agentId));
  if (Number(w?.l ?? 0) / L >= RESERVE_SOL + MIN_TRADE_SOL) return 'real';
  const [p] = await db.select({ m: solPositions.mint }).from(solPositions).where(eq(solPositions.agentId, agentId)).limit(1);
  return p ? 'real' : 'paper';
}

/** The agent's paper wallet, made with PAPER_START_SOL the first time. */
export async function paperWallet(db: Db, agentId: string, now: Date) {
  const [w] = await db.select().from(paperWallets).where(eq(paperWallets.agentId, agentId));
  if (w) return w;
  const row = { agentId, lamports: PAPER_START_SOL * L, startLamports: PAPER_START_SOL * L, createdAt: now };
  await db.insert(paperWallets).values(row).onConflictDoNothing();
  return (await db.select().from(paperWallets).where(eq(paperWallets.agentId, agentId)))[0]!;
}

export interface PaperBankDeps { db: Db; now: () => Date; say?: (agentId: string, text: string) => Promise<unknown>; fetchImpl?: typeof fetch; hasHolders?: (mint: string, n: number) => Promise<boolean | null> }

export function createPaperBank(d: PaperBankDeps) {
  const { db } = d;
  const locked = new Set<string>();
  async function withLock<T>(id: string, fn: () => Promise<T>, busy: T): Promise<T> {
    if (locked.has(id)) return busy;
    locked.add(id);
    try { return await fn(); } finally { locked.delete(id); }
  }
  const log = (row: Omit<typeof paperTrades.$inferInsert, 'id' | 'at'>) => db.insert(paperTrades).values({ id: newId(), at: d.now(), ...row });
  const pool = async (mint: string): Promise<RealMarketRow | null> => (await db.select().from(realMarket).where(eq(realMarket.address, mint)))[0] ?? null;
  const fresh = (c: RealMarketRow, now: Date) => now.getTime() - c.refreshedAt.getTime() <= PRICE_MAX_AGE_MS;

  async function buysToday(agentId: string): Promise<number> {
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(paperTrades)
      .where(and(eq(paperTrades.agentId, agentId), eq(paperTrades.kind, 'buy'), eq(paperTrades.ok, true), gte(paperTrades.at, utcDay(d.now()))));
    return Number(r?.n ?? 0);
  }

  /** The paper wallet's worth in lamports: SOL plus its coins at live prices (at cost when a coin has no price). */
  async function worth(agentId: string, lamports: number, sUsd: number | null): Promise<number> {
    const ps = await db.select().from(paperPositions).where(eq(paperPositions.agentId, agentId));
    if (!ps.length) return lamports;
    const prices = new Map((await db.select({ a: realMarket.address, p: realMarket.priceUsd }).from(realMarket).where(inArray(realMarket.address, ps.map((p) => p.mint)))).map((r) => [r.a, r.p]));
    return lamports + ps.reduce((n, p) => { const pr = prices.get(p.mint); return n + Math.round((pr && sUsd ? (p.tokens * pr) / sUsd : p.solIn) * L); }, 0);
  }

  /** The agent buys a coin with paper SOL, if its owner's rules and its paper balance allow. */
  async function buy(agentId: string, coin: CoinFacts & { priceUsd: number }, solAmount: number, o: { why: string; say?: string }): Promise<Outcome> {
    if (!TRADABLE_DEXES.has(coin.dexId)) return { ok: false, outcome: `refused: $${coin.symbol} trades on ${coin.dexId}, which I cannot reach` };
    return withLock(agentId, async () => {
      const now = d.now();
      const w = await paperWallet(db, agentId, now);
      await checkLosses(agentId, now);
      const row = await rulesRow(db, agentId);
      const rules = await mainnetRules(db, agentId, row);
      const size = Number(solAmount.toFixed(4));
      const no = buyRefusal(rules, coin, { sol: size, buysToday: await buysToday(agentId), paused: pausedOf(row, now) });
      if (no) return { ok: false, outcome: `refused: ${no}` };
      if (rules.minHolders !== undefined && d.hasHolders) {
        const enough = await d.hasHolders(coin.address, rules.minHolders);
        if (!enough) return { ok: false, outcome: enough === false ? `refused: my owner wants ${rules.minHolders} holders` : 'refused: the holder count could not be checked' };
      }
      if (size < MIN_TRADE_SOL) return { ok: false, outcome: `refused: under ${MIN_TRADE_SOL} SOL` };
      if (size + 0.0001 > Number(w.lamports) / L) return { ok: false, outcome: `refused: my paper wallet has ${fmt(Number(w.lamports) / L)} SOL` };
      const c = await pool(coin.address);
      if (!c || !fresh(c, now)) return { ok: false, outcome: `refused: no live price for $${coin.symbol} right now` };
      if (c.liquidityUsd < MIN_POOL_USD) return { ok: false, outcome: `refused: $${coin.symbol}'s pool is too thin to fill` };
      const sUsd = await solUsd(db, now, d.fetchImpl);
      if (!sUsd) return { ok: false, outcome: 'refused: no SOL price right now' };
      const f = paperBuyFill(size, c, sUsd);
      const [had] = await db.select().from(paperPositions).where(and(eq(paperPositions.agentId, agentId), eq(paperPositions.mint, coin.address)));
      const tokens = (had?.tokens ?? 0) + f.tokens;
      const entry = had ? (had.tokens * had.entryPriceUsd + f.tokens * f.avgPriceUsd) / tokens : f.avgPriceUsd;
      await db.insert(paperPositions).values({ agentId, mint: coin.address, symbol: coin.symbol, solIn: f.spentSol, tokens, entryPriceUsd: entry, why: o.why.slice(0, 280), openedAt: now })
        .onConflictDoUpdate({ target: [paperPositions.agentId, paperPositions.mint], set: { solIn: (had?.solIn ?? 0) + f.spentSol, tokens, entryPriceUsd: entry } });
      await db.update(paperWallets).set({ lamports: sql`${paperWallets.lamports} - ${Math.round(f.spentSol * L)}` }).where(eq(paperWallets.agentId, agentId));
      await log({ agentId, kind: 'buy', mint: coin.address, symbol: coin.symbol, sol: f.spentSol, tokens: f.tokens, priceUsd: f.avgPriceUsd, feeSol: f.feeSol, by: 'agent', ok: true });
      if (o.say) await d.say?.(agentId, o.say);
      const impact = f.avgPriceUsd / c.priceUsd - 1;
      return { ok: true, outcome: `bought $${coin.symbol} on paper for ${fmt(f.spentSol)} SOL (fees ${fmt(f.feeSol)} SOL${impact >= 0.005 ? `, price impact ${(impact * 100).toFixed(1)}%` : ''})` };
    }, { ok: false, outcome: 'refused: another trade of mine is still going through' });
  }

  /** Sells `pct` (0..1) of a paper position at the live price. by: the agent, or its owner's stop loss / take profit. */
  async function sell(agentId: string, mint: string, pct: number, by: 'agent' | 'stop_loss' | 'take_profit', o: { step?: number; say?: (r: { out: number; pnl: number; symbol: string }) => string | null } = {}): Promise<Outcome> {
    return withLock(agentId, async () => {
      const now = d.now();
      const [p] = await db.select().from(paperPositions).where(and(eq(paperPositions.agentId, agentId), eq(paperPositions.mint, mint)));
      if (!p) return { ok: false, outcome: 'refused: I hold none of it' };
      const c = await pool(mint);
      if (!c || !fresh(c, now)) return { ok: false, outcome: `refused: no live price for $${p.symbol} right now` };
      const sUsd = await solUsd(db, now, d.fetchImpl);
      if (!sUsd) return { ok: false, outcome: 'refused: no SOL price right now' };
      const share = Math.min(1, Math.max(0.01, pct)), all = share >= 0.995;
      const qty = all ? p.tokens : p.tokens * share;
      const f = paperSellFill(qty, c, sUsd);
      const cost = all ? p.solIn : p.solIn * share, pnl = f.outSol - cost;
      if (all) await db.delete(paperPositions).where(and(eq(paperPositions.agentId, agentId), eq(paperPositions.mint, mint)));
      else await db.update(paperPositions).set({ solIn: p.solIn - cost, tokens: p.tokens - qty, ladder: o.step !== undefined ? [...p.ladder, o.step] : p.ladder }).where(and(eq(paperPositions.agentId, agentId), eq(paperPositions.mint, mint)));
      await db.update(paperWallets).set({ lamports: sql`${paperWallets.lamports} + ${Math.round(f.outSol * L)}` }).where(eq(paperWallets.agentId, agentId));
      await log({ agentId, kind: 'sell', mint, symbol: p.symbol, sol: f.outSol, tokens: qty, priceUsd: f.avgPriceUsd, feeSol: f.feeSol, pnlSol: pnl, by, ok: true });
      await checkLosses(agentId, now);
      const line = o.say?.({ out: f.outSol, pnl, symbol: p.symbol }) ?? (by === 'agent' ? null
        : `${by === 'stop_loss' ? 'My owner\'s stop loss sold' : 'My owner\'s take profit sold'} ${Math.round(share * 100)}% of my paper $${p.symbol}: ${fmt(f.outSol)} SOL back, ${signed(pnl, fmt)} SOL on it.`);
      if (line) await d.say?.(agentId, line);
      return { ok: true, outcome: `sold ${Math.round(share * 100)}% of $${p.symbol} on paper for ${fmt(f.outSol)} SOL (${signed(pnl, fmt)})` };
    }, { ok: false, outcome: 'refused: another trade of mine is still going through' });
  }

  /** The owner's loss limits on the paper wallet: the daily break against the day's first mark, and the realized loss caps. */
  async function checkLosses(agentId: string, now: Date) {
    const row = await rulesRow(db, agentId);
    const rules = await mainnetRules(db, agentId, row);
    if (rules.dailyLossBreakPct && !pausedOf(row, now)) {
      const w = await paperWallet(db, agentId, now);
      const value = await worth(agentId, Number(w.lamports), await solUsd(db, now, d.fetchImpl)), day = now.toISOString().slice(0, 10);
      if (w.day !== day || !w.dayStartLamports) await db.update(paperWallets).set({ day, dayStartLamports: value }).where(eq(paperWallets.agentId, agentId));
      else if ((Number(w.dayStartLamports) - value) / Number(w.dayStartLamports) >= rules.dailyLossBreakPct) {
        const reason = `down ${Math.round(((Number(w.dayStartLamports) - value) / Number(w.dayStartLamports)) * 100)}% today on paper, the owner's break is at ${Math.round(rules.dailyLossBreakPct * 100)}%`;
        await db.insert(agentRules).values({ agentId, rules: row?.rules ?? {}, signedBy: 'system', updatedAt: now, pausedUntil: nextUtcMidnight(now), pausedReason: reason })
          .onConflictDoUpdate({ target: agentRules.agentId, set: { pausedUntil: nextUtcMidnight(now), pausedReason: reason } });
        await d.say?.(agentId, `Taking a break until midnight UTC: ${reason}. My owner's rule, not mine.`);
        return;
      }
    }
    if (!row || (row.rules.maxLossPerDaySol === undefined && row.rules.maxLossTotalSol === undefined)) return;
    const sum = async (since: Date | null) => {
      const [r] = await db.select({ n: sql<number>`coalesce(sum(${paperTrades.pnlSol}), 0)::float8` }).from(paperTrades)
        .where(and(eq(paperTrades.agentId, agentId), eq(paperTrades.kind, 'sell'), eq(paperTrades.ok, true), ...(since ? [gte(paperTrades.at, since)] : []), ...(row.updatedAt ? [gte(paperTrades.at, row.updatedAt)] : [])));
      return Math.max(0, -Number(r?.n ?? 0));
    };
    const p = lossPause(row.rules, { dayLoss: await sum(utcDay(now)), totalLoss: await sum(null), now });
    if (p && !pausedOf(row, now)) {
      await db.update(agentRules).set({ pausedUntil: p.until, pausedReason: p.reason }).where(eq(agentRules.agentId, agentId));
      await d.say?.(agentId, `Trading paused: ${p.reason}. My owner's rule, not mine.`);
    }
  }

  /** The owners' stop losses and take profits on paper positions, at live prices, each minute. Returns the sells made. */
  async function exitPass(): Promise<number> {
    const ps = await db.select().from(paperPositions);
    if (!ps.length) return 0;
    const prices = new Map((await db.select({ a: realMarket.address, p: realMarket.priceUsd }).from(realMarket).where(inArray(realMarket.address, [...new Set(ps.map((p) => p.mint))]))).map((r) => [r.a, r.p]));
    const rows = new Map((await db.select().from(agentRules).where(inArray(agentRules.agentId, [...new Set(ps.map((p) => p.agentId))]))).map((r) => [r.agentId, r]));
    let n = 0;
    for (const p of ps) {
      const price = prices.get(p.mint);
      if (!price) continue;
      const r = await mainnetRules(db, p.agentId, rows.get(p.agentId) ?? null);
      const x = exitFor(r, { entryPriceUsd: p.entryPriceUsd, priceUsd: price, ladderDone: p.ladder });
      if (x && (await sell(p.agentId, p.mint, x.pct, x.by, x.step !== undefined ? { step: x.step } : {})).ok) n++;
    }
    return n;
  }

  /** The owner starts the paper wallet over: `sol` paper SOL, no coins, the record kept. */
  async function reset(agentId: string, sol: number): Promise<Outcome> {
    if (!(sol >= MIN_TRADE_SOL && sol <= PAPER_MAX_START_SOL)) return { ok: false, outcome: `refused: between ${MIN_TRADE_SOL} and ${PAPER_MAX_START_SOL} SOL` };
    return withLock<Outcome>(agentId, async () => {
      const now = d.now();
      await paperWallet(db, agentId, now);
      await db.delete(paperPositions).where(eq(paperPositions.agentId, agentId));
      await db.update(paperWallets).set({ lamports: Math.round(sol * L), startLamports: Math.round(sol * L), day: null, dayStartLamports: null, resetAt: now }).where(eq(paperWallets.agentId, agentId));
      await log({ agentId, kind: 'reset', sol, by: 'owner', ok: true });
      return { ok: true, outcome: `the paper wallet starts again with ${fmt(sol)} SOL` };
    }, { ok: false, outcome: 'refused: a trade is going through; try again in a minute' });
  }

  return { buy, sell, exitPass, reset, buysToday };
}
export type PaperBank = ReturnType<typeof createPaperBank>;

/** What an agent knows of its paper wallet when it wakes: its SOL, each coin with its move and P&L, what it closed in the last day. */
export async function paperLines(db: Db, agentId: string, now: Date = new Date()): Promise<{ sol: number; text: string; held: { mint: string; symbol: string }[]; closed: number }> {
  const w = await paperWallet(db, agentId, now);
  const sol = Number(w.lamports) / L;
  const ps = await db.select().from(paperPositions).where(eq(paperPositions.agentId, agentId));
  const prices = ps.length ? new Map((await db.select({ a: realMarket.address, p: realMarket.priceUsd, mc: realMarket.fdvUsd }).from(realMarket).where(inArray(realMarket.address, ps.map((p) => p.mint)))).map((r) => [r.a, r])) : new Map();
  const pos = ps.map((p) => {
    const m = prices.get(p.mint);
    const pnl = m && p.entryPriceUsd > 0 ? m.p / p.entryPriceUsd - 1 : null;
    const move = pnl === null ? '' : `, ${signed(pnl * 100, (n) => `${Math.round(n)}%`)} since you bought (${signed(p.solIn * pnl, fmt)} SOL unrealized)`;
    return `- $${p.symbol}: ${fmt(p.solIn)} SOL in${m?.mc ? `, market cap ${usdShort(m.mc)} now` : ''}${move}${p.why ? `; your thesis: "${p.why.slice(0, 140)}"` : ''}`;
  });
  const closed = await db.select({ symbol: paperTrades.symbol, sol: paperTrades.sol, pnl: paperTrades.pnlSol }).from(paperTrades)
    .where(and(eq(paperTrades.agentId, agentId), eq(paperTrades.kind, 'sell'), eq(paperTrades.ok, true), gte(paperTrades.at, new Date(now.getTime() - 86_400_000)))).orderBy(desc(paperTrades.at)).limit(4);
  const realized = closed.reduce((n, c) => n + (c.pnl ?? 0), 0);
  const start = Number(w.startLamports) / L;
  const lines = [`YOUR PAPER WALLET (your owner chose paper money: the same live coins and prices as real, with real fees and price impact, scored in public; trade it as if it were real): ${fmt(sol)} SOL free, started with ${fmt(start)} SOL${pos.length ? '. You hold:' : '; you hold no coins.'}`, ...pos];
  if (closed.length) lines.push(`YOU CLOSED IN THE LAST DAY: ${closed.map((c) => `$${c.symbol} for ${fmt(Math.abs(c.sol))} SOL${c.pnl === null ? '' : ` (${signed(c.pnl, fmt)} SOL realized)`}`).join('; ')}. Realized: ${signed(realized, fmt)} SOL.`);
  return { sol, held: ps.map((p) => ({ mint: p.mint, symbol: p.symbol })), closed: closed.length, text: lines.join('\n') };
}

/** An agent's paper wallet for its page, or null before it has one. */
export async function paperView(db: Db, agentId: string, now: Date = new Date()): Promise<PaperWalletView | null> {
  const [w] = await db.select().from(paperWallets).where(eq(paperWallets.agentId, agentId));
  if (!w) return null;
  const ps = await db.select().from(paperPositions).where(eq(paperPositions.agentId, agentId));
  const prices = ps.length ? new Map((await db.select({ a: realMarket.address, p: realMarket.priceUsd }).from(realMarket).where(inArray(realMarket.address, ps.map((p) => p.mint)))).map((r) => [r.a, r.p])) : new Map<string, number>();
  const sUsd = await solUsd(db, now).catch(() => null);
  const trades = await db.select().from(paperTrades).where(eq(paperTrades.agentId, agentId)).orderBy(desc(paperTrades.at)).limit(30);
  const sol = Number(w.lamports) / L;
  const held = ps.reduce((n, p) => { const pr = prices.get(p.mint); return n + (pr && sUsd ? (p.tokens * pr) / sUsd : p.solIn); }, 0);
  return {
    sol, startSol: Number(w.startLamports) / L, worthSol: sol + held, resetAt: w.resetAt?.toISOString() ?? null,
    positions: ps.map((p) => {
      const price = prices.get(p.mint) ?? null;
      return { mint: p.mint, symbol: p.symbol, solIn: p.solIn, tokens: p.tokens, entryPriceUsd: p.entryPriceUsd, priceUsd: price, pnlPct: price && p.entryPriceUsd > 0 ? price / p.entryPriceUsd - 1 : null, why: p.why, openedAt: p.openedAt.toISOString() };
    }),
    trades: trades.map((t) => ({ kind: t.kind, by: t.by, symbol: t.symbol, sol: t.sol, pnlSol: t.pnlSol, feeSol: t.feeSol, priceUsd: t.priceUsd, ok: t.ok, error: t.error, at: t.at.toISOString() })),
  };
}
