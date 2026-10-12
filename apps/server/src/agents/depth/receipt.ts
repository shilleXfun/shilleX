import { and, eq, inArray, sql } from 'drizzle-orm';
import type { ToolCallRecord, TurnTrigger, TurnView, UserSummary } from '@shillex/shared';
import type { Db } from '../../db/client.ts';
import { channels, communities, communityMembers, conversationMembers, messages, posts, users, type AgentTurnRow } from '../../db/schema.ts';
import { toTurnView } from '../../world/provenance.ts';
import type { ToolOutcome } from '../../world/tools.ts';

const truncate = (v: unknown) => { const s = JSON.stringify(v ?? null); return s.length <= 2000 ? v : `${s.slice(0, 2000)}…`; };
const isStr = (x: unknown): x is string => typeof x === 'string' && x.length > 0;
const bare = (name: string) => name.replace(/^@/, '').toLowerCase();

/** Tools whose input and result never hold conversation, channel or community content. Every other tool is checked below or kept private. */
const OPEN = new Set(['set_profile', 'post', 'follow', 'read_profile', 'read_wallet', 'read_coin', 'launch_coin', 'buy', 'sell', 'send_sol', 'do_nothing']);
/**
 * Always private: list_conversations returns each conversation's last message; list_communities names private communities;
 * an invite code opens a private community; memory notes are free text that can quote a DM.
 */
const ALWAYS_PRIVATE = new Set(['list_conversations', 'list_communities', 'create_invite', 'remember', 'rewrite_memory']);

/** A username the route would resolve (case-insensitive, optional @) that is a human, or no user at all. */
async function humanOrUnknownUser(db: Db, names: unknown[]): Promise<boolean> {
  if (!names.length || !names.every(isStr)) return true;
  const want = [...new Set((names as string[]).map(bare))];
  const rows = await db.select({ u: sql<string>`lower(${users.username})`, kind: users.kind }).from(users).where(inArray(sql`lower(${users.username})`, want));
  return rows.length < want.length || rows.some((r) => r.kind !== 'agent');
}

/** A conversation with a human member, or one that does not exist. */
async function privateConversation(db: Db, id: unknown): Promise<boolean> {
  if (!isStr(id)) return true;
  const members = await db.select({ kind: users.kind }).from(conversationMembers).innerJoin(users, eq(users.id, conversationMembers.userId)).where(eq(conversationMembers.conversationId, id));
  return members.length === 0 || members.some((m) => m.kind !== 'agent');
}

/** A community that is not public, has a human owner or any human member (whatever their status), or does not exist. */
async function privateCommunity(db: Db, where: { id: string } | { slug: string }): Promise<boolean> {
  const [c] = await db.select({ id: communities.id, visibility: communities.visibility, ownerId: communities.ownerId }).from(communities)
    .where('id' in where ? eq(communities.id, where.id) : eq(communities.slug, where.slug));
  if (!c || c.visibility !== 'public') return true;
  const [owner] = await db.select({ kind: users.kind }).from(users).where(eq(users.id, c.ownerId));
  if (owner?.kind !== 'agent') return true;
  const humans = await db.select({ id: users.id }).from(communityMembers).innerJoin(users, eq(users.id, communityMembers.userId))
    .where(and(eq(communityMembers.communityId, c.id), sql`${users.kind} <> 'agent'`)).limit(1);
  return humans.length > 0;
}

async function privateChannel(db: Db, id: unknown): Promise<boolean> {
  if (!isStr(id)) return true;
  const [ch] = await db.select({ communityId: channels.communityId }).from(channels).where(eq(channels.id, id));
  return !ch || privateCommunity(db, { id: ch.communityId });
}

const privateSlug = async (db: Db, slug: unknown) => !isStr(slug) || privateCommunity(db, { slug });

/** Exactly one of channel_id / conversation_id, each checked; anything else is private. */
async function privateRoom(db: Db, input: Record<string, unknown>): Promise<boolean> {
  const conv = input.conversation_id, ch = input.channel_id;
  if (isStr(conv) === isStr(ch)) return true;
  return isStr(conv) ? privateConversation(db, conv) : privateChannel(db, ch);
}

/** A post inside a community that is private by the rule above, or a post that does not exist. */
async function privatePost(db: Db, id: unknown): Promise<boolean> {
  if (!isStr(id)) return true;
  const [p] = await db.select({ communityId: posts.communityId }).from(posts).where(eq(posts.id, id));
  if (!p) return true;
  return p.communityId ? privateCommunity(db, { id: p.communityId }) : false;
}

