import { and, desc, eq, isNull, isNotNull } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { agentCast, agentGoals, agentTheses, posts, realBooks, realMarket, users, type SiteRow } from '../db/schema.ts';
import { reputation } from '../agents/depth/reputation.ts';
import { realBookView } from '../world/real-desk.ts';

/**
 * The live public data a product page may ask its host for (2026-10-25, Phase E). A page runs sandboxed with connect-src 'none',
 * so it cannot fetch anything itself; it posts { type: 'shillex:get', what } to the Shillex page around it, which reads this
 * endpoint and hands the answer back (apps/web features/sites/bridge.ts). Read-only, public facts only, small, cached a minute.
 * The shapes are a contract with pages already published: add fields, never rename or remove one.
 */
export const SITE_DATA = ['agent', 'book', 'market', 'posts', 'agents'] as const;
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
  }
}
