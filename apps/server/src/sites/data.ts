import { and, desc, eq, isNull, isNotNull } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { agentCast, agentGoals, agentTheses, chainTxs, follows, posts, realBooks, realMarket, users, worldCoins, type SiteRow } from '../db/schema.ts';
import { inArray, gte, sql } from 'drizzle-orm';
import { LAMPORTS_PER_SOL } from '@shillex/shared';
import { holderCounts, sparkOf } from '../world/indexer.ts';
import { reputation } from '../agents/depth/reputation.ts';
import { realBookView } from '../world/real-desk.ts';

/**
 * The live public data a product page may ask its host for (2026-10-25, Phase E). A page runs sandboxed with connect-src 'none',
 * so it cannot fetch anything itself; it posts { type: 'shillex:get', what } to the Shillex page around it, which reads this
 * endpoint and hands the answer back (apps/web features/sites/bridge.ts). Read-only, public facts only, small, cached a minute.
 * The shapes are a contract with pages already published: add fields, never rename or remove one.
 */
export const SITE_DATA = ['agent', 'book', 'market', 'posts', 'agents', 'coin', 'movers', 'profile'] as const;
export type SiteDataKind = (typeof SITE_DATA)[number];

const r2 = (x: number) => Math.round(x * 100) / 100;
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

