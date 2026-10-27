import { and, desc, eq, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import type { SiteView, SitesPage } from '@shillex/shared';
import type { Db } from '../db/client.ts';
import { agents, productBriefs, siteBuilds, sites, siteVersions, users, worldCoins, type SiteKind, type SiteRow } from '../db/schema.ts';
import { newId } from '../lib/ids.ts';
import { toUserSummary } from '../services/users.ts';
import { isUniqueViolation } from '../lib/pg-errors.ts';

export const siteUrl = (slug: string) => `/sites/${slug}`;
/** PUBLIC_URL's origin, where Shillex's own images live; empty when it is not a URL. */
export const originOf = (url: string) => { try { return new URL(url).origin; } catch { return ''; } };
export const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;
/** Words that are not a site's name: what a later route or a page under /sites could need. */
const RESERVED = new Set(['new', 'raw', 'api', 'admin', 'about', 'gallery', 'shillex', 'builds', 'data']);

/**
 * Shown: not taken down, and not by an agent retired for reports (spec 2026-10-13-user-agents §9). Sites of agents retired
 * for any other reason stay, as their posts do.
 */
const shown = and(isNull(sites.removedAt), or(isNull(agents.retireReason), ne(agents.retireReason, 'reports')));

export async function siteViews(db: Db, rows: SiteRow[]): Promise<SiteView[]> {
  if (!rows.length) return [];
  const mints = [...new Set(rows.map((r) => r.coinMint).filter((m): m is string => Boolean(m)))];
  const ids = rows.map((r) => r.id);
  const [authors, coins, shots, briefs] = await Promise.all([
    db.select().from(users).where(inArray(users.id, [...new Set(rows.map((r) => r.authorId))])),
    mints.length ? db.select({ mint: worldCoins.mint, symbol: worldCoins.symbol }).from(worldCoins).where(inArray(worldCoins.mint, mints)) : Promise.resolve([]),
    // Each site's newest screenshot (sites/shots.ts): the current build's, or the last build that has one.
    db.select({ siteId: siteVersions.siteId, version: siteVersions.version, blob: siteVersions.screenshotBlobId }).from(siteVersions)
      .where(and(inArray(siteVersions.siteId, ids), sql`${siteVersions.screenshotBlobId} is not null`)),
    db.select({ siteId: productBriefs.siteId, genre: productBriefs.genre }).from(productBriefs).where(and(inArray(productBriefs.siteId, ids), eq(productBriefs.status, 'published'))),
  ]);
  const shot = new Map<string, { version: number; blob: string }>();
  for (const s of shots) if (s.blob && (shot.get(s.siteId)?.version ?? 0) < s.version) shot.set(s.siteId, { version: s.version, blob: s.blob });
  const genre = new Map(briefs.map((b) => [b.siteId, b.genre]));
  const author = new Map(authors.map((u) => [u.id, toUserSummary(u)]));
  const symbol = new Map(coins.map((c) => [c.mint, c.symbol]));
  return rows.flatMap((r) => {
    const a = author.get(r.authorId);
    if (!a) return [];
    const coin = r.coinMint && symbol.has(r.coinMint) ? { mint: r.coinMint, symbol: symbol.get(r.coinMint)! } : null;
    const sh = shot.get(r.id);
    return [{ slug: r.slug, title: r.title, blurb: r.blurb, url: siteUrl(r.slug), author: a, version: r.version, coin, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
      kind: r.kind, screenshotUrl: sh ? `/api/blobs/${sh.blob}` : null, genre: genre.get(r.id) ?? null }];
  });
}

/** The cursor of a gallery page: the last site's update time and id. */
const cursorOf = (r: SiteRow) => `${r.updatedAt.getTime()}_${r.id}`;
function parseCursor(c: unknown): { at: Date; id: string } | null {
  const m = typeof c === 'string' ? /^(\d{1,15})_([0-9A-Z]{26})$/.exec(c) : null;
  return m ? { at: new Date(Number(m[1])), id: m[2]! } : null;
}

/** GET /api/sites: newest first, a rebuild counting as new. */
export async function sitesPage(db: Db, cursor: unknown, limit: number): Promise<SitesPage> {
  const c = parseCursor(cursor);
  const rows = (await db.select({ s: sites }).from(sites).leftJoin(agents, eq(agents.userId, sites.authorId))
    .where(and(shown, c ? or(lt(sites.updatedAt, c.at), and(eq(sites.updatedAt, c.at), lt(sites.id, c.id))) : undefined))
    .orderBy(desc(sites.updatedAt), desc(sites.id)).limit(limit + 1)).map((r) => r.s);
  const more = rows.length > limit;
  const page = rows.slice(0, limit);
  return { items: await siteViews(db, page), nextCursor: more ? cursorOf(page.at(-1)!) : null };
}

export async function shownSite(db: Db, slug: string): Promise<SiteRow | null> {
  if (!SLUG.test(slug)) return null;
  const [r] = await db.select({ s: sites }).from(sites).leftJoin(agents, eq(agents.userId, sites.authorId)).where(and(eq(sites.slug, slug), shown));
  return r?.s ?? null;
}

/** A shown site's HTML: the current build, or `version` when given (an old build stays at its own address). */
export async function siteHtml(db: Db, slug: string, version: number | null): Promise<{ html: string; version: number } | null> {
  const site = await shownSite(db, slug);
  if (!site) return null;
  const v = version ?? site.version;
  const [row] = await db.select({ html: siteVersions.html }).from(siteVersions).where(and(eq(siteVersions.siteId, site.id), eq(siteVersions.version, v)));
  return row ? { html: row.html, version: v } : null;
}

/** A link to a site in a post: Shillex's /sites/<slug> on any host (the announcing post carries the full PUBLIC_URL). */
const SITE_LINK = /https?:\/\/[^\s/]+\/sites\/([a-z0-9][a-z0-9-]{0,47})(?![\w-])/gi;

/**
 * PostView.site for a batch of posts (services/hydrate.ts): a post that links a site its own author built announces it. Read
 * from the post's text, so a post carries its site from the moment it exists, before anything else is written about it.
 */
export async function sitesForPosts(db: Db, rows: { id: string; authorId: string; body: string; deletedAt: Date | null }[]): Promise<Map<string, SiteView>> {
  const want = new Map<string, string[]>();
  for (const r of rows) {
    if (r.deletedAt || !r.body.includes('/sites/')) continue;
    const slugs = [...r.body.matchAll(SITE_LINK)].map((m) => m[1]!.toLowerCase()).filter((s) => SLUG.test(s));
    if (slugs.length) want.set(r.id, slugs);
  }
  const out = new Map<string, SiteView>();
  if (!want.size) return out;
  const found = (await db.select({ s: sites }).from(sites).leftJoin(agents, eq(agents.userId, sites.authorId))
    .where(and(inArray(sites.slug, [...new Set([...want.values()].flat())]), shown))).map((r) => r.s);
  const views = new Map((await siteViews(db, found)).map((v) => [v.slug, v]));
  const bySlug = new Map(found.map((s) => [s.slug, s]));
  for (const r of rows) {
    const slug = want.get(r.id)?.find((x) => bySlug.get(x)?.authorId === r.authorId);
    const v = slug ? views.get(slug) : undefined;
    if (v) out.set(r.id, v);
  }
  return out;
}

export const slugify = (s: string) => s.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');

/** A free address for a new site: the base itself, then base-2, base-3… */
export async function freeSlug(db: Db, base: string): Promise<string> {
  const root = slugify(base) || 'site';
  const taken = new Set((await db.select({ slug: sites.slug }).from(sites).where(or(eq(sites.slug, root), sql`${sites.slug} like ${`${root}-%`}`))).map((r) => r.slug));
  for (let n = 1; n < 1000; n++) {
    const slug = n === 1 ? root : `${root}-${n}`;
    if (!taken.has(slug) && !RESERVED.has(slug)) return slug;
  }
  return `${root.slice(0, 30)}-${newId().slice(-8).toLowerCase()}`;
}

export interface NewBuild { authorId: string; coAuthorId?: string | null; kind: SiteKind; title: string; blurb: string; html: string; coinMint: string | null; factionId: string | null; turnId: string; model: string; now: Date }

/** The first build of a site, in one transaction. A unique index refusing it (the coin or faction got a site meanwhile) throws. */
/**
 * A new site under `slug`. freeSlug() reads before this writes, so two builds can pick the same address (2026-10-27 live: the insert
 * failed now and then): a slug taken in between gets a short suffix and the insert is tried again, up to three times.
 */
export async function insertSite(db: Db, slug: string, b: NewBuild): Promise<SiteRow> {
  for (let attempt = 0; ; attempt++) {
    const s = attempt === 0 ? slug : `${slug.slice(0, 40)}-${newId().slice(-5).toLowerCase()}`;
    try {
      return await db.transaction(async (tx) => {
        const [row] = await tx.insert(sites).values({ id: newId(), slug: s, authorId: b.authorId, coAuthorId: b.coAuthorId ?? null, kind: b.kind, title: b.title, blurb: b.blurb, coinMint: b.coinMint, factionId: b.factionId, version: 1, createdAt: b.now, updatedAt: b.now }).returning();
        await tx.insert(siteVersions).values({ siteId: row!.id, version: 1, html: b.html, turnId: b.turnId, model: b.model, createdAt: b.now });
        return row!;
      });
    } catch (e) {
      if (!isUniqueViolation(e) || attempt >= 3) throw e;
      // The coin, the faction or the author's personal site already has one (a second build raced the first): this build is its next version.
      const which = constraintOf(e);
      if (which && which !== 'sites_slug_idx') {
        const [have] = await db.select({ id: sites.id }).from(sites).where(
          which === 'sites_coin_idx' && b.coinMint ? eq(sites.coinMint, b.coinMint) : which === 'sites_faction_idx' && b.factionId ? eq(sites.factionId, b.factionId) : and(eq(sites.authorId, b.authorId), eq(sites.kind, 'personal'))).limit(1);
        if (!have) throw e;
        return rebuildSite(db, have.id, b);
      }
    }
  }
}
/** The name of the unique index a Postgres error broke, looked for up to four causes down. */
const constraintOf = (e: unknown): string | null => {
  for (let x: any = e, i = 0; x && i < 4; x = x.cause, i++) if (typeof x.constraint === 'string') return x.constraint;
  return null;
};

/** A rebuild: version + 1, with the new title, blurb and HTML. */
export async function rebuildSite(db: Db, siteId: string, b: Pick<NewBuild, 'title' | 'blurb' | 'html' | 'turnId' | 'model' | 'now'>): Promise<SiteRow> {
  return db.transaction(async (tx) => {
    const [row] = await tx.update(sites).set({ version: sql`${sites.version} + 1`, title: b.title, blurb: b.blurb, updatedAt: b.now }).where(eq(sites.id, siteId)).returning();
    await tx.insert(siteVersions).values({ siteId, version: row!.version, html: b.html, turnId: b.turnId, model: b.model, createdAt: b.now });
    return row!;
  });
}

/**
 * Puts an earlier version back (plan E4): a new version with that version's page, screenshot and model, noted as restored, and a
 * 'restored' build on record. Versions are never edited, so nothing is lost. Null when the site or the version does not exist.
 */
export async function restoreVersion(db: Db, slug: string, version: number, now: Date): Promise<SiteRow | null> {
  const [site] = await db.select().from(sites).where(eq(sites.slug, slug));
  if (!site) return null;
  const [old] = await db.select().from(siteVersions).where(and(eq(siteVersions.siteId, site.id), eq(siteVersions.version, version)));
  if (!old || version === site.version) return null;
  return db.transaction(async (tx) => {
    const [row] = await tx.update(sites).set({ version: sql`${sites.version} + 1`, updatedAt: now }).where(eq(sites.id, site.id)).returning();
    await tx.insert(siteVersions).values({ siteId: site.id, version: row!.version, html: old.html, turnId: null, model: old.model, createdAt: now, screenshotBlobId: old.screenshotBlobId, notes: `restored from version ${version}` });
    await tx.insert(siteBuilds).values({ id: newId(), agentId: site.authorId, siteId: site.id, kind: 'restore', status: 'restored', version: row!.version, model: old.model, note: `version ${version} put back`, startedAt: now, finishedAt: now });
    return row!;
  });
}

export async function setAnnouncement(db: Db, siteId: string, version: number, postId: string): Promise<void> {
  await db.update(siteVersions).set({ postId }).where(and(eq(siteVersions.siteId, siteId), eq(siteVersions.version, version)));
}
