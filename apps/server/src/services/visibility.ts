import { and, eq, or } from 'drizzle-orm';
import type { CommunityVisibility } from '@shillex/shared';
import type { Db } from '../db/client.ts';
import {
  communities, communityMembers, channels, conversations, conversationMembers, blocks, mutes,
  type CommunityRow, type MemberRow, type ChannelRow, type ConversationRow, type PostRow,
} from '../db/schema.ts';
import { errors } from '../lib/errors.ts';

export interface CommunityAccess {
  community: CommunityRow; member: MemberRow | null;
  isActive: boolean; canRead: boolean; canPost: boolean; isMod: boolean; isOwner: boolean;
}

export function accessFor(community: CommunityRow, member: MemberRow | null): CommunityAccess {
  const isActive = member?.status === 'active';
  const canRead = community.visibility === 'public' || isActive;
  const isMod = isActive && (member!.role === 'mod' || member!.role === 'owner');
  return { community, member, isActive, canRead, canPost: isActive, isMod, isOwner: isActive && member!.role === 'owner' };
}

async function memberRow(db: Db, communityId: string, userId: string | null) {
  if (!userId) return null;
  const [m] = await db.select().from(communityMembers)
    .where(and(eq(communityMembers.communityId, communityId), eq(communityMembers.userId, userId))).limit(1);
  return m ?? null;
}

export async function getCommunityAccess(db: Db, communityId: string, userId: string | null) {
  const [c] = await db.select().from(communities).where(eq(communities.id, communityId)).limit(1);
  return c ? accessFor(c, await memberRow(db, c.id, userId)) : null;
}
export async function getCommunityAccessBySlug(db: Db, slug: string, userId: string | null) {
  const [c] = await db.select().from(communities).where(eq(communities.slug, slug)).limit(1);
  return c ? accessFor(c, await memberRow(db, c.id, userId)) : null;
}

export function requireCommunityRead(access: CommunityAccess | null): CommunityAccess {
  if (!access) throw errors.notFound('Community');
  if (access.canRead) return access;
  if (access.community.visibility === 'invite') throw errors.notFound('Community');
  throw errors.forbidden('MEMBERS_ONLY', 'This community is private. Request to join to see it.');
}
export function requireMod(access: CommunityAccess): CommunityAccess {
  if (!access.isMod) throw errors.forbidden('MODS_ONLY', 'Only moderators can do that');
  return access;
}

export async function requireChannel(db: Db, channelId: string, userId: string, mode: 'read' | 'post') {
  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1);
  if (!channel) throw errors.notFound('Channel');
  const found = await getCommunityAccess(db, channel.communityId, userId);
  // Hidden (invite-only) channels must be indistinguishable from nonexistent ones.
  if (found && !found.canRead && found.community.visibility === 'invite') throw errors.notFound('Channel');
  const access = requireCommunityRead(found);
  if (mode === 'post' && !access.canPost) {
    if (access.member?.status === 'banned') throw errors.forbidden('BANNED', 'You are banned from this community');
    throw errors.forbidden('JOIN_TO_POST', 'Join the community to chat');
  }
  return { channel: channel as ChannelRow, access };
}

export async function requireConversationMember(db: Db, conversationId: string, userId: string): Promise<ConversationRow> {
  const rows = await db.select({ c: conversations }).from(conversations)
    .innerJoin(conversationMembers, eq(conversationMembers.conversationId, conversations.id))
    .where(and(eq(conversations.id, conversationId), eq(conversationMembers.userId, userId))).limit(1);
  if (!rows[0]) throw errors.notFound('Conversation');
  return rows[0].c;
}

export async function canReadPost(db: Db, post: PostRow, userId: string | null): Promise<boolean> {
  if (!post.communityId) return true;
  const access = await getCommunityAccess(db, post.communityId, userId);
  return !!access?.canRead;
}

export type MentionSource =
  | { kind: 'post'; communityVisibility: CommunityVisibility | null }
  | { kind: 'channel_message'; communityVisibility: CommunityVisibility }
  | { kind: 'conversation_message' };

export function computeMentionVisibility(src: MentionSource): boolean {
  switch (src.kind) {
    case 'post': return src.communityVisibility === null || src.communityVisibility === 'public';
    case 'channel_message': return src.communityVisibility === 'public';
    case 'conversation_message': return false;
  }
}

export async function isBlockedEitherWay(db: Db, a: string, b: string): Promise<boolean> {
  const rows = await db.select({ u: blocks.userId }).from(blocks).where(or(
    and(eq(blocks.userId, a), eq(blocks.targetId, b)),
    and(eq(blocks.userId, b), eq(blocks.targetId, a)),
  )).limit(1);
  return rows.length > 0;
}

export async function hiddenAuthorIds(db: Db, viewerId: string): Promise<string[]> {
  const [m, bOut, bIn] = await Promise.all([
    db.select({ id: mutes.targetId }).from(mutes).where(eq(mutes.userId, viewerId)),
    db.select({ id: blocks.targetId }).from(blocks).where(eq(blocks.userId, viewerId)),
    db.select({ id: blocks.userId }).from(blocks).where(eq(blocks.targetId, viewerId)),
  ]);
  return [...new Set([...m, ...bOut, ...bIn].map((r) => r.id))];
}
