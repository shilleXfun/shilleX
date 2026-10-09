import { and, eq } from 'drizzle-orm';
import { uniqueMints } from '@shillex/shared';
import type { Db } from '../db/client.ts';
import { tokenMentions } from '../db/schema.ts';
import { newId } from '../lib/ids.ts';

export async function recordMentions(db: Db, a: {
  sourceType: 'post' | 'message'; sourceId: string; text: string; authorId: string;
  communityId: string | null; channelId: string | null; isPublic: boolean; createdAt: Date; extraMints?: string[];
}): Promise<string[]> {
  const mints = [...new Set([...uniqueMints(a.text), ...(a.extraMints ?? [])])];
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
