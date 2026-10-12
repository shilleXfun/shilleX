import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { COIN_DECIMALS, LAMPORTS_PER_SOL, type AgentCard, type AgentDetail, type CoinView, type PositionView, type TradeView, type UserSummary } from '@shillex/shared';
import type { Db } from '../db/client.ts';
import { agentTurns, agents, chainTxs, users, wallets, worldCoins, type ChainTxRow, type UserRow, type WorldCoinRow } from '../db/schema.ts';
import { toUserSummary } from '../services/users.ts';
import type { Chain, WalletBalances } from './chain.ts';
import { holdersOf, refreshCoinPrice } from './market.ts';
import { chainHead } from './provenance.ts';

const SUPPLY = 1_000_000_000, DAY = 86_400_000, START = 0.1;
const sol = (l: number) => l / LAMPORTS_PER_SOL;
const tok = (raw: number) => raw / 10 ** COIN_DECIMALS;

/** Read models for the viewer: coin stats (dev-sold, rugs, volume), positions, P&L and the leaderboard. */
export class Indexer {
  private balances = new Map<string, { at: number; b: WalletBalances }>();
  private timer: NodeJS.Timeout | null = null;
  private ticks = 0;
  private board: { at: number; value: Promise<AgentCard[]> } | null = null;
  constructor(private db: Db, private chain: Chain, private now: () => Date, private opts: { balanceTtlMs?: number; viewTtlMs?: number } = {}) {}

  start() {
    const loop = async () => {
      try {
        // Every tick: coins traded in the last 10 minutes; every 8th: anything traded today. Quiet coins keep their last price.
        const since = new Date(this.now().getTime() - (this.ticks++ % 8 === 0 ? DAY : 10 * 60_000));
        const mints = (await this.db.selectDistinct({ m: chainTxs.mint }).from(chainTxs).where(and(gte(chainTxs.createdAt, since), inArray(chainTxs.kind, ['buy', 'sell', 'launch'])))).map((r) => r.m!).filter(Boolean);
        for (const m of mints) await refreshCoinPrice(this.db, this.chain, m, this.now());
      } catch (e) { console.error('[world] indexer tick failed', e); }
      this.timer = setTimeout(loop, 15_000);
      this.timer.unref?.();
    };
    void loop();
  }
  stop() { if (this.timer) clearTimeout(this.timer); }
  invalidate(agentId?: string) { if (agentId) this.balances.delete(agentId); else this.balances.clear(); }

  private async balancesOf(userId: string, publicKey: string | null): Promise<WalletBalances | null> {
    const hit = this.balances.get(userId);
    if (hit && this.now().getTime() - hit.at < (this.opts.balanceTtlMs ?? 60_000)) return hit.b;
    if (!publicKey) return null;
    try { const b = await this.chain.balances(publicKey); this.balances.set(userId, { at: this.now().getTime(), b }); return b; }
    catch { return hit?.b ?? null; }
  }

  private async summaries(ids: string[]): Promise<Map<string, UserSummary>> {
    if (!ids.length) return new Map();
    return new Map((await this.db.select().from(users).where(inArray(users.id, [...new Set(ids)]))).map((u) => [u.id, toUserSummary(u)]));
  }

  /** Callers pass only this coin's transactions (see byMint). */
  private coinStats(c: WorldCoinRow, mine: ChainTxRow[]) {
    const creator = mine.filter((t) => t.agentId === c.creatorId);
    const acquired = creator.filter((t) => t.tokenDelta > 0).reduce((n, t) => n + t.tokenDelta, 0);
    const sold = creator.filter((t) => t.kind === 'sell').reduce((n, t) => n - t.tokenDelta, 0);
    const soldEarly = creator.filter((t) => t.kind === 'sell' && t.createdAt.getTime() - c.launchedAt.getTime() <= DAY).reduce((n, t) => n - t.tokenDelta, 0);
    const dayAgo = this.now().getTime() - DAY;
    return {
      devSoldPct: acquired > 0 ? (sold / acquired) * 100 : 0,
      rug: acquired > 0 && soldEarly / acquired >= 0.9,
      volume24hSol: mine.filter((t) => (t.kind === 'buy' || t.kind === 'sell') && t.createdAt.getTime() >= dayAgo).reduce((n, t) => n + Math.abs(sol(t.lamportsDelta)), 0),
    };
  }

