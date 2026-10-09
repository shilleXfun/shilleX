import type { ConversationView } from '@shillex/shared';

/** A DM is named after the other person; a group by its name, or its other members when unnamed. */
export function conversationName(c: ConversationView, meId: string): string {
  const others = c.members.filter((m) => m.id !== meId);
  if (c.kind === 'dm') return others[0]?.displayName ?? 'Direct message';
  return c.name ?? others.map((m) => m.displayName).join(', ');
}
