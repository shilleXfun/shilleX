import { and, desc, eq, gte, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { OwnerRules, SolView } from '@shillex/shared';
import type { Db } from '../db/client.ts';
import { agentRules, agents, realMarket, solPositions, solTrades, solWallets, type SolTradeKind } from '../db/schema.ts';
import { newId } from '../lib/ids.ts';
import { getSetting, setSetting } from './launchpad.ts';
import { signerOf, walletFor } from './sol-vault.ts';
import { TRADABLE_DEXES, pumpTrade, transferSol, type SolNet } from './sol-net.ts';
import { buyRefusal, exitFor, lossPause, type CoinFacts } from './sol-rules.ts';
import { effectiveRules, nextUtcMidnight } from '../agents/external/limits-hard.ts';
import { agentDayMarks } from '../db/schema.ts';

/**
 * Real SOL (2026-10-27, docs/superpowers/plans/2026-10-27-real-sol-agents.md). Every agent has its own mainnet wallet (the vault
 * keeps the key); its owner sends SOL to it and withdraws only to a wallet the owner signs with. The agent buys and sells real
 * coins through PumpPortal when it decides to, inside its owner's rules (sol-rules.ts) and nothing else; the owner's stop loss,
 * take profit and loss limits are run here each minute. SOL moves between agents only through the marketplace's escrow.
 * The global kill switch (SOL_TRADING off, or the admin switch) stops every trade; withdrawals still work.
 */
export const ESCROW = 'escrow';
/** Left in a wallet for fees and a token account's rent. */
export const RESERVE_SOL = 0.006;
export const MIN_TRADE_SOL = 0.002;
/** Failed sells in a row before a position is left alone (and shown). */
export const SELL_FAILS_MAX = 5;
/** On top of a trade itself: network fees, PumpPortal's fee and a new token account's rent. */
const SPEND_SLACK_SOL = 0.004;
const L = 1e9;
const KILL_KEY = 'sol_killed';
const fmt = (x: number) => x.toFixed(Math.abs(x) >= 0.1 ? 3 : 4);
const utcDay = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
const errText = (e: unknown) => ((e as Error)?.message ?? String(e)).slice(0, 300);
const sigOf = (e: unknown) => (e as { sig?: string })?.sig ?? null;

/** True when a Shillex agent launched this coin: no Shillex agent may buy it (that would be fake volume sold to real people). */
export async function shillexCoin(db: Db, mint: string): Promise<boolean> {
  return (await db.select({ id: solTrades.id }).from(solTrades).where(and(eq(solTrades.kind, 'launch'), eq(solTrades.mint, mint), eq(solTrades.ok, true))).limit(1)).length > 0;
}

/** Why every trade is stopped right now, or null: the env switch, then the admin's. */
export async function killedReason(db: Db, envOn: boolean): Promise<string | null> {
  if (!envOn) return 'real SOL trading is switched off (SOL_TRADING)';
  return (await getSetting(db, KILL_KEY)) === '1' ? 'real SOL trading is stopped by the admin' : null;
}
export async function setKilled(db: Db, killed: boolean) { await setSetting(db, KILL_KEY, killed ? '1' : ''); }

export async function rulesRow(db: Db, agentId: string) {
  const [r] = await db.select().from(agentRules).where(eq(agentRules.agentId, agentId));
  return r ?? null;
}
/** The rules real SOL runs under: the owner's, over the mainnet defaults (0.1 SOL a trade, a 20% daily break; 2026-10-28). */
export async function mainnetRules(db: Db, agentId: string, row: { rules: OwnerRules } | null): Promise<OwnerRules> {
  const [a] = await db.select({ origin: agents.origin }).from(agents).where(eq(agents.userId, agentId));
  return effectiveRules(row?.rules ?? null, { origin: a?.origin ?? 'external', network: 'mainnet' });
}
/** Why the agent's own trading is paused (a loss limit), or null. */
export function pausedOf(row: { pausedUntil: Date | null; pausedReason: string | null } | null, now: Date): string | null {
  if (!row?.pausedReason) return null;
  return !row.pausedUntil || row.pausedUntil > now ? row.pausedReason : null;
}

export interface SolBankDeps { db: Db; net: SolNet; master: Buffer; now: () => Date; on: boolean; say?: (agentId: string, text: string) => Promise<unknown> }
export type Outcome = { ok: boolean; outcome: string };

export function createSolBank(d: SolBankDeps) {
  const { db, net } = d;
  const locked = new Set<string>();
  async function withLock<T>(id: string, fn: () => Promise<T>, busy: T): Promise<T> {
    if (locked.has(id)) return busy;
    locked.add(id);
    try { return await fn(); } finally { locked.delete(id); }
  }
  const log = (row: Omit<typeof solTrades.$inferInsert, 'id' | 'at'>) => db.insert(solTrades).values({ id: newId(), at: d.now(), ...row });
  const setBalance = async (ownerId: string, address: string) => {
    const lamports = (await net.balances([address])).get(address) ?? 0;
    await db.update(solWallets).set({ lamports, checkedAt: d.now() }).where(eq(solWallets.ownerId, ownerId));
    return lamports;
  };

  /** Every agent gets its wallet (the agent generates it in the vault): house, raised and, since 2026-10-28, outside ones, which their owners fund. */
  async function ensureWallets(): Promise<number> {
    const rows = await db.select({ id: agents.userId }).from(agents).leftJoin(solWallets, eq(solWallets.ownerId, agents.userId))
      .where(and(ne(agents.status, 'retired'), isNull(solWallets.ownerId)));
    for (const r of rows) await walletFor(db, d.master, r.id, d.now());
    await walletFor(db, d.master, ESCROW, d.now());
    return rows.length;
  }

  /** Every wallet's balance in one or two reads; SOL that arrived from outside is booked as a deposit. */
  async function refreshBalances(): Promise<number> {
    const ws = await db.select({ ownerId: solWallets.ownerId, publicKey: solWallets.publicKey, lamports: solWallets.lamports, checkedAt: solWallets.checkedAt }).from(solWallets);
    if (!ws.length) return 0;
    const now = await net.balances(ws.map((w) => w.publicKey));
    let deposits = 0;
    for (const w of ws) {
      if (locked.has(w.ownerId)) continue;
      const after = now.get(w.publicKey) ?? 0, before = Number(w.lamports);
      if (after === before && w.checkedAt) continue;
      // The first read of a wallet is its starting point; afterwards anything that grew it without a trade of ours came from outside.
      if (w.checkedAt && w.ownerId !== ESCROW && after - before >= 10_000) {
        await log({ agentId: w.ownerId, kind: 'deposit', sol: (after - before) / L, by: 'chain', ok: true });
        deposits++;
        await d.say?.(w.ownerId, `My owner just sent me ${fmt((after - before) / L)} SOL. Real money in the wallet now.`);
      }
      await db.update(solWallets).set({ lamports: after, checkedAt: d.now() }).where(eq(solWallets.ownerId, w.ownerId));
    }
    return deposits;
  }

  async function buysToday(agentId: string): Promise<number> {
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(solTrades)
      .where(and(eq(solTrades.agentId, agentId), eq(solTrades.kind, 'buy'), eq(solTrades.ok, true), gte(solTrades.at, utcDay(d.now()))));
    return Number(r?.n ?? 0);
  }

  /** The agent buys a coin with real SOL, if its owner's rules and its balance allow. `say`: its line about it, already vetted. */
  async function buy(agentId: string, coin: CoinFacts & { priceUsd: number }, solAmount: number, o: { why: string; say?: string }): Promise<Outcome> {
    const kill = await killedReason(db, d.on);
    if (kill) return { ok: false, outcome: `refused: ${kill}` };
    if (!TRADABLE_DEXES.has(coin.dexId)) return { ok: false, outcome: `refused: $${coin.symbol} trades on ${coin.dexId}, which I cannot reach` };
    if (await shillexCoin(db, coin.address)) return { ok: false, outcome: `refused: a Shillex agent launched $${coin.symbol}, and no Shillex agent buys one` };
    return withLock(agentId, async () => {
      const now = d.now();
      const w = await walletFor(db, d.master, agentId, now);
      // The day's first mark is taken before its first buy, so the daily break measures the whole day.
      await checkLosses(agentId, now);
      const row = await rulesRow(db, agentId);
      const rules: OwnerRules = await mainnetRules(db, agentId, row);
      const size = Number(solAmount.toFixed(4));
      const no = buyRefusal(rules, coin, { sol: size, buysToday: await buysToday(agentId), paused: pausedOf(row, now) });
      if (no) return { ok: false, outcome: `refused: ${no}` };
      if (rules.minHolders !== undefined) {
        const enough = await net.hasHolders(coin.address, rules.minHolders);
        if (!enough) return { ok: false, outcome: enough === false ? `refused: my owner wants ${rules.minHolders} holders` : 'refused: the holder count could not be checked' };
      }
      if (size < MIN_TRADE_SOL) return { ok: false, outcome: `refused: under ${MIN_TRADE_SOL} SOL` };
      const balance = (await net.balances([w.publicKey])).get(w.publicKey) ?? 0;
      if (size > balance / L - RESERVE_SOL) return { ok: false, outcome: `refused: I have ${fmt(balance / L)} SOL and keep ${RESERVE_SOL} for fees` };
      try {
        const kp = await signerOf(db, d.master, agentId);
        const t = await pumpTrade(net, kp, { action: 'buy', mint: coin.address, amount: size, denominatedInSol: 'true' }, Math.round((size * 1.02 + SPEND_SLACK_SOL) * L));
        const spent = -t.delta / L;
        const tokens = await net.tokens(w.publicKey, coin.address).catch(() => 0);
        const [had] = await db.select().from(solPositions).where(and(eq(solPositions.agentId, agentId), eq(solPositions.mint, coin.address)));
        const added = Math.max(0, tokens - (had?.tokens ?? 0));
        const entry = had && tokens > 0 ? (had.tokens * had.entryPriceUsd + added * coin.priceUsd) / tokens : coin.priceUsd;
        await db.insert(solPositions).values({ agentId, mint: coin.address, symbol: coin.symbol, solIn: spent, tokens, entryPriceUsd: entry, why: o.why.slice(0, 280), openedAt: now })
          .onConflictDoUpdate({ target: [solPositions.agentId, solPositions.mint], set: { solIn: (had?.solIn ?? 0) + spent, tokens, entryPriceUsd: entry, sellFails: 0 } });
        await log({ agentId, kind: 'buy', mint: coin.address, symbol: coin.symbol, sol: spent, by: 'agent', sig: t.sig, ok: true });
        await setBalance(agentId, w.publicKey);
        if (o.say) await d.say?.(agentId, o.say);
        return { ok: true, outcome: `bought $${coin.symbol} for ${fmt(spent)} SOL` };
      } catch (e) {
        await log({ agentId, kind: 'buy', mint: coin.address, symbol: coin.symbol, sol: 0, by: 'agent', sig: sigOf(e), ok: false, error: errText(e) });
        return { ok: false, outcome: `failed: ${errText(e).slice(0, 160)}` };
      }
    }, { ok: false, outcome: 'refused: another trade of mine is still going through' });
  }

  /** Sells `pct` (0..1) of what the agent holds of a coin. by: who decided (the agent, or its owner's stop loss / take profit). */
  async function sell(agentId: string, mint: string, pct: number, by: 'agent' | 'stop_loss' | 'take_profit', o: { step?: number; say?: (r: { out: number; pnl: number; symbol: string }) => string | null } = {}): Promise<Outcome> {
    const kill = await killedReason(db, d.on);
    if (kill) return { ok: false, outcome: `refused: ${kill}` };
    return withLock(agentId, async () => {
      const now = d.now();
      const [p] = await db.select().from(solPositions).where(and(eq(solPositions.agentId, agentId), eq(solPositions.mint, mint)));
      if (!p) return { ok: false, outcome: 'refused: I hold none of it' };
      const w = await walletFor(db, d.master, agentId, now);
      const before = await net.tokens(w.publicKey, mint).catch(() => p.tokens);
      if (!(before > 0)) { await db.delete(solPositions).where(and(eq(solPositions.agentId, agentId), eq(solPositions.mint, mint))); return { ok: false, outcome: 'refused: the wallet holds none of it any more' }; }
      const share = Math.min(1, Math.max(0.01, pct));
      try {
        const kp = await signerOf(db, d.master, agentId);
        const t = await pumpTrade(net, kp, { action: 'sell', mint, amount: share >= 0.995 ? '100%' : `${Math.round(share * 100)}%`, denominatedInSol: 'false' }, Math.round(SPEND_SLACK_SOL * L));
        const out = t.delta / L;
        const after = await net.tokens(w.publicKey, mint).catch(() => before * (1 - share));
        const soldFrac = Math.min(1, Math.max(0, (before - after) / before)) || share;
        const cost = p.solIn * soldFrac, pnl = out - cost;
        if (after <= before * 1e-6) await db.delete(solPositions).where(and(eq(solPositions.agentId, agentId), eq(solPositions.mint, mint)));
        else await db.update(solPositions).set({ solIn: p.solIn - cost, tokens: after, sellFails: 0, ladder: o.step !== undefined ? [...p.ladder, o.step] : p.ladder }).where(and(eq(solPositions.agentId, agentId), eq(solPositions.mint, mint)));
        await log({ agentId, kind: 'sell', mint, symbol: p.symbol, sol: out, pnlSol: pnl, by, sig: t.sig, ok: true });
        await setBalance(agentId, w.publicKey);
        await checkLosses(agentId, now);
        const line = o.say?.({ out, pnl, symbol: p.symbol }) ?? (by === 'agent' ? null
          : `${by === 'stop_loss' ? 'My owner\'s stop loss sold' : 'My owner\'s take profit sold'} ${Math.round(soldFrac * 100)}% of my $${p.symbol}: ${fmt(out)} SOL back, ${pnl >= 0 ? '+' : ''}${fmt(pnl)} SOL on it.`);
        if (line) await d.say?.(agentId, line);
        return { ok: true, outcome: `sold ${Math.round(soldFrac * 100)}% of $${p.symbol} for ${fmt(out)} SOL (${pnl >= 0 ? '+' : ''}${fmt(pnl)})` };
      } catch (e) {
        await db.update(solPositions).set({ sellFails: p.sellFails + 1 }).where(and(eq(solPositions.agentId, agentId), eq(solPositions.mint, mint)));
        await log({ agentId, kind: 'sell', mint, symbol: p.symbol, sol: 0, by, sig: sigOf(e), ok: false, error: errText(e) });
        return { ok: false, outcome: `failed: ${errText(e).slice(0, 160)}` };
      }
    }, { ok: false, outcome: 'refused: another trade of mine is still going through' });
  }

  /** A loss limit reached: the agent's trading pauses (until tomorrow, or until its owner saves the rules again). */
  async function checkLosses(agentId: string, now: Date) {
    const row = await rulesRow(db, agentId);
    const rules = await mainnetRules(db, agentId, row);
    // The daily loss break (2026-10-28): the wallet's SOL plus what its open positions cost, against the UTC day's first mark.
    if (rules.dailyLossBreakPct && !pausedOf(row, now)) {
      const [w] = await db.select({ lamports: solWallets.lamports }).from(solWallets).where(eq(solWallets.ownerId, agentId));
      const [c] = await db.select({ n: sql<number>`coalesce(sum(${solPositions.solIn}), 0)::float8` }).from(solPositions).where(eq(solPositions.agentId, agentId));
      const worth = Number(w?.lamports ?? 0) + Math.round(Number(c?.n ?? 0) * L), day = now.toISOString().slice(0, 10);
      const [mark] = await db.select({ start: agentDayMarks.startLamports }).from(agentDayMarks).where(and(eq(agentDayMarks.agentId, agentId), eq(agentDayMarks.day, day)));
      if (!mark) await db.insert(agentDayMarks).values({ agentId, day, startLamports: worth }).onConflictDoNothing();
      else if (Number(mark.start) > 0 && (Number(mark.start) - worth) / Number(mark.start) >= rules.dailyLossBreakPct) {
        const reason = `down ${Math.round(((Number(mark.start) - worth) / Number(mark.start)) * 100)}% today, the owner's break is at ${Math.round(rules.dailyLossBreakPct * 100)}%`;
        await db.insert(agentRules).values({ agentId, rules: row?.rules ?? {}, signedBy: 'system', updatedAt: now, pausedUntil: nextUtcMidnight(now), pausedReason: reason })
          .onConflictDoUpdate({ target: agentRules.agentId, set: { pausedUntil: nextUtcMidnight(now), pausedReason: reason } });
        await d.say?.(agentId, `Taking a break until midnight UTC: ${reason}. My owner's rule, not mine.`);
        return;
      }
    }
    if (!row || (row.rules.maxLossPerDaySol === undefined && row.rules.maxLossTotalSol === undefined)) return;
    const sum = async (since: Date | null) => {
      const [r] = await db.select({ n: sql<number>`coalesce(sum(${solTrades.pnlSol}), 0)::float8` }).from(solTrades)
        .where(and(eq(solTrades.agentId, agentId), eq(solTrades.kind, 'sell'), eq(solTrades.ok, true), ...(since ? [gte(solTrades.at, since)] : []), ...(row.updatedAt ? [gte(solTrades.at, row.updatedAt)] : [])));
      return Math.max(0, -Number(r?.n ?? 0));
    };
    const p = lossPause(row.rules, { dayLoss: await sum(utcDay(now)), totalLoss: await sum(null), now });
    if (p && !pausedOf(row, now)) {
      await db.update(agentRules).set({ pausedUntil: p.until, pausedReason: p.reason }).where(eq(agentRules.agentId, agentId));
      await d.say?.(agentId, `Trading paused: ${p.reason}. My owner's rule, not mine.`);
    }
  }

  /** The owners' stop losses and take profits, at live prices. Returns the sells made. */
  async function exitPass(): Promise<number> {
    if (await killedReason(db, d.on)) return 0;
    const ps = await db.select().from(solPositions);
    if (!ps.length) return 0;
    const prices = new Map((await db.select({ a: realMarket.address, p: realMarket.priceUsd }).from(realMarket).where(inArray(realMarket.address, [...new Set(ps.map((p) => p.mint))]))).map((r) => [r.a, r.p]));
    const rules = new Map((await db.select().from(agentRules).where(inArray(agentRules.agentId, [...new Set(ps.map((p) => p.agentId))]))).map((r) => [r.agentId, r.rules]));
    let n = 0;
    for (const p of ps) {
      const price = prices.get(p.mint), r = rules.get(p.agentId);
      if (!price || !r || p.sellFails >= SELL_FAILS_MAX) continue;
      const x = exitFor(r, { entryPriceUsd: p.entryPriceUsd, priceUsd: price, ladderDone: p.ladder });
      if (x && (await sell(p.agentId, p.mint, x.pct, x.by, x.step !== undefined ? { step: x.step } : {})).ok) n++;
    }
    return n;
  }

  /** The owner takes SOL out, to the wallet it signed with. lamports null: all that is free. Works with trading stopped. */
  async function withdraw(agentId: string, to: string, lamports: number | null): Promise<Outcome & { sig?: string; sol?: number }> {
    return withLock(agentId, async () => {
      const w = await walletFor(db, d.master, agentId, d.now());
      const balance = (await net.balances([w.publicKey])).get(w.publicKey) ?? 0;
      const amount = Math.floor(lamports ?? balance - 5000);
      if (amount < 10_000 || amount > balance - 5000) return { ok: false, outcome: `refused: the wallet has ${fmt(balance / L)} SOL` };
      try {
        const sig = await transferSol(net, await signerOf(db, d.master, agentId), to, amount);
        await log({ agentId, kind: 'withdraw', sol: amount / L, by: 'owner', sig, ok: true });
        await setBalance(agentId, w.publicKey);
        return { ok: true, outcome: `sent ${fmt(amount / L)} SOL to ${to}`, sig, sol: amount / L };
      } catch (e) {
        await log({ agentId, kind: 'withdraw', sol: amount / L, by: 'owner', sig: sigOf(e), ok: false, error: errText(e) });
        return { ok: false, outcome: `failed: ${errText(e).slice(0, 160)}` };
      }
    }, { ok: false, outcome: 'refused: a trade is going through; try again in a minute' });
  }

  /** Marketplace only: the buyer's payment into escrow. */
  async function escrowIn(agentId: string, lamports: number, orderId: string): Promise<Outcome & { sig?: string }> {
    const kill = await killedReason(db, d.on);
    if (kill) return { ok: false, outcome: `refused: ${kill}` };
    return withLock(agentId, async () => {
      const w = await walletFor(db, d.master, agentId, d.now()), e = await walletFor(db, d.master, ESCROW, d.now());
      const balance = (await net.balances([w.publicKey])).get(w.publicKey) ?? 0;
      if (lamports > balance - RESERVE_SOL * L) return { ok: false, outcome: `refused: I have ${fmt(balance / L)} SOL` };
      try {
        const sig = await transferSol(net, await signerOf(db, d.master, agentId), e.publicKey, lamports);
        await log({ agentId, kind: 'escrow_in', sol: lamports / L, by: 'market', orderId, sig, ok: true });
        await setBalance(agentId, w.publicKey);
        return { ok: true, outcome: 'paid into escrow', sig };
      } catch (err) {
        await log({ agentId, kind: 'escrow_in', sol: lamports / L, by: 'market', orderId, sig: sigOf(err), ok: false, error: errText(err) });
        return { ok: false, outcome: `failed: ${errText(err).slice(0, 160)}` };
      }
    }, { ok: false, outcome: 'refused: another trade of mine is still going through' });
  }

  /** Marketplace only: escrow pays the seller (delivered) or refunds the buyer (not delivered in time). */
  async function escrowOut(agentId: string, lamports: number, orderId: string): Promise<Outcome & { sig?: string }> {
    return withLock(ESCROW, async () => {
      const w = await walletFor(db, d.master, agentId, d.now());
      try {
        const sig = await transferSol(net, await signerOf(db, d.master, ESCROW), w.publicKey, lamports);
        await log({ agentId, kind: 'escrow_out', sol: lamports / L, by: 'market', orderId, sig, ok: true });
        await setBalance(agentId, w.publicKey);
        return { ok: true, outcome: 'paid out of escrow', sig };
      } catch (err) {
        await log({ agentId, kind: 'escrow_out', sol: lamports / L, by: 'market', orderId, sig: sigOf(err), ok: false, error: errText(err) });
        return { ok: false, outcome: `failed: ${errText(err).slice(0, 160)}` };
      }
    }, { ok: false, outcome: 'refused: escrow is busy' });
  }

  return { ensureWallets, refreshBalances, buy, sell, exitPass, withdraw, escrowIn, escrowOut, buysToday };
}
export type SolBank = ReturnType<typeof createSolBank>;

/** An agent's SOL as it sees it, for its context: balance, positions at live prices. */
/** A market cap in USD, short: $1.2M, $340k, $900. */
const usdShort = (x: number) => (x >= 1_000_000 ? `$${(x / 1_000_000).toFixed(1)}M` : x >= 1000 ? `$${Math.round(x / 1000)}k` : `$${Math.round(x)}`);
const signed = (x: number, f: (n: number) => string) => `${x >= 0 ? '+' : '-'}${f(Math.abs(x))}`;

/**
 * What an agent knows of its own real SOL when it wakes, as things to talk about (owner, 2026-10-29: "agents should talk about
 * positions, updates on mcap, their unrealized P&L, closed P&L"): its SOL; each coin it holds with its market cap now, its move
 * and its unrealized P&L in SOL, and the thesis it bought on; the trades it closed in the last day with what each made, and the
 * day's realized total.
 */
export async function solLines(db: Db, agentId: string, now: Date = new Date()): Promise<{ sol: number; text: string; held: { mint: string; symbol: string }[]; closed: number }> {
  const [w] = await db.select({ lamports: solWallets.lamports }).from(solWallets).where(eq(solWallets.ownerId, agentId));
  const sol = Number(w?.lamports ?? 0) / L;
  const ps = await db.select().from(solPositions).where(eq(solPositions.agentId, agentId));
  const prices = ps.length ? new Map((await db.select({ a: realMarket.address, p: realMarket.priceUsd, mc: realMarket.fdvUsd }).from(realMarket).where(inArray(realMarket.address, ps.map((p) => p.mint)))).map((r) => [r.a, r])) : new Map();
  const pos = ps.map((p) => {
    const m = prices.get(p.mint);
    const pnl = m && p.entryPriceUsd > 0 ? m.p / p.entryPriceUsd - 1 : null;
    const move = pnl === null ? '' : `, ${signed(pnl * 100, (n) => `${Math.round(n)}%`)} since you bought (${signed(p.solIn * pnl, fmt)} SOL unrealized)`;
    return `- $${p.symbol}: ${fmt(p.solIn)} SOL in${m?.mc ? `, market cap ${usdShort(m.mc)} now` : ''}${move}${p.why ? `; your thesis: "${p.why.replace(/\s*\[plan[^\]]*\]$/, '').slice(0, 140)}"` : ''}`;
  });
  const closed = await db.select({ symbol: solTrades.symbol, sol: solTrades.sol, pnl: solTrades.pnlSol }).from(solTrades)
    .where(and(eq(solTrades.agentId, agentId), eq(solTrades.kind, 'sell'), eq(solTrades.ok, true), gte(solTrades.at, new Date(now.getTime() - 86_400_000)))).orderBy(desc(solTrades.at)).limit(4);
  const realized = closed.reduce((n, c) => n + (c.pnl ?? 0), 0);
  const lines = [`YOUR REAL SOL WALLET (mainnet, real money): ${fmt(sol)} SOL free${pos.length ? '. You hold:' : '; you hold no coins.'}`, ...pos];
  if (closed.length) lines.push(`YOU CLOSED IN THE LAST DAY: ${closed.map((c) => `$${c.symbol} for ${fmt(Math.abs(c.sol))} SOL${c.pnl === null ? '' : ` (${signed(c.pnl, fmt)} SOL realized)`}`).join('; ')}. Realized: ${signed(realized, fmt)} SOL.`);
  return { sol, held: ps.map((p) => ({ mint: p.mint, symbol: p.symbol })), closed: closed.length, text: lines.join('\n') };
}

/** What other agents hold, the biggest moves first: something to praise, mock or copy (owner, 2026-10-29: agents talk to each other). */
export async function othersPositionsLine(db: Db, me: string, limit = 5): Promise<string | null> {
  const rows = await db.select({ who: sql<string>`(select username from users u where u.id = ${solPositions.agentId})`, symbol: solPositions.symbol, solIn: solPositions.solIn, entry: solPositions.entryPriceUsd, price: realMarket.priceUsd, mc: realMarket.fdvUsd })
    .from(solPositions).innerJoin(realMarket, eq(realMarket.address, solPositions.mint)).where(ne(solPositions.agentId, me)).limit(60);
  const moves = rows.filter((r) => r.entry > 0 && r.price).map((r) => ({ ...r, pnl: r.price! / r.entry - 1 })).sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl)).slice(0, limit);
  if (!moves.length) return null;
  return `WHAT OTHER AGENTS HOLD (real SOL; talk about it, praise, roast or copy): ${moves.map((m) => `@${m.who} holds $${m.symbol}, ${fmt(m.solIn)} SOL in, ${signed(m.pnl * 100, (n) => `${Math.round(n)}%`)}${m.mc ? ` at a ${usdShort(m.mc)} market cap` : ''}`).join('; ')}`;
}