async function privateMessage(db: Db, id: unknown): Promise<boolean> {
  if (!isStr(id)) return true;
  const [m] = await db.select({ channelId: messages.channelId, conversationId: messages.conversationId }).from(messages).where(eq(messages.id, id));
  if (!m) return true;
  return m.conversationId ? privateConversation(db, m.conversationId) : privateChannel(db, m.channelId);
}

/**
 * Deny by default: true unless the call is known to touch nothing a human said or keeps private. Covers every tool that
 * reads or writes conversation, channel or community content (src/world/tools.ts); an unknown tool is private.
 */
async function isPrivateCall(db: Db, name: string, input: Record<string, unknown>): Promise<boolean> {
  if (OPEN.has(name)) return false;
  if (ALWAYS_PRIVATE.has(name)) return true;
  switch (name) {
    case 'chat': case 'read_room': return privateRoom(db, input);
    case 'start_dm': return humanOrUnknownUser(db, [input.username]);
    case 'start_group': return !Array.isArray(input.usernames) || humanOrUnknownUser(db, input.usernames);
    case 'add_to_group': return (await privateConversation(db, input.conversation_id)) || humanOrUnknownUser(db, [input.username]);
    case 'leave_group': return privateConversation(db, input.conversation_id);
    case 'create_community': return input.visibility !== 'public';
    case 'join_community': return input.invite_code != null || privateSlug(db, input.slug);
    case 'read_community': case 'leave_community': case 'create_channel': return privateSlug(db, input.slug);
    case 'moderate_member': return (await privateSlug(db, input.slug)) || humanOrUnknownUser(db, [input.username]);
    case 'reply': case 'quote': case 'read_thread': return privatePost(db, input.post_id);
    case 'react': return input.target_type === 'post' ? privatePost(db, input.target_id) : privateMessage(db, input.target_id);
    default: return true;
  }
}

const PRIVATE = (name: string, out: { ok: boolean }): ToolCallRecord => ({ name, input: { private: true }, ok: out.ok, result: { private: true } });

/**
 * The receipt entry for a tool call made by depth code. A call that touches a human's conversation or a private community
 * (or one that cannot be checked) is recorded as private, and `private` tells the caller to keep its text out of everything else.
 */
export async function depthToolRecord(db: Db, name: string, input: Record<string, unknown>, out: ToolOutcome): Promise<{ record: ToolCallRecord; private: boolean }> {
  let priv: boolean;
  try { priv = await isPrivateCall(db, name, input ?? {}); } catch { priv = true; }
  if (priv) return { record: PRIVATE(name, out), private: true };
  return { record: { name, input, ok: out.ok, result: truncate(out.result), signatures: out.signatures }, private: false };
}

/** Triggers that name nothing private (no conversation, message, post or channel behind them). */
const OPEN_TRIGGERS = new Set<TurnTrigger['type']>(['first_turn', 'heartbeat', 'launch', 'money']);

/**
 * A turn as anyone may see it. Turns sealed by the retired model runtime (prompt versions `world-*`) stored raw what the
 * turn saw and did: the DM that woke it, every memory note, the model's reasoning, and full tool inputs and results. They
 * are scrubbed here, when served: no context, no reasoning, each tool call checked as above (private ones keep only their
 * name and outcome), and a trigger keeps only its kind when it points at a conversation, message, post or channel.
 * The stored row and its hashes are untouched, so the chain still verifies; today's turns are recorded safe and pass as is.
 */
export async function publicTurnView(db: Db, row: AgentTurnRow, agent: UserSummary): Promise<TurnView> {
  const view = toTurnView(row, agent);
  if (!row.promptVersion.startsWith('world-')) return view;
  const toolCalls = await Promise.all(view.toolCalls.map(async (c) => {
    const input = c.input && typeof c.input === 'object' && !Array.isArray(c.input) ? c.input as Record<string, unknown> : {};
    let priv: boolean;
    try { priv = await isPrivateCall(db, c.name, input); } catch { priv = true; }
    return priv ? PRIVATE(c.name, c) : c;
  }));
  const triggers = view.triggers.map((t) => (OPEN_TRIGGERS.has(t.type) ? t : { type: t.type }));
  return { ...view, context: [], reasoning: '', toolCalls, triggers };
}
