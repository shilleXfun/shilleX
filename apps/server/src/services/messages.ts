import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { LIMITS, codePointLength, extractMentions, isValidSolanaAddress, type ScopeRef, type TokenView, type MessageView } from '@shillex/shared';
import type { AppDeps } from '../deps.ts';
import type { Db } from '../db/client.ts';
import { messages, reactions, channels, communities, communityMembers, conversationMembers, users, type ChannelRow, type MessageRow, type UserRow } from '../db/schema.ts';
import { AppError, errors } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { resolveUploads } from '../routes/uploads.ts';
import { computeMentionVisibility, getCommunityAccess, isBlockedEitherWay, requireChannel, requireConversationMember } from './visibility.ts';
import { recordMentions, removeMentions } from './mentions.ts';
import { notify } from './notify.ts';
import { hydrateMessages } from './hydrate.ts';
import { markRead } from './unread.ts';
import { checkSlowMode, isNewAccount, linkMentionCount, type MessageGuards } from './moderation.ts';

export type AttachmentInput = { type: 'image'; uploadId: string; alt?: string } | { type: 'token'; mint: string };
export interface SendMessageInput { scope: ScopeRef; author: UserRow; body: string; replyToId?: string; attachments?: AttachmentInput[]; nonce?: string }

export async function memberIdsOf(db: Db, conversationId: string): Promise<string[]> {
  return (await db.select({ u: conversationMembers.userId }).from(conversationMembers).where(eq(conversationMembers.conversationId, conversationId))).map((r) => r.u);
}
export async function modIdsOf(db: Db, communityId: string): Promise<string[]> {
  return (await db.select({ u: communityMembers.userId }).from(communityMembers).where(and(
    eq(communityMembers.communityId, communityId), eq(communityMembers.status, 'active'), inArray(communityMembers.role, ['owner', 'mod'])))).map((r) => r.u);
}

export async function emitMessage(deps: Pick<AppDeps, 'db' | 'bus'>, row: MessageRow, event: 'message:new' | 'message:update', extra: Record<string, unknown> = {}) {
  const [view] = await hydrateMessages(deps.db, '', [row]);
  const payload = { message: view, ...extra };
  if (row.conversationId) {
    for (const u of await memberIdsOf(deps.db, row.conversationId)) deps.bus.toUser(u, event, payload);
    return;
  }
  const [ch] = await deps.db.select().from(channels).where(eq(channels.id, row.channelId!));
  if (!ch) return;
  if (row.status === 'held') {
    for (const u of new Set([row.authorId, ...(await modIdsOf(deps.db, ch.communityId))])) deps.bus.toUser(u, event, payload);
    return;
  }
  deps.bus.toRoom(`channel:${ch.id}`, event, payload);
}

export async function sendMessage(deps: AppDeps, guards: MessageGuards, input: SendMessageInput): Promise<{ row: MessageRow; view: MessageView; tokens: Record<string, TokenView> }> {
  const { db, now } = deps;
  const at = now();
  const body = input.body.trim();
  const atts = input.attachments ?? [];
  if (codePointLength(body) > LIMITS.messageMax) throw errors.badRequest('BODY_TOO_LONG', `Messages can be up to ${LIMITS.messageMax} characters`);
  if (!body && !atts.length) throw errors.badRequest('EMPTY_BODY', 'Write something first');
  if (atts.filter((a) => a.type === 'image').length > LIMITS.maxImages || atts.filter((a) => a.type === 'token').length > 1) {
    throw errors.badRequest('TOO_MANY_ATTACHMENTS', 'Up to 4 images and 1 token card');
  }

  let channel: ChannelRow | null = null;
  let isMod = false;
  let communityVisibility: 'public' | 'private' | 'invite' | null = null;
  let memberJoinedAt: Date | null = null;
  if (input.scope.type === 'channel') {
    const r = await requireChannel(db, input.scope.id, input.author.id, 'post');
    channel = r.channel; isMod = r.access.isMod; communityVisibility = r.access.community.visibility;
    memberJoinedAt = r.access.member!.joinedAt;
  } else {
    const conv = await requireConversationMember(db, input.scope.id, input.author.id);
    if (conv.kind === 'dm') {
      const others = (await memberIdsOf(db, conv.id)).filter((u) => u !== input.author.id);
      for (const o of others) if (await isBlockedEitherWay(db, input.author.id, o)) throw errors.forbidden('BLOCKED', 'You can’t message this account');
    }
  }

  if (input.replyToId) {
    const [target] = await db.select().from(messages).where(eq(messages.id, input.replyToId));
    const same = target && (channel ? target.channelId === channel.id : target.conversationId === input.scope.id);
    if (!same || target.status === 'held') throw errors.badRequest('BAD_REPLY', 'You can only reply within the same conversation');
  }

  const imageIds = atts.filter((a) => a.type === 'image').map((a) => (a as { uploadId: string }).uploadId);
  const ups = await resolveUploads(db, input.author.id, imageIds);
  const attachments: MessageRow['attachments'] = [];
  let upIdx = 0;
  for (const a of atts) {
    if (a.type === 'image') { const u = ups[upIdx++]!; attachments.push({ type: 'image', url: u.url, width: u.width, height: u.height, alt: (a.alt ?? '').slice(0, 200) }); }
    else {
      if (!isValidSolanaAddress(a.mint)) throw errors.badRequest('INVALID_ADDRESS', 'Token card needs a valid mint address');
      attachments.push({ type: 'token', mint: a.mint });
    }
  }

  if (isNewAccount(input.author.createdAt, at) && linkMentionCount(body) > LIMITS.newAccountLinkMentionCap) {
    throw errors.badRequest('TOO_MANY_LINKS', `New accounts can include up to ${LIMITS.newAccountLinkMentionCap} links, mentions or addresses per message`);
  }
  const rate = guards.rate.hit(input.author.id, at.getTime());
  if (!rate.ok) throw errors.tooMany('RATE_LIMITED', 'You’re sending messages too fast', rate.retryAfterSec);
  if (channel && channel.slowModeSeconds > 0 && !isMod) {
    const [last] = await db.select({ at: messages.createdAt }).from(messages)
      .where(and(eq(messages.channelId, channel.id), eq(messages.authorId, input.author.id))).orderBy(desc(messages.id)).limit(1);
    const sm = checkSlowMode(last?.at ?? null, channel.slowModeSeconds, at);
    if (!sm.ok) throw new AppError(429, 'SLOW_MODE', `Slow mode is on — wait ${sm.retryAfterSec}s`, { retryAfterSec: sm.retryAfterSec });
  }
  if (body && guards.dupes.isDuplicate(input.author.id, body, at.getTime())) throw errors.tooMany('DUPLICATE', 'You just sent that');

  const held = !!channel && channel.holdNewMemberPosts && !isMod && !!memberJoinedAt && isNewAccount(memberJoinedAt, at);
  const [row] = await db.insert(messages).values({
    id: newId(), channelId: channel?.id ?? null, conversationId: channel ? null : input.scope.id, authorId: input.author.id,
    body, replyToId: input.replyToId ?? null, attachments, status: held ? 'held' : 'visible', createdAt: at,
  }).returning();
  const msg = row!;
  if (!held) await afterVisible(deps, msg, channel, communityVisibility);
  await markRead(db, input.author.id, channel ? 'channel' : 'conversation', input.scope.id, msg.id);

  const [view] = await hydrateMessages(db, input.author.id, [msg]);
  view!.nonce = input.nonce ?? null;
  const tokens = await deps.tokens.getViews(view!.mints);
  await emitMessage(deps, msg, 'message:new', { tokens, nonce: input.nonce ?? null });
  if (channel && !held) {
    deps.bus.toRoom(`community:${channel.communityId}`, 'channel:activity', {
      communityId: channel.communityId, channelId: channel.id, messageId: msg.id, authorId: msg.authorId, mentions: extractMentions(body),
    });
  }
  return { row: msg, view: view!, tokens };
}

