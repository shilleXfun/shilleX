import { desc, eq } from 'drizzle-orm';
import type { StoryBeatView, StoryDetailView, StoryView, UserSummary } from '@shillex/shared';
import type { Db } from '../../db/client.ts';
import { storyBeats, type StoryRow } from '../../db/schema.ts';
import { userSummaries } from '../../services/hydrate.ts';
import type { Indexer } from '../../world/indexer.ts';
import { scenesById } from '../scenes/views.ts';

/** Public views of stories: headline, summary, cast and the coin's last day of prices. Beats are built from public facts only. */
export async function storyViews(db: Db, indexer: Indexer, rows: StoryRow[]): Promise<StoryView[]> {
  if (!rows.length) return [];
  const people = await userSummaries(db, rows.flatMap((s) => s.cast));
  const coins = new Map<string, StoryView['coin']>();
  for (const mint of new Set(rows.map((s) => s.coinMint).filter((x): x is string => Boolean(x)))) {
    const c = await indexer.coin(mint);
    if (c) coins.set(mint, { mint: c.mint, symbol: c.symbol, spark: c.spark ?? [], change1hPct: c.change1hPct ?? null });
  }
  return rows.map((s) => ({
    id: s.id, kind: s.kind, headline: s.headline, summary: s.summary,
    cast: s.cast.map((id) => people.get(id)).filter((u): u is UserSummary => Boolean(u)),
    coin: s.coinMint ? coins.get(s.coinMint) ?? null : null,
    heat: Math.round(Math.max(0, Math.min(1, s.heat)) * 1000) / 1000, beats: s.beats,
    startedAt: s.startedAt.toISOString(), updatedAt: s.updatedAt.toISOString(),
  }));
}

/** A story with its timeline (oldest first, the newest 100 beats) and the scenes that belong to it (newest first, at most 10). */
export async function storyDetail(db: Db, indexer: Indexer, row: StoryRow): Promise<StoryDetailView> {
  const [view] = await storyViews(db, indexer, [row]);
  const beats = (await db.select().from(storyBeats).where(eq(storyBeats.storyId, row.id)).orderBy(desc(storyBeats.at), desc(storyBeats.id)).limit(100)).reverse();
  const timeline: StoryBeatView[] = beats.map((b) => ({ at: b.at.toISOString(), kind: b.kind, text: b.text, postId: b.postId, sceneId: b.sceneId, mint: b.coinMint }));
  const sceneIds = [...new Set(beats.map((b) => b.sceneId).filter((x): x is string => Boolean(x)))].reverse().slice(0, 10);
  return { ...view!, timeline, scenes: await scenesById(db, sceneIds) };
}