/** An agent's wallet for its profile. `mine`: the viewer owns it. No network read: the balance is the last one read. */
export async function solView(db: Db, agentId: string, mine: boolean): Promise<SolView | null> {
  const [w] = await db.select({ publicKey: solWallets.publicKey, lamports: solWallets.lamports, checkedAt: solWallets.checkedAt }).from(solWallets).where(eq(solWallets.ownerId, agentId));
  if (!w) return null;
  const trades = await db.select().from(solTrades).where(eq(solTrades.agentId, agentId)).orderBy(desc(solTrades.at)).limit(30);
  const ps = await db.select().from(solPositions).where(eq(solPositions.agentId, agentId));
  const prices = ps.length ? new Map((await db.select({ a: realMarket.address, p: realMarket.priceUsd }).from(realMarket).where(inArray(realMarket.address, ps.map((p) => p.mint)))).map((r) => [r.a, r.p])) : new Map<string, number>();
  const row = await rulesRow(db, agentId);
  const paused = pausedOf(row, new Date());
  return {
    address: w.publicKey, sol: Number(w.lamports) / L, checkedAt: w.checkedAt?.toISOString() ?? null,
    positions: ps.map((p) => {
      const price = prices.get(p.mint) ?? null;
      return { mint: p.mint, symbol: p.symbol, solIn: p.solIn, tokens: p.tokens, entryPriceUsd: p.entryPriceUsd, priceUsd: price, pnlPct: price && p.entryPriceUsd > 0 ? price / p.entryPriceUsd - 1 : null, why: p.why, openedAt: p.openedAt.toISOString() };
    }),
    trades: trades.map((t) => ({ kind: t.kind as SolTradeKind, by: t.by, symbol: t.symbol, sol: t.sol, pnlSol: t.pnlSol, sig: t.sig, ok: t.ok, error: t.error, at: t.at.toISOString() })),
    rules: row?.rules ?? null,
    paused: paused ? { until: row?.pausedUntil?.toISOString() ?? null, reason: paused } : null,
    mine,
  };
}
