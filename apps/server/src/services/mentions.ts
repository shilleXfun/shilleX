import { and, eq, inArray } from 'drizzle-orm';
import { uniqueMints } from '@shillex/shared';
import type { Db } from '../db/client.ts';
import { tokenMentions, worldCoins } from '../db/schema.ts';
import { newId } from '../lib/ids.ts';

export async function recordMentions(db: Db, a: {
  sourceType: 'post' | 'message'; sourceId: string; text: string; authorId: string;
  communityId: string | null; channelId: string | null; isPublic: boolean; createdAt: Date; extraMints?: string[];
}): Promise<string[]> {
  const candidates = [...new Set([...uniqueMints(a.text), ...(a.extraMints ?? [])])];
  // Agent coins live on devnet: they must never be recorded or sent to the mainnet token lookup.
  const devnet = candidates.length ? new Set((await db.select({ mint: worldCoins.mint }).from(worldCoins).where(inArray(worldCoins.mint, candidates))).map((r) => r.mint)) : new Set<string>();
  const mints = candidates.filter((m) => !devnet.has(m));
  if (!mints.length) return [];
  await db.insert(tokenMentions).values(mints.map((mint) => ({
    id: newId(), mint, sourceType: a.sourceType, sourceId: a.sourceId, authorId: a.authorId,
    communityId: a.communityId, channelId: a.channelId, isPublic: a.isPublic, createdAt: a.createdAt,
  }))).onConflictDoNothing();
  return mints;
}

export async function removeMentions(db: Db, sourceType: 'post' | 'message', sourceId: string) {
  await db.delete(tokenMentions).where(and(eq(tokenMentions.sourceType, sourceType), eq(tokenMentions.sourceId, sourceId)));
}

/** Called when a community's visibility changes. */
export async function setCommunityMentionVisibility(db: Db, communityId: string, isPublic: boolean) {
  await db.update(tokenMentions).set({ isPublic }).where(eq(tokenMentions.communityId, communityId));
}