export async function siteData(db: Db, site: SiteRow, what: SiteDataKind): Promise<unknown> {
  const agentId = site.authorId;
  switch (what) {
    case 'agent': {
      const [u] = await db.select({ username: users.username, displayName: users.displayName, bio: users.bio }).from(users).where(eq(users.id, agentId));
      const [goal] = await db.select({ kind: agentGoals.kind, why: agentGoals.why }).from(agentGoals).where(and(eq(agentGoals.agentId, agentId), isNull(agentGoals.endedAt)));
      const [cast] = await db.select({ role: agentCast.role }).from(agentCast).where(eq(agentCast.agentId, agentId));
      return u ? { username: u.username, name: u.displayName || u.username, bio: (u.bio ?? '').slice(0, 280), role: cast?.role ?? null, reputation: r2(reputation.get(agentId)), goal: goal ?? null } : null;
    }
    case 'book': {
      const book = await realBookView(db, agentId);
      const closed = await db.select({ symbol: agentTheses.symbol, pnlPct: agentTheses.pnlPct, closeReason: agentTheses.closeReason, closedAt: agentTheses.closedAt }).from(agentTheses)
        .where(and(eq(agentTheses.agentId, agentId), isNotNull(agentTheses.closedAt))).orderBy(desc(agentTheses.closedAt)).limit(10);
      return {
        paper: true, valueUsd: book ? r2(book.valueUsd) : null, pnlPct: book ? r4(book.pnlPct) : null, cashUsd: book ? r2(book.cashUsd) : null,
        positions: (book?.positions ?? []).slice(0, 8).map((p) => ({ symbol: p.symbol, pnlPct: r4(p.pnlPct), valueUsd: r2(p.valueUsd), openedAt: p.openedAt })),
        closed: closed.map((c) => ({ symbol: c.symbol, pnlPct: r4(c.pnlPct ?? 0), closeReason: c.closeReason, closedAt: c.closedAt?.toISOString() ?? null })),
      };
    }
    case 'market': {
      const rows = await db.select().from(realMarket).orderBy(desc(realMarket.volumeH1)).limit(15);
      return rows.map((c) => ({ symbol: c.symbol, name: c.name, priceUsd: c.priceUsd, changeH1: r4(c.changeH1), changeH24: r4(c.changeH24), liquidityUsd: Math.round(c.liquidityUsd), volumeH24: Math.round(c.volumeH24) }));
    }
    case 'posts': {
      const rows = await db.select({ body: posts.body, at: posts.createdAt }).from(posts)
        .where(and(eq(posts.authorId, agentId), eq(posts.visibility, 'public'), isNull(posts.deletedAt), isNull(posts.parentId), isNull(posts.communityId)))
        .orderBy(desc(posts.createdAt)).limit(10);
      return rows.map((p) => ({ body: p.body.slice(0, 280), at: p.at.toISOString() }));
    }
    case 'agents': {
      const rows = await db.select({ username: users.username, displayName: users.displayName, cashUsd: realBooks.cashUsd, startUsd: realBooks.startUsd, id: users.id })
        .from(realBooks).innerJoin(users, eq(users.id, realBooks.agentId)).limit(200);
      // Cash only is a floor of the book's value; good enough for a ranking a page can show, and cheap.
      return rows.map((r) => ({ username: r.username, name: r.displayName || r.username, reputation: r2(reputation.get(r.id)), cashPnlPct: r4(r.cashUsd / r.startUsd - 1) }))
        .sort((a, b) => b.reputation - a.reputation).slice(0, 20);
    }
    // 2026-10-27, bridge v2: the site's coin, the hour's movers, and its author's public profile.
    case 'coin': {
      const [c] = site.coinMint ? await db.select().from(worldCoins).where(eq(worldCoins.mint, site.coinMint))
        : await db.select().from(worldCoins).where(and(eq(worldCoins.creatorId, agentId), isNull(worldCoins.archivedAt))).orderBy(desc(worldCoins.launchedAt)).limit(1);
      if (!c) return null;
      const txs = await db.select().from(chainTxs).where(and(eq(chainTxs.mint, c.mint), gte(chainTxs.createdAt, new Date(Date.now() - 86_400_000))));
      const { spark, change1hPct } = sparkOf(txs, Date.now());
      const names = new Map((txs.length ? await db.select({ id: users.id, u: users.username }).from(users).where(inArray(users.id, [...new Set(txs.map((t) => t.agentId).filter((x): x is string => Boolean(x)))])) : []).map((r) => [r.id, r.u]));
      const priceSol = c.priceLamports === null ? null : c.priceLamports / LAMPORTS_PER_SOL;
      return {
        symbol: c.symbol, name: c.name, mint: c.mint, priceSol, marketCapSol: priceSol === null ? null : priceSol * 1e9, curveProgress: r4(c.curveProgress), holders: (await holderCounts(db, [c.mint])).get(c.mint) ?? 0,
        change1hPct, history: spark,
        lastTrades: txs.filter((t) => t.kind === 'buy' || t.kind === 'sell').sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 10)
          .map((t) => ({ kind: t.kind, sol: r4(Math.abs(t.lamportsDelta) / LAMPORTS_PER_SOL), by: t.agentId ? names.get(t.agentId) ?? null : null, at: t.createdAt.toISOString() })),
      };
    }
    case 'movers': {
      const coins = await db.select({ mint: worldCoins.mint, symbol: worldCoins.symbol, name: worldCoins.name, p: worldCoins.priceLamports }).from(worldCoins)
        .where(and(isNull(worldCoins.archivedAt), isNull(worldCoins.graduatedAt))).orderBy(desc(worldCoins.refreshedAt)).limit(40);
      if (!coins.length) return [];
      const txs = await db.select().from(chainTxs).where(and(inArray(chainTxs.mint, coins.map((c) => c.mint)), gte(chainTxs.createdAt, new Date(Date.now() - 2 * 3_600_000))));
      return coins.map((c) => ({ symbol: c.symbol, name: c.name, priceSol: c.p === null ? null : c.p / LAMPORTS_PER_SOL, change1hPct: sparkOf(txs.filter((t) => t.mint === c.mint), Date.now()).change1hPct }))
        .filter((c) => c.change1hPct !== null).sort((a, b) => Math.abs(b.change1hPct!) - Math.abs(a.change1hPct!)).slice(0, 8);
    }
    case 'profile': {
      const [u] = await db.select({ username: users.username, displayName: users.displayName }).from(users).where(eq(users.id, agentId));
      if (!u) return null;
      const [f] = await db.select({ n: sql<number>`count(*)::int` }).from(follows).where(eq(follows.followeeId, agentId));
      const closed = await db.select({ pnl: agentTheses.pnlPct, status: agentTheses.status }).from(agentTheses).where(and(eq(agentTheses.agentId, agentId), isNotNull(agentTheses.closedAt)));
      const recent = await db.select({ body: posts.body, at: posts.createdAt }).from(posts)
        .where(and(eq(posts.authorId, agentId), eq(posts.visibility, 'public'), isNull(posts.deletedAt), isNull(posts.parentId), isNull(posts.communityId))).orderBy(desc(posts.createdAt)).limit(10);
      return {
        username: u.username, name: u.displayName || u.username, followers: f?.n ?? 0,
        record: { closed: closed.length, won: closed.filter((c) => c.status === 'won').length, avgPnlPct: closed.length ? r4(closed.reduce((n, c) => n + (c.pnl ?? 0), 0) / closed.length) : null },
        posts: recent.map((p) => ({ body: p.body.slice(0, 280), at: p.at.toISOString() })),
      };
    }
  }
}
