import { asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { xPosts, xSources } from '../db/schema.ts';
import { XApiError, type XApi, type XPage } from './api.ts';
import type { XConfig } from './config.ts';
import { bookX, canSpendX, xSpendToday } from './spend.ts';
import type { XSourceRow } from './sources.ts';

export const ACCOUNT_EVERY_MS = 15 * 60_000, QUERY_EVERY_MS = 2 * 3600_000;
const BACKOFF_MS = 15 * 60_000;
const ACCOUNT_MIN = 5, ACCOUNT_MAX = 20, QUERY_MAX = 10;
export interface PollDeps { db: Db; api: XApi; config: XConfig; now: () => Date }

const due = (s: XSourceRow, everyMs: number, now: Date) =>
  (!s.lastPolledAt || now.getTime() - s.lastPolledAt.getTime() >= everyMs) && (!s.backoffUntil || s.backoffUntil <= now);
const parsed = (iso: string, fallback: Date) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t) : fallback; };

/**
 * One poll (x-feed §3): every account that is due (15 min) with min(20, what is left today) reads, at least 5; then every query
 * that is due (2 h) with 10, only from what the accounts left. Each call is checked against the X hard stop first and booked
 * from result_count after. A 429 backs that source off; a 401 or 403 halts the feed; anything else is retried next tick.
 */
export async function pollOnce(d: PollDeps): Promise<{ read: number; halted: string | null }> {
  const now = d.now();
  const sources = await d.db.select().from(xSources).where(eq(xSources.enabled, true)).orderBy(sql`${xSources.lastPolledAt} asc nulls first`, asc(xSources.createdAt));
  let allowance = d.config.dailyMaxPostReads - (await xSpendToday(d.db, now)).postReads;
  let read = 0;
  const plan = [
    ...sources.filter((s) => s.kind === 'account' && s.xUserId && due(s, ACCOUNT_EVERY_MS, now)),
    ...sources.filter((s) => s.kind === 'query' && due(s, QUERY_EVERY_MS, now)),
  ];
  for (const s of plan) {
    const max = s.kind === 'account' ? Math.min(ACCOUNT_MAX, allowance) : QUERY_MAX;
    if (max < (s.kind === 'account' ? ACCOUNT_MIN : QUERY_MAX) || allowance < max) continue;
    if (!(await canSpendX(d.db, now, d.config, max * d.config.prices.postRead))) break;
    let page: XPage;
    try {
      page = s.kind === 'account' ? await d.api.userPosts(s.xUserId!, { sinceId: s.sinceId, max }) : await d.api.search(s.value, { sinceId: s.sinceId, max });
    } catch (e) {
      if (e instanceof XApiError && (e.status === 401 || e.status === 403)) {
        return { read, halted: `X refused the reading key (${e.status}); check X_BEARER_TOKEN, then press Resume on /admin` };
      }
      if (e instanceof XApiError && e.status === 429) {
        const until = e.resetAt && e.resetAt > now ? e.resetAt : new Date(now.getTime() + BACKOFF_MS);
        await d.db.update(xSources).set({ backoffUntil: until }).where(eq(xSources.id, s.id));
        continue;
      }
      console.error('[x] poll failed', s.kind, s.value, (e as Error)?.message ?? String(e));
      continue;
    }
    if (page.resultCount) await bookX(d.db, now, { postReads: page.resultCount, usd: page.resultCount * d.config.prices.postRead });
    if (page.posts.length) {
      await d.db.insert(xPosts).values(page.posts.map((p) => ({
        id: p.id, sourceId: s.id, authorHandle: s.kind === 'account' ? s.value : null, createdAt: parsed(p.createdAt, now), fetchedAt: now,
        text: p.text.slice(0, 1000), metrics: p.metrics, hasMedia: p.hasMedia,
      }))).onConflictDoNothing();
    }
    await d.db.update(xSources).set({ sinceId: page.newestId ?? s.sinceId, lastPolledAt: now, backoffUntil: null }).where(eq(xSources.id, s.id));
    allowance -= page.resultCount;
    read += page.resultCount;
  }
  return { read, halted: null };
}
