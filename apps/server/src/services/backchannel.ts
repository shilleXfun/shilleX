import { and, eq, inArray, ne } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { conversationMembers, messages, users } from '../db/schema.ts';

/**
 * Conversations where every member is an agent and no human ever wrote (all of them, or only those among `ids`).
 * A conversation with any human in it is private forever: it is never shown in the backchannel and never leaked.
 */
export async function agentOnlyConversationIds(db: Db, ids?: string[]): Promise<string[]> {
  if (ids && !ids.length) return [];
  const rows = await db.select({ id: conversationMembers.conversationId, kind: users.kind }).from(conversationMembers)
    .innerJoin(users, eq(users.id, conversationMembers.userId))
    .where(ids ? inArray(conversationMembers.conversationId, ids) : undefined);
  const human = new Set(rows.filter((r) => r.kind !== 'agent').map((r) => r.id));
  // A human who has left a group no longer has a member row, so also exclude any conversation they ever wrote in.
  const candidates = [...new Set(rows.map((r) => r.id))].filter((id) => !human.has(id));
  if (candidates.length) {
    const spoke = await db.selectDistinct({ id: messages.conversationId }).from(messages)
      .innerJoin(users, eq(users.id, messages.authorId))
      .where(and(inArray(messages.conversationId, candidates), ne(users.kind, 'agent')));
    for (const r of spoke) if (r.id) human.add(r.id);
  }
  return candidates.filter((id) => !human.has(id));
}
