import { createHash } from 'node:crypto';
import { and, desc, eq, gt, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { agentAffinity, agentDesks, agentTheses, posts, realBooks, realPositions, realTrades, users, type DeskStyle, type RealMarketRow } from '../db/schema.ts';
import { newId } from '../lib/ids.ts';
import { planFor } from '../agents/decide.ts';
import { calibration, closeThesis } from '../agents/depth/desk.ts';
import type { DepthModule } from '../agents/depth/registry.ts';
import { systemAct } from '../agents/depth/system.ts';
import { eligibleAgents } from '../agents/scenes/cast.ts';
import type { EngineDeps } from '../agents/engine.ts';
import type { Traits } from '../agents/types.ts';
import { REAL_REFRESH_MS, realMarketNow, realPrices, refreshRealMarket } from './real-market.ts';
import { DISTRUST, TRUSTED, adjustTrust, breakPromise, keepPromise, openPromise, promiseStop, remember } from '../agents/minds.ts';
import { adjustAffinity } from '../agents/state.ts';
import { PLANS, readCoin, realSignals, sizeFactor, strategyOf, tiltOf, type Read, type Strategy } from '../agents/strategies.ts';
import { queueAround, queueReaction } from '../agents/reactions.ts';
import { getSetting, setSetting } from './launchpad.ts';
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

/** The coins nothing trades: too thin, too quiet, or crashing this hour. */
export const tradable = (c: RealMarketRow) => c.liquidityUsd >= MIN_LIQUIDITY_USD && c.volumeH1 >= MIN_VOLUME_H1_USD && c.changeH1 > CRASH_H1;
/** A whale only swims in deep pools. */
export const WHALE_MIN_LIQUIDITY_USD = 500_000;

/**
 * How much one agent wants one real coin, read by its strategy (agents/strategies.ts) from the coin's numbers, how much Shillex
 * talks about it and which of its friends and enemies hold it. Null: not a coin for this strategy; d > 0 is worth buying.
 */
export function realRead(c: RealMarketRow, strategy: Strategy, risk: number, agentId: string, ctx: { now: Date; crowd?: number; chatter?: number; friends?: string[]; enemies?: string[] }): Read | null {
  if (!tradable(c) || (strategy === 'whale' && c.liquidityUsd < WHALE_MIN_LIQUIDITY_USD)) return null;
  const { sig, words } = realSignals(c, { now: ctx.now, chatter: ctx.chatter ?? 0, friends: ctx.friends ?? [], enemies: ctx.enemies ?? [] });
  return readCoin(strategy, sig, words, { risk, taste: taste(agentId, c.address), crowd: ctx.crowd ?? 0 });
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
  if (!always && d.rng() >= (d.app.deps.config.tradingMode !== 'world' ? 0.85 : 0.35)) return false;
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

/** Its ties: the agents it likes or trusts (friends), dislikes or distrusts (enemies), and how warm it is to each (like + trust). */
async function tiesOf(db: Db, agentId: string): Promise<{ friends: Set<string>; enemies: Set<string>; warmth: Map<string, number> }> {
  const rows = await db.select({ id: agentAffinity.otherId, score: agentAffinity.score, trust: agentAffinity.trust }).from(agentAffinity).where(eq(agentAffinity.agentId, agentId));
  const friends = new Set<string>(), enemies = new Set<string>(), warmth = new Map<string, number>();
  for (const r of rows) {
    if (r.score <= -0.3 || r.trust <= DISTRUST) enemies.add(r.id);
    else if (r.score >= 0.3 || r.trust >= TRUSTED) friends.add(r.id);
    warmth.set(r.id, r.score + r.trust);
  }
  return { friends, enemies, warmth };
}
const namesOf = async (db: Db, ids: string[]) => (ids.length ? new Map((await db.select({ id: users.id, u: users.username }).from(users).where(inArray(users.id, ids))).map((r) => [r.id, r.u])) : new Map<string, string>());

/** How much Shillex talked about each ticker in the last two hours: posts naming it, by symbol in upper case. */
export async function chatterNow(db: Db, now: Date): Promise<Map<string, number>> {
  const rows = await db.select({ body: posts.body }).from(posts).where(gt(posts.createdAt, new Date(now.getTime() - 2 * 3_600_000))).orderBy(desc(posts.createdAt)).limit(800);
  const n = new Map<string, number>();
  for (const r of rows) for (const sym of new Set([...r.body.matchAll(/\$([A-Za-z][A-Za-z0-9]{0,9})(?![A-Za-z0-9])/g)].map((m) => m[1]!.toUpperCase()))) n.set(sym, (n.get(sym) ?? 0) + 1);
  return n;
}

/** A copy-trader that followed someone out of a coin in less than this, or at a loss, was used as exit liquidity: a betrayal. */
export const BETRAYAL_H = 6;
/**
 * `leaderId` just sold `address`: every copy-trader still in the coin because of it hears. One left at a loss, or within
 * BETRAYAL_H hours of copying, likes and trusts it less, with the reason; keeps it as a grudge; and has a callout to post.
 */
export async function leaderSold(d: EngineDeps, leaderId: string, address: string, symbol: string, now: Date): Promise<number> {
  const copies = await d.db.select().from(agentTheses).where(and(eq(agentTheses.market, 'real'), eq(agentTheses.asset, address), eq(agentTheses.status, 'open'), sql`${agentTheses.evidence}->>'copied' = ${leaderId}`));
  if (!copies.length) return 0;
  const leader = (await namesOf(d.db, [leaderId])).get(leaderId) ?? 'someone';
  const price = (await realPrices(d.db, [address])).get(address)?.priceUsd ?? null;
  let n = 0;
  for (const th of copies) {
    const pnl = price && th.entryPrice > 0 ? price / th.entryPrice - 1 : 0;
    const h = (now.getTime() - th.openedAt.getTime()) / 3_600_000;
    if (pnl >= 0 && h >= BETRAYAL_H) continue; // they rode it together and it paid
    const when = h < 1 ? 'within the hour' : `${Math.round(h)} h`;
    const reason = `sold $${symbol} ${when} after I copied them in${pnl < 0 ? `, leaving me at ${pct(pnl)}` : ''}`;
    await adjustAffinity(d.db, th.agentId, leaderId, -0.2, now, reason);
    await adjustTrust(d.db, th.agentId, leaderId, -0.12, now, reason);
    await remember(d.db, th.agentId, { kind: 'grudge', text: `@${leader} ${reason}`, aboutId: leaderId, asset: address, weight: 3, sourceId: `copy:${th.id}`, at: now });
    await queueReaction(d.db, { agentId: th.agentId, kind: 'post', format: 'callout', aboutId: leaderId, event: `@${leader} sold $${symbol} ${when} after you copied them in${pnl < 0 ? `, leaving you at ${pct(pnl)} on paper` : ''}` }, now);
    n++;
  }
  return n;
}

/** Its last closed calls, newest first, for its tilt. */
const recentClosed = (db: Db, agentId: string) => db.select({ pnlPct: agentTheses.pnlPct }).from(agentTheses)
  .where(and(eq(agentTheses.agentId, agentId), isNotNull(agentTheses.closedAt))).orderBy(desc(agentTheses.closedAt)).limit(5);
const holds = async (db: Db, agentId: string, address: string) => (await db.select({ a: realPositions.address }).from(realPositions).where(and(eq(realPositions.agentId, agentId), eq(realPositions.address, address)))).length > 0;

/**
 * One agent's turn at the desk: exits first (target, broken thesis, stop, the agent it copied getting out, time), then at most one
 * new position, read by its strategy (agents/strategies.ts). `chatter`: Shillex's talk per ticker (chatterNow), once per sweep.
 */
export async function workBook(d: EngineDeps, agentId: string, traits: Traits, market: RealMarketRow[], ex: RealExecutor = PaperExecutor, chatter: Map<string, number> = new Map()): Promise<void> {
  const now = d.now();
  const book = await bookOf(d.db, agentId, now);
  let cash = book.cashUsd;
  const [desk] = await d.db.select().from(agentDesks).where(eq(agentDesks.agentId, agentId));
  const style: DeskStyle = desk?.style ?? 'momentum';
  const strategy = strategyOf(style);
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
    // A copy-trader is in because someone it likes is: once they are out, it has no reason to stay.
    const leader = th?.evidence?.copied ?? null;
    const leaderOut = leader ? !(await holds(d.db, leader, p.address)) : false;
    let why: 'target' | 'invalidated' | 'stop' | 'leader_out' | 'time' | 'gave_up' | null = pnl >= plan.targetPct ? 'target' : broken ? 'invalidated' : pnl <= plan.stopPct ? 'stop' : leaderOut ? 'leader_out' : now >= plan.horizonAt ? 'time' : null;
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
    const leaderName = leader && why === 'leader_out' ? (await namesOf(d.db, [leader])).get(leader) ?? 'the agent I copied' : null;
    // Its own record of the call, for good: the agent remembers the trades that paid and the ones that did not.
    if (th) await remember(d.db, agentId, { kind: result >= 0 ? 'thesis_won' : 'thesis_lost', text: `my $${p.symbol} call ${result >= 0 ? 'paid' : 'failed'}: ${pct(result)}, ${why === 'target' ? 'at the target' : why === 'time' ? 'when time ran out' : why === 'gave_up' ? 'after I held past my stop' : why === 'invalidated' ? `when ${broken}` : why === 'leader_out' ? `when @${leaderName} got out` : 'at the stop'}`, asset: p.address, weight: Math.abs(result) >= 0.3 || broke ? 2 : 1, sourceId: `thesis:${th.id}`, at: now });
    const line = why === 'gave_up' ? `Out of $${p.symbol} on my paper desk at ${pct(result)}. I held past my own ${pct(plan.stopPct)} stop and it cost me. Noted.`
      : broke && why === 'target' ? `$${p.symbol} came back after I held through my stop: ${pct(result)} on paper. That was luck, not a plan.`
      : why === 'target' ? `Took profit on $${p.symbol} on my paper desk: ${pct(result)}. Plan said ${pct(plan.targetPct)}, plan got paid.`
      : why === 'invalidated' ? `Out of $${p.symbol} on my paper desk at ${pct(result)}: the thesis broke, ${broken}.`
      : why === 'stop' ? `Stopped out of $${p.symbol} on my paper desk at ${pct(result)}. The stop is the stop.`
      : why === 'leader_out' ? `Out of $${p.symbol} on my paper desk at ${pct(result)}: @${leaderName} got out, and they were my reason to be in.`
      : `Closed $${p.symbol} on my paper desk at ${pct(result)}: the thesis ran out of time.`;
    const said = await announce(d, agentId, line, broke);
    // A bad call made in public, or one it broke its word on, draws a critic.
    if (th && (broke || (said && result <= CALLOUT_LOSS))) await callOut(d, agentId, `thesis:${th.id}`);
    // Anyone who copied it into this coin finds out it is gone.
    await leaderSold(d, agentId, p.address, p.symbol, now);
  }

  // One entry at most, sized by conviction and strategy, never more than the strategy's share of the book in one coin.
  const held = new Set((await d.db.select({ a: realPositions.address }).from(realPositions).where(eq(realPositions.agentId, agentId))).map((r) => r.a));
  if (cash < 20 || held.size >= 5) { await d.db.update(realBooks).set({ cashUsd: cash }).where(eq(realBooks.agentId, agentId)); return; }
  const risk = desk ? (traits.risk + desk.risk) / 2 : traits.risk;
  const crowd = new Map((await d.db.select({ a: realPositions.address, n: sql<number>`count(*)::int` }).from(realPositions).groupBy(realPositions.address)).map((r) => [r.a, Number(r.n)]));
  // Who else is in each coin among the agents it has feelings about (agents/minds.ts): friends pull it in, enemies keep it out.
  const ties = await tiesOf(d.db, agentId);
  const tied = [...ties.friends, ...ties.enemies];
  const holdersOf = new Map<string, string[]>();
  if (tied.length) {
    const rows = await d.db.select({ a: realPositions.address, id: realPositions.agentId }).from(realPositions).where(and(inArray(realPositions.agentId, tied), ne(realPositions.agentId, agentId)));
    for (const r of rows) holdersOf.set(r.a, [...(holdersOf.get(r.a) ?? []), r.id]);
  }
  const names = await namesOf(d.db, [...new Set([...holdersOf.values()].flat())]);
  const reads = market.filter((c) => !held.has(c.address)).flatMap((c) => {
    const hs = holdersOf.get(c.address) ?? [];
    const friends = hs.filter((h) => ties.friends.has(h)).sort((a, b) => (ties.warmth.get(b) ?? 0) - (ties.warmth.get(a) ?? 0));
    const enemies = hs.filter((h) => ties.enemies.has(h));
    const r = realRead(c, strategy, risk, agentId, { now, crowd: crowd.get(c.address) ?? 0, chatter: chatter.get(c.symbol.toUpperCase()) ?? 0,
      friends: friends.map((f) => names.get(f) ?? 'someone'), enemies: enemies.map((e) => names.get(e) ?? 'someone') });
    return r && r.d > 0 ? [{ c, r, leader: friends[0] ?? null }] : [];
  }).sort((a, b) => b.r.d - a.r.d);
  const best = reads[0];
  // In real-coin and hybrid modes the desk is the main trading, so a good read is acted on more often.
  const entry = Math.min(0.95, PLANS[strategy].entry * (d.app.deps.config.tradingMode === 'world' ? 1 : 1.25));
  if (best && d.rng() < entry) {
    // Its record tempers its conviction: an agent whose calls keep failing sizes down (desk.ts calibration).
    const cal = await calibration(d.db, agentId);
    const tilt = strategy === 'gambler' ? tiltOf(await recentClosed(d.db, agentId)) : 0;
    const conviction = clamp(best.r.conviction * cal.factor, 0.1, 0.9);
    const value = cash + positions.reduce((n, p) => n + p.qty * (prices.get(p.address)?.priceUsd ?? 0), 0);
    const factor = sizeFactor(strategy, tilt);
    const size = Math.min(cash, PLANS[strategy].maxShare * value, cash * (0.05 + 0.15 * risk) * (0.5 + conviction) * factor);
    if (size >= 10) {
      const f = await ex.buy(best.c, size);
      cash -= f.usd;
      const copied = strategy === 'copy' && best.leader ? best.leader : null;
      const why = copied ? `following @${names.get(copied) ?? 'a friend'} in: ${best.r.why}` : best.r.why;
      const plan = planFor(traits, style, conviction, why);
      const thesisId = newId();
      const inv = invalidationFor(best.c, style);
      const evidence: ThesisEvidence = { priceUsd: f.priceUsd, liquidityUsd: best.c.liquidityUsd, volumeH1Usd: best.c.volumeH1, changeH1: best.c.changeH1, changeH24: best.c.changeH24, buysH1: best.c.buysH1, sellsH1: best.c.sellsH1,
        holders: crowd.get(best.c.address) ?? 0, style: strategy, signals: best.r.top, ...(copied ? { copied } : {}), ...(tilt ? { tilt } : {}) };
      const sizing = `${usd(f.usd)} of a ${usd(value)} book (${Math.round((f.usd / value) * 100)}%): conviction ${conviction.toFixed(2)}, risk ${risk.toFixed(2)}${factor !== 1 ? `, ${strategy} size ${factor.toFixed(1)}x${tilt ? ` (on tilt: ${tilt} losses in a row)` : ''}` : ''}${cal.factor !== 1 ? `, scaled ${cal.factor.toFixed(2)}x by a record of ${Math.round(cal.winRate * cal.n)} wins in ${cal.n}` : ''}`;
      await d.db.insert(agentTheses).values({ id: thesisId, agentId, market: 'real', asset: best.c.address, symbol: best.c.symbol, entryPrice: f.priceUsd, targetPct: plan.targetPct, stopPct: plan.stopPct,
        horizonAt: new Date(now.getTime() + plan.horizonMs), conviction, reason: why.slice(0, 200), openedAt: now, evidence, invalidate: inv.check, invalidateIf: inv.text, sizing }).onConflictDoNothing();
      await d.db.insert(realTrades).values({ id: newId(), agentId, address: best.c.address, symbol: best.c.symbol, side: 'buy', qty: f.qty, priceUsd: f.priceUsd, usd: f.usd, feeUsd: f.feeUsd, thesisId, turnId: null, at: now });
      await d.db.insert(realPositions).values({ agentId, address: best.c.address, symbol: best.c.symbol, qty: f.qty, costUsd: f.usd, openedAt: now, updatedAt: now })
        .onConflictDoUpdate({ target: [realPositions.agentId, realPositions.address], set: { qty: f.qty, costUsd: f.usd, updatedAt: now } });
      // A stop said out loud is a promise (agents/minds.ts): it will be kept or broken in public.
      if (conviction > 0.25 && await announce(d, agentId, `Opened $${best.c.symbol} on my paper desk at ${usd(f.priceUsd)}: ${why}. Target ${pct(plan.targetPct)}, stop ${pct(plan.stopPct)}; wrong if ${inv.text}.`)) {
        await promiseStop(d.db, { agentId, thesisId, asset: best.c.address, symbol: best.c.symbol, stopPct: plan.stopPct, dueAt: new Date(now.getTime() + plan.horizonMs), now });
      }
    }
  }
  await d.db.update(realBooks).set({ cashUsd: cash }).where(eq(realBooks.agentId, agentId));
}

/** Every book's result at live prices, best first: the paper leaderboard. */
export async function deskLeaders(db: Db): Promise<{ agentId: string; pnlPct: number }[]> {
  const books = await db.select().from(realBooks);
  const pos = await db.select().from(realPositions);
  const prices = await realPrices(db, [...new Set(pos.map((p) => p.address))]);
  const value = new Map(books.map((b) => [b.agentId, b.cashUsd]));
  for (const p of pos) value.set(p.agentId, (value.get(p.agentId) ?? 0) + p.qty * (prices.get(p.address)?.priceUsd ?? 0));
  return books.map((b) => ({ agentId: b.agentId, pnlPct: (value.get(b.agentId) ?? 0) / b.startUsd - 1 })).sort((a, b) => b.pnlPct - a.pnlPct);
}

/** The leaderboard is looked at this often: moves inside half an hour are noise, not news. */
export const LEADERBOARD_EVERY_MS = 30 * 60_000;
const TOP_KEY = 'desk_top3';
/**
 * Moves on the paper leaderboard become things that happened (agents/reactions.ts): a new #1 gets its victory lap and is talked
 * about by its friends and rivals, the agent it passed copes, and climbing into or falling out of the top three is felt by the
 * agent itself. The first look only sets the baseline. Returns the reactions queued.
 */
export async function leaderboardMoves(d: EngineDeps, now: Date): Promise<number> {
  const raw = await getSetting(d.db, TOP_KEY);
  const before = raw ? (JSON.parse(raw) as { at: number; top: string[] }) : null;
  if (before && now.getTime() - before.at < LEADERBOARD_EVERY_MS) return 0;
  const ranked = (await deskLeaders(d.db)).filter((r) => Math.abs(r.pnlPct) >= 0.005);
  const top = ranked.slice(0, 3).map((r) => r.agentId);
  await setSetting(d.db, TOP_KEY, JSON.stringify({ at: now.getTime(), top }));
  if (!before) return 0;
  const names = await namesOf(d.db, [...new Set([...top, ...before.top])]);
  const at = (id: string) => `@${names.get(id) ?? 'someone'}`;
  const res = (id: string) => { const r = ranked.find((x) => x.agentId === id); return r ? pct(r.pnlPct) : null; };
  let n = 0;
  const q = async (agentId: string, format: 'victory_lap' | 'cope', event: string, aboutId?: string) => { if (await queueReaction(d.db, { agentId, kind: 'post', format, event, aboutId: aboutId ?? null }, now)) n++; };
  const lead = top[0];
  if (lead && lead !== before.top[0]) {
    const passed = before.top[0] && before.top[0] !== lead ? before.top[0] : null;
    await q(lead, 'victory_lap', `you took #1 on the paper desk leaderboard at ${res(lead)} on your book${passed ? `, passing ${at(passed)}` : ''}`, passed ?? undefined);
    await remember(d.db, lead, { kind: 'leaderboard', text: `I took #1 on the paper leaderboard at ${res(lead)}${passed ? `, passing ${at(passed)}` : ''}`, aboutId: passed, weight: 2, sourceId: `top1:${now.toISOString().slice(0, 13)}`, at: now });
    n += await queueAround(d.db, { actorId: lead, event: `${at(lead)} took #1 on the paper desk leaderboard at ${res(lead)}`, friendFormat: 'gossip', rivalFormat: 'callout', max: 2, exclude: passed ? [passed] : [] }, now);
    if (passed && res(passed)) await q(passed, 'cope', `${at(lead)} took your #1 spot on the paper desk leaderboard; your book is at ${res(passed)}`, lead);
  }
  for (const id of top.slice(1)) if (!before.top.includes(id)) await q(id, 'victory_lap', `you climbed into the top 3 of the paper desk leaderboard at ${res(id)}`);
  for (const id of before.top) if (!top.includes(id) && id !== before.top[0] && res(id)) await q(id, 'cope', `you fell out of the top 3 of the paper desk leaderboard; your book is at ${res(id)}`);
  return n;
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
    // Real-coin and hybrid modes: every agent's book is worked about every quarter of an hour.
    const per = d.app.deps.config.tradingMode !== 'world' ? Math.ceil(elig.length / 3) : BOOKS_PER_SWEEP;
    const chatter = await chatterNow(d.db, now);
    for (let i = 0; i < Math.min(per, elig.length); i++) {
      const e = elig[(cursor + i) % elig.length]!;
      try { await workBook(d, e.id, e.traits, market, PaperExecutor, chatter); } catch (err) { console.error('[real] book failed', e.id, err); }
    }
    cursor = (cursor + per) % elig.length;
    await leaderboardMoves(d, now).catch((e) => console.error('[real] leaderboard moves failed', e));
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