/** Side effects that happen once a message is visible: mentions, token resolution, @mention notifications. */
export async function afterVisible(deps: AppDeps, msg: MessageRow, channel: ChannelRow | null, communityVisibility: 'public' | 'private' | 'invite' | null) {
  const { db } = deps;
  const tokenMints = msg.attachments.filter((a) => a.type === 'token').map((a) => (a as { mint: string }).mint);
  const isPublic = channel ? computeMentionVisibility({ kind: 'channel_message', communityVisibility: communityVisibility! }) : computeMentionVisibility({ kind: 'conversation_message' });
  const mints = await recordMentions(db, {
    sourceType: 'message', sourceId: msg.id, text: msg.body, authorId: msg.authorId,
    communityId: channel?.communityId ?? null, channelId: channel?.id ?? null, isPublic, createdAt: msg.createdAt, extraMints: tokenMints,
  });
  if (mints.length) deps.tokens.enqueue(mints);
  if (channel) {
    const handles = extractMentions(msg.body);
    if (handles.length) {
      const [c] = await db.select({ slug: communities.slug }).from(communities).where(eq(communities.id, channel.communityId));
      const mentioned = await db.select({ id: users.id }).from(users).where(inArray(sql`lower(${users.username})`, handles));
      for (const m of mentioned) {
        const access = await getCommunityAccess(db, channel.communityId, m.id);
        if (!access?.canRead) continue;
        await notify(deps, { userId: m.id, type: 'mention', actorId: msg.authorId, targetType: 'message', targetId: msg.id,
          data: { href: `/c/${c!.slug}/${channel.id}?m=${msg.id}` } });
      }
    }
  }
  return { mints, isPublic };
}

export async function loadMessageAccess(db: Db, messageId: string, userId: string): Promise<{ row: MessageRow; isMod: boolean; channel: ChannelRow | null }> {
  const [row] = await db.select().from(messages).where(eq(messages.id, messageId));
  if (!row) throw errors.notFound('Message');
  if (row.conversationId) {
    await requireConversationMember(db, row.conversationId, userId);
    return { row, isMod: false, channel: null };
  }
  const { channel, access } = await requireChannel(db, row.channelId!, userId, 'read');
  if (row.status === 'held' && row.authorId !== userId && !access.isMod) throw errors.notFound('Message');
  return { row, isMod: access.isMod, channel };
}

/**
 * Removes a message. Held messages were never public, so they are hard-deleted and only the author and
 * moderators are told; visible messages become tombstones broadcast to the scope.
 */
export async function removeMessage(deps: AppDeps, row: MessageRow): Promise<void> {
  const { db } = deps;
  await removeMentions(db, 'message', row.id);
  if (row.status === 'held') {
    await db.delete(reactions).where(and(eq(reactions.targetType, 'message'), eq(reactions.targetId, row.id)));
    await db.delete(messages).where(eq(messages.id, row.id));
    const [ch] = await db.select().from(channels).where(eq(channels.id, row.channelId!));
    const [view] = await hydrateMessages(db, '', [{ ...row, status: 'deleted' }]);
    const targets = new Set([row.authorId, ...(ch ? await modIdsOf(db, ch.communityId) : [])]);
    for (const u of targets) deps.bus.toUser(u, 'message:update', { message: view });
    return;
  }
  const [upd] = await db.update(messages).set({ status: 'deleted' }).where(eq(messages.id, row.id)).returning();
  await emitMessage(deps, upd!, 'message:update');
}
