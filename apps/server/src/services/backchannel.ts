import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { conversationMembers, conversationPins, messages, users } from '../db/schema.ts';
import { AppError } from '../lib/errors.ts';

/**
 * Conversations where every member is an agent and no human ever wrote (all of them, or only those among `ids`).
 * A conversation with any human in it is private forever: it is never shown in the backchannel and never leaked.
 */
export async function agentOnlyConversationIds(db: Db, ids?: string[]): Promise<string[]> {
  // With no ids (the backchannel list, polled every 5 s), start from the conversations an agent is in, found through the
  // agents' own membership rows (conv_members_user_idx), instead of reading every membership row humans' DMs included.
  const scope = ids ?? (await db.selectDistinct({ id: conversationMembers.conversationId }).from(conversationMembers)
    .where(inArray(conversationMembers.userId, db.select({ id: users.id }).from(users).where(eq(users.kind, 'agent'))))).map((r) => r.id);
  if (!scope.length) return [];
  const rows = await db.select({ id: conversationMembers.conversationId, kind: users.kind }).from(conversationMembers)
    .innerJoin(users, eq(users.id, conversationMembers.userId))
    .where(inArray(conversationMembers.conversationId, scope));
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

/** Pins kept in one conversation; a fourth pin lets the oldest go. */
export const PINS_MAX = 3;

/**
 * An agent pins (or unpins) a message in one of its own conversations (2026-10-28 brief §8). Refusals: NOT_FOUND (no such
 * message), NOT_MEMBER (not its conversation), NOT_A_DM (a room line, not a conversation).
 */
export async function pinMessage(db: Db, agentId: string, messageId: string, pin: boolean, now: Date): Promise<{ pinned: boolean }> {
  const [m] = await db.select({ c: messages.conversationId }).from(messages).where(and(eq(messages.id, messageId), ne(messages.status, 'deleted')));
  if (!m) throw new AppError(404, 'NOT_FOUND', 'No such message');
  if (!m.c) throw new AppError(400, 'NOT_A_DM', 'Only messages in conversations can be pinned');
  const [member] = await db.select({ u: conversationMembers.userId }).from(conversationMembers).where(and(eq(conversationMembers.conversationId, m.c), eq(conversationMembers.userId, agentId)));
  if (!member) throw new AppError(403, 'NOT_MEMBER', 'You can pin only in your own conversations');
  if (!pin) {
    await db.delete(conversationPins).where(and(eq(conversationPins.conversationId, m.c), eq(conversationPins.messageId, messageId)));
    return { pinned: false };
  }
  await db.insert(conversationPins).values({ conversationId: m.c, messageId, pinnedBy: agentId, createdAt: now }).onConflictDoNothing();
  const all = await db.select({ id: conversationPins.messageId }).from(conversationPins).where(eq(conversationPins.conversationId, m.c)).orderBy(desc(conversationPins.createdAt));
  const drop = all.slice(PINS_MAX).map((p) => p.id);
  if (drop.length) await db.delete(conversationPins).where(and(eq(conversationPins.conversationId, m.c), inArray(conversationPins.messageId, drop)));
  return { pinned: true };
}
