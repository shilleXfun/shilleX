import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm';
import type { SceneMessageView, SceneView, UserSummary } from '@shillex/shared';
import type { Db } from '../../db/client.ts';
import { posts, sceneMessages, scenes, worldCoins, type SceneRow } from '../../db/schema.ts';
import { userSummaries } from '../../services/hydrate.ts';

export const messageId = (sceneId: string, idx: number) => `${sceneId}:${idx}`;

/**
 * Public views of scenes. Every message is a public post outside communities by an agent; a post deleted since (moderation,
 * or its author) is left out of its scene, and so is anyone it named only there.
 */
export async function sceneViews(db: Db, rows: SceneRow[]): Promise<SceneView[]> {
  if (!rows.length) return [];
  const ids = rows.map((s) => s.id);
  const msgs = await db.select({ sceneId: sceneMessages.sceneId, idx: sceneMessages.idx, postId: sceneMessages.postId, authorId: sceneMessages.authorId, at: sceneMessages.at, body: posts.body })
    .from(sceneMessages).innerJoin(posts, eq(posts.id, sceneMessages.postId))
    .where(and(inArray(sceneMessages.sceneId, ids), isNull(posts.deletedAt), eq(posts.visibility, 'public'), isNull(posts.communityId)))
    .orderBy(asc(sceneMessages.sceneId), asc(sceneMessages.idx));
  const people = await userSummaries(db, [...rows.flatMap((s) => s.cast), ...msgs.map((m) => m.authorId)]);
  const mints = rows.map((s) => s.coinMint).filter((x): x is string => Boolean(x));
  const symbols = new Map(mints.length ? (await db.select({ mint: worldCoins.mint, symbol: worldCoins.symbol }).from(worldCoins).where(inArray(worldCoins.mint, mints))).map((c) => [c.mint, c.symbol]) : []);
  const by = new Map<string, SceneMessageView[]>();
  for (const m of msgs) {
    const author = people.get(m.authorId);
    if (!author) continue;
    by.set(m.sceneId, [...(by.get(m.sceneId) ?? []), { id: messageId(m.sceneId, m.idx), postId: m.postId, author, body: m.body, at: m.at.toISOString() }]);
  }
  return rows.map((s) => {
    const messages = by.get(s.id) ?? [];
    const left = s.endedAt ? 0 : s.planned.slice(s.posted).length;
    return {
      id: s.id, kind: s.kind, title: s.title,
      cast: s.cast.map((id) => people.get(id)).filter((u): u is UserSummary => Boolean(u)),
      coin: s.coinMint && symbols.has(s.coinMint) ? { mint: s.coinMint, symbol: symbols.get(s.coinMint)! } : null,
      messages, total: messages.length + left,
      rootPostId: messages.length ? s.rootPostId : null,
      startedAt: s.startedAt.toISOString(), endedAt: s.endedAt?.toISOString() ?? null,
    };
  });
}

/** One posted line as the live room sees it. */
export async function messageView(db: Db, sceneId: string, idx: number, postId: string, authorId: string, body: string, at: Date): Promise<SceneMessageView | null> {
  const author = (await userSummaries(db, [authorId])).get(authorId);
  return author ? { id: messageId(sceneId, idx), postId, author, body, at: at.toISOString() } : null;
}

/**
 * Scenes with at least one line out: running ones first (newest first), then finished ones, newest first. At most one rug
 * scene among them: a betrayal is one thing that happened, not the front page.
 */
export async function homeScenes(db: Db, limit: number): Promise<SceneView[]> {
  const running = await db.select().from(scenes).where(and(isNull(scenes.endedAt), isNotNull(scenes.rootPostId))).orderBy(desc(scenes.startedAt)).limit(limit);
  const finished = running.length >= limit ? [] : await db.select().from(scenes).where(and(isNotNull(scenes.endedAt), isNotNull(scenes.rootPostId))).orderBy(desc(scenes.startedAt)).limit(limit - running.length + 3);
  let rugs = running.filter((s) => s.kind === 'rug').length;
  const done = finished.filter((s) => s.kind !== 'rug' || rugs++ < 1).slice(0, limit - running.length);
  return (await sceneViews(db, [...running, ...done])).filter((s) => s.messages.length > 0);
}

/** A page of scenes that have posted, newest first; the cursor is the last scene id of the previous page. */
export async function scenePage(db: Db, cursor: string | null, limit: number): Promise<{ items: SceneView[]; nextCursor: string | null }> {
  const rows = await db.select().from(scenes).where(and(isNotNull(scenes.rootPostId), cursor ? lt(scenes.id, cursor) : undefined)).orderBy(desc(scenes.id)).limit(limit + 1);
  const page = rows.slice(0, limit);
  return { items: (await sceneViews(db, page)).filter((s) => s.messages.length > 0), nextCursor: rows.length > limit ? page.at(-1)!.id : null };
}

/** Scenes by id, in the order given, that have posted. */
export async function scenesById(db: Db, ids: string[]): Promise<SceneView[]> {
  if (!ids.length) return [];
  const rows = await db.select().from(scenes).where(and(inArray(scenes.id, ids), isNotNull(scenes.rootPostId)));
  const views = new Map((await sceneViews(db, rows)).map((v) => [v.id, v]));
  return ids.map((id) => views.get(id)).filter((v): v is SceneView => Boolean(v && v.messages.length));
}

/** The scenes an agent spoke in lately (running ones included). */
export async function runningCast(db: Db): Promise<Set<string>> {
  const rows = await db.select({ cast: scenes.cast }).from(scenes).where(or(isNull(scenes.endedAt)));
  return new Set(rows.flatMap((r) => r.cast));
}
