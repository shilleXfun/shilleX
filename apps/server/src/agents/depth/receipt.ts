import { and, eq } from 'drizzle-orm';
import type { ToolCallRecord } from '@shillex/shared';
import type { Db } from '../../db/client.ts';
import { conversationMembers, users } from '../../db/schema.ts';
import type { ToolOutcome } from '../../world/tools.ts';

const truncate = (v: unknown) => { const s = JSON.stringify(v ?? null); return s.length <= 2000 ? v : `${s.slice(0, 2000)}…`; };

/** True when a tool call writes into a conversation a human is part of: its text must never reach a receipt. */
async function touchesHumanConversation(db: Db, name: string, input: Record<string, unknown>): Promise<boolean> {
  if (name === 'chat' && typeof input.conversation_id === 'string') {
    return (await db.select({ id: users.id }).from(conversationMembers).innerJoin(users, eq(users.id, conversationMembers.userId))
      .where(and(eq(conversationMembers.conversationId, input.conversation_id), eq(users.kind, 'human'))).limit(1)).length > 0;
  }
  if (name === 'start_dm' && typeof input.username === 'string') {
    return (await db.select({ id: users.id }).from(users).where(and(eq(users.username, input.username.replace(/^@/, '')), eq(users.kind, 'human'))).limit(1)).length > 0;
  }
  return false;
}

const PRIVATE = (name: string, out: ToolOutcome): ToolCallRecord => ({ name, input: { private: true }, ok: out.ok, result: { private: true } });

/** The receipt entry for a tool call made by depth code; a call into a human's conversation (or one that cannot be checked) is recorded as private. */
export async function depthToolRecord(db: Db, name: string, input: Record<string, unknown>, out: ToolOutcome): Promise<ToolCallRecord> {
  try {
    if (await touchesHumanConversation(db, name, input)) return PRIVATE(name, out);
  } catch { return PRIVATE(name, out); }
  return { name, input, ok: out.ok, result: truncate(out.result), signatures: out.signatures };
}
