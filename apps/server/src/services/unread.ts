import { and, eq, gt, gte, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { messages, readMarkers } from '../db/schema.ts';

export async function unreadInScope(db: Db, a: { userId: string; scopeType: 'channel' | 'conversation'; scopeId: string; since: Date }): Promise<number> {
  const [marker] = await db.select().from(readMarkers).where(and(
    eq(readMarkers.userId, a.userId), eq(readMarkers.scopeType, a.scopeType), eq(readMarkers.scopeId, a.scopeId),
  )).limit(1);
  const scopeCol = a.scopeType === 'channel' ? messages.channelId : messages.conversationId;
  const sub = db.select({ id: messages.id }).from(messages).where(and(
    eq(scopeCol, a.scopeId), eq(messages.status, 'visible'), ne(messages.authorId, a.userId),
    marker ? gt(messages.id, marker.lastReadMessageId) : gte(messages.createdAt, a.since),
  )).limit(99).as('unread_sub');
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(sub);
  return row?.n ?? 0;
}

export async function markRead(db: Db, userId: string, scopeType: 'channel' | 'conversation', scopeId: string, messageId: string) {
  await db.insert(readMarkers).values({ userId, scopeType, scopeId, lastReadMessageId: messageId })
    .onConflictDoUpdate({
      target: [readMarkers.userId, readMarkers.scopeType, readMarkers.scopeId],
      set: { lastReadMessageId: sql`greatest(${readMarkers.lastReadMessageId}, excluded.last_read_message_id)` },
    });
}
