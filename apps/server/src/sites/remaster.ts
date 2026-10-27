import { isNull } from 'drizzle-orm';
import { sites } from '../db/schema.ts';
import { getSetting, setSetting } from '../world/launchpad.ts';
import { exclusiveTurn } from '../agents/moments.ts';
import { buildProduct } from './products.ts';
import type { SiteDeps } from './build.ts';

/**
 * The daily remaster (2026-10-27): after 00:30 UTC, the sites most visited since yesterday's pass are rebuilt once with the stronger
 * model (tier 2, ANTHROPIC_MODEL_STRONG), the house paying instead of the agent's compute, as their next version; each author
 * announces it in the feed. Visits are counted against yesterday's snapshot (kept in world settings), so a site is ranked by
 * the day it had, not by its whole life.
 */
const DAY_KEY = 'remaster_day', VIEWS_KEY = 'remaster_views';
/** Not before this minute of the UTC day. */
const AFTER_MINUTE = 30;

export async function remasterPass(d: SiteDeps, n: number): Promise<string[]> {
  const now = d.now();
  if (n <= 0 || !d.brain || !d.budget || d.halt?.reason() || now.getUTCHours() * 60 + now.getUTCMinutes() < AFTER_MINUTE) return [];
  const day = now.toISOString().slice(0, 10);
  if ((await getSetting(d.db, DAY_KEY)) === day) return [];
  // Taken first: a crash mid-pass does not remaster the same sites twice in a day.
  await setSetting(d.db, DAY_KEY, day);
  const before = JSON.parse((await getSetting(d.db, VIEWS_KEY)) ?? '{}') as Record<string, number>;
  const rows = await d.db.select({ id: sites.id, slug: sites.slug, authorId: sites.authorId, views: sites.views }).from(sites).where(isNull(sites.removedAt));
  await setSetting(d.db, VIEWS_KEY, JSON.stringify(Object.fromEntries(rows.map((r) => [r.id, r.views]))));
  const top = rows.map((r) => ({ ...r, day: r.views - (before[r.id] ?? 0) })).filter((r) => r.day > 0).sort((a, b) => b.day - a.day).slice(0, n);
  const done: string[] = [];
  for (const s of top) {
    const why = `one of the ${n} most visited sites on Shillex since yesterday (${s.day} visits): the remaster rebuilds it with far more craft, the same soul`;
    const r = await exclusiveTurn(d, s.authorId, () => buildProduct({ ...d, brain: d.brain!, budget: d.budget! }, s.authorId, { site: 'improve', siteId: s.id }, { force: why, remaster: true }))
      .catch((e) => { console.error('[remaster] failed', s.slug, (e as Error)?.message ?? e); return null; });
    if (r?.ran && r.value.status === 'ok') done.push(s.slug);
  }
  if (done.length) console.log(`[remaster] remastered ${done.join(', ')}`);
  return done;
}