  private async views(rows: WorldCoinRow[]): Promise<CoinView[]> {
    if (!rows.length) return [];
    const txs = byMint(await this.db.select().from(chainTxs).where(inArray(chainTxs.mint, rows.map((r) => r.mint))));
    const people = await this.summaries(rows.map((r) => r.creatorId));
    const holders = await holderCounts(this.db, rows.map((r) => r.mint));
    return rows.map((c) => {
      const s = this.coinStats(c, txs.get(c.mint) ?? []);
      const priceSol = c.priceLamports === null ? null : sol(c.priceLamports);
      return {
        mint: c.mint, pool: c.pool, name: c.name, symbol: c.symbol, description: c.description, emoji: c.emoji, creator: people.get(c.creatorId)!,
        launchedAt: c.launchedAt.toISOString(), launchSignature: c.launchSignature, priceSol, marketCapSol: priceSol === null ? null : priceSol * SUPPLY,
        curveProgress: c.curveProgress, holders: holders.get(c.mint) ?? 0, volume24hSol: s.volume24hSol, devSoldPct: s.devSoldPct, graduated: Boolean(c.graduatedAt),
      };
    });
  }

  async coins() { return this.views(await this.db.select().from(worldCoins).orderBy(desc(worldCoins.launchedAt))); }
  async coin(mint: string) { const [c] = await this.db.select().from(worldCoins).where(eq(worldCoins.mint, mint)); return c ? (await this.views([c]))[0]! : null; }

  async trades(f: { mint?: string; agentId?: string; limit?: number }): Promise<TradeView[]> {
    const rows = await this.db.select().from(chainTxs).where(and(f.mint ? eq(chainTxs.mint, f.mint) : undefined, f.agentId ? eq(chainTxs.agentId, f.agentId) : undefined))
      .orderBy(desc(chainTxs.id)).limit(Math.max(1, Math.min(f.limit ?? 50, 200)));
    const people = await this.summaries(rows.map((r) => r.agentId!).filter(Boolean));
    const syms = new Map((await this.db.select({ m: worldCoins.mint, s: worldCoins.symbol }).from(worldCoins)).map((r) => [r.m, r.s]));
    return rows.map((r) => ({ signature: r.signature, agent: r.agentId ? (people.get(r.agentId) ?? null) : null, kind: r.kind, mint: r.mint, symbol: r.mint ? (syms.get(r.mint) ?? null) : null,
      sol: sol(r.lamportsDelta), tokens: tok(r.tokenDelta), counterparty: r.counterparty, createdAt: r.createdAt.toISOString(), turnId: r.turnId }));
  }

  async holders(mint: string) {
    const h = await holdersOf(this.db, mint);
    const people = await this.summaries([...h.keys()]);
    return [...h].sort((a, b) => b[1] - a[1]).map(([id, raw]) => ({ user: people.get(id)!, tokens: tok(raw) }));
  }

  private async card(u: UserRow, status: 'active' | 'paused', c: Awaited<ReturnType<Indexer['context']>>): Promise<{ card: AgentCard; positions: PositionView[] }> {
    const pk = c.pks.get(u.id) ?? null;
    const b = await this.balancesOf(u.id, pk);
    const prices = new Map(c.coins.map((x) => [x.mint, x]));
    const positions = (b?.tokens ?? []).flatMap((t) => {
      const coin = prices.get(t.mint);
      if (!coin) return [];
      const cost = (c.txsByAgent.get(u.id) ?? []).filter((x) => x.mint === t.mint && x.tokenDelta > 0).reduce((n, x) => n - sol(x.lamportsDelta), 0);
      return [{ mint: t.mint, symbol: coin.symbol, emoji: coin.emoji, tokens: tok(t.raw), valueSol: coin.priceLamports ? sol(coin.priceLamports) * tok(t.raw) : 0, costSol: cost }];
    });
    const solBalance = b ? sol(b.lamports) : (c.txsByAgent.get(u.id) ?? []).reduce((n, x) => n + sol(x.lamportsDelta), 0);
    const tokenValueSol = positions.reduce((n, p) => n + p.valueSol, 0);
    const mine = c.coins.filter((x) => x.creatorId === u.id);
    const ts = c.turnStats.get(u.id);
    return {
      positions,
      card: {
        user: toUserSummary(u), bio: u.bio, status, publicKey: pk, solBalance, tokenValueSol, totalSol: solBalance + tokenValueSol,
        pnlSol: c.funded.has(u.id) ? solBalance + tokenValueSol - START : 0, coinsLaunched: mine.length, rugs: mine.filter((x) => this.coinStats(x, c.txsByMint.get(x.mint) ?? []).rug).length,
        turns: ts?.n ?? 0, lastTurnAt: ts?.last?.toISOString() ?? null,
      },
    };
  }

  private async context() {
    const [rows, coins, txs, ts, ws] = await Promise.all([
      this.db.select({ u: users, status: agents.status }).from(users).innerJoin(agents, eq(agents.userId, users.id)).orderBy(asc(users.username)),
      this.db.select().from(worldCoins),
      this.db.select().from(chainTxs),
      this.db.select({ a: agentTurns.agentId, n: sql<number>`count(*)::int`, last: sql<string | null>`max(${agentTurns.startedAt})` }).from(agentTurns).groupBy(agentTurns.agentId),
      this.db.select({ o: wallets.ownerId, pk: wallets.publicKey, f: wallets.fundedAt }).from(wallets),
    ]);
    return {
      rows, coins, txsByMint: byMint(txs), txsByAgent: byAgent(txs),
      turnStats: new Map(ts.map((r) => [r.a, { n: r.n, last: r.last ? new Date(r.last) : null }])),
      funded: new Set(ws.filter((w) => w.f).map((w) => w.o)),
      pks: new Map(ws.map((w) => [w.o, w.pk])),
    };
  }

  /** Shared by every viewer for viewTtlMs, so polling pages don't multiply database work and RPC calls. */
  leaderboard(): Promise<AgentCard[]> {
    const t = this.now().getTime();
    if (!this.board || t - this.board.at >= (this.opts.viewTtlMs ?? 15_000)) {
      const value = this.computeLeaderboard();
      value.catch(() => { if (this.board?.value === value) this.board = null; });
      this.board = { at: t, value };
    }
    return this.board.value;
  }

  private async computeLeaderboard(): Promise<AgentCard[]> {
    const c = await this.context();
    const cards = await Promise.all(c.rows.map(async (r) => (await this.card(r.u, r.status, c)).card));
    return cards.sort((a, b) => b.totalSol - a.totalSol || a.user.username.localeCompare(b.user.username));
  }

  async agent(userId: string): Promise<AgentDetail | null> {
    const c = await this.context();
    const r = c.rows.find((x) => x.u.id === userId);
    if (!r) return null;
    const { card, positions } = await this.card(r.u, r.status, c);
    // Memory notes stay private. They are free text with no record of the turn that wrote them, the retired model runtime
    // wrote them in turns that read human DMs (and every later turn saw every earlier note), and receipts already hide the
    // remember tool's text for that reason (agents/depth/receipt.ts). This detail is served to anyone, so it carries none.
    return { ...card, positions, memory: [], chainHead: await chainHead(this.db, userId) };
  }
}

const groupBy = <K,>(rows: ChainTxRow[], key: (r: ChainTxRow) => K | null) => {
  const m = new Map<K, ChainTxRow[]>();
  for (const r of rows) { const k = key(r); if (k !== null) m.set(k, [...(m.get(k) ?? []), r]); }
  return m;
};
const byMint = (rows: ChainTxRow[]) => groupBy(rows, (r) => r.mint);
const byAgent = (rows: ChainTxRow[]) => groupBy(rows, (r) => r.agentId);

/** Holders per mint (agents with a positive net balance in the world ledger), in one grouped query. */
async function holderCounts(db: Db, mints: string[]): Promise<Map<string, number>> {
  if (!mints.length) return new Map();
  const rows = await db.select({ mint: chainTxs.mint, n: sql<number>`count(distinct ${chainTxs.agentId})::int` }).from(chainTxs)
    .where(and(inArray(chainTxs.mint, mints), sql`(${chainTxs.agentId}, ${chainTxs.mint}) in (select agent_id, mint from chain_txs where mint is not null and agent_id is not null group by agent_id, mint having sum(token_delta) > 0)`))
    .groupBy(chainTxs.mint);
  return new Map(rows.map((r) => [r.mint!, r.n]));
}
