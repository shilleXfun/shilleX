import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { abbreviateMint, extractMintCandidates, type NotificationType, type NotificationView } from '@shillex/shared';
import type { AppDeps } from '../deps.ts';
import type { Db } from '../db/client.ts';
import { channels, messages, notifications, notificationPrefs, mutes, posts } from '../db/schema.ts';
import { newId } from '../lib/ids.ts';
import { getCommunityAccess, isBlockedEitherWay } from './visibility.ts';
import { userSummaries } from './hydrate.ts';

export interface NotifyInput {
  userId: string; type: NotificationType; actorId: string | null;
  targetType: NotificationView['target']['type']; targetId: string; data?: Record<string, string>;
}

export function describeNotification(type: NotificationType, actor: string, d: Record<string, string>): { text: string; href: string } {
  switch (type) {
    case 'reply': return { text: `${actor} replied to ${d.onSubscribed ? 'a conversation you follow' : 'your post'}`, href: `/p/${d.postId}` };
    case 'mention': return { text: `${actor} mentioned you`, href: d.href ?? `/p/${d.postId}` };
    case 'follow': return { text: `${actor} followed you`, href: `/u/${d.username}` };
    case 'reaction': return { text: `${actor} reacted ${d.emoji} to your post`, href: `/p/${d.postId}` };
    case 'quote': return { text: `${actor} quoted your post`, href: `/p/${d.postId}` };
    case 'repost': return { text: `${actor} reposted your post`, href: `/p/${d.postId}` };
    case 'dm': return { text: `${actor} started a conversation with you`, href: `/messages/${d.conversationId}` };
    case 'call_update': return { text: `${actor} posted a call update: ${d.label} (self-reported)`, href: `/p/${d.postId}` };
    case 'token_discussion': return { text: `New public discussion of ${d.symbol ? `$${d.symbol}` : abbreviateMint(d.mint ?? '')}`, href: `/discover?token=${d.mint}` };
    case 'invite': return { text: `${actor} invited you to ${d.communityName}`, href: `/invite/${d.code}` };
    case 'join_request': return { text: `${actor} requested to join ${d.communityName}`, href: `/c/${d.slug}?tab=requests` };
    case 'report_resolved': return { text: 'A report you filed was reviewed', href: '/notifications' };
  }
}

const EXCERPT_MAX = 140;

/** A single line of post or message text: contract addresses shortened, whitespace collapsed, cut at EXCERPT_MAX. */
export function excerptOf(body: string): string | null {
  let t = body;
  for (const c of extractMintCandidates(body).reverse()) t = t.slice(0, c.start) + abbreviateMint(c.mint) + t.slice(c.end);
  const chars = [...t.replace(/\s+/g, ' ').trim()];
  if (!chars.length) return null;
  return chars.length > EXCERPT_MAX ? `${chars.slice(0, EXCERPT_MAX - 1).join('').trimEnd()}…` : chars.join('');
}

/**
 * Excerpts keyed `post:id` / `message:id`. Re-checked at read time: deleted or held content and communities the
 * viewer can no longer read (left, banned, went private) yield nothing, even though the notification itself stays.
 */
async function excerpts(db: Db, viewerId: string, rows: (typeof notifications.$inferSelect)[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = (type: string) => [...new Set(rows.filter((r) => r.targetType === type).map((r) => r.targetId))];
  const postIds = ids('post'), messageIds = ids('message');
  const readable = new Map<string, boolean>();
  const canRead = async (communityId: string | null) => {
    if (!communityId) return true;
    if (!readable.has(communityId)) readable.set(communityId, !!(await getCommunityAccess(db, communityId, viewerId))?.canRead);
    return readable.get(communityId)!;
  };
  const add = (key: string, body: string) => { const e = excerptOf(body); if (e) out.set(key, e); };
  if (postIds.length) {
    const found = await db.select({ id: posts.id, body: posts.body, communityId: posts.communityId }).from(posts)
      .where(and(inArray(posts.id, postIds), isNull(posts.deletedAt)));
    for (const p of found) if (await canRead(p.communityId)) add(`post:${p.id}`, p.body);
  }
  if (messageIds.length) {
    // Message notifications are channel mentions; conversation messages never get an excerpt here.
    const found = await db.select({ id: messages.id, body: messages.body, communityId: channels.communityId }).from(messages)
      .innerJoin(channels, eq(channels.id, messages.channelId))
      .where(and(inArray(messages.id, messageIds), eq(messages.status, 'visible')));
    for (const m of found) if (await canRead(m.communityId)) add(`message:${m.id}`, m.body);
  }
  return out;
}

export async function toNotificationViews(db: Db, rows: (typeof notifications.$inferSelect)[]): Promise<NotificationView[]> {
  if (!rows.length) return [];
  const [actors, excerpt] = await Promise.all([
    userSummaries(db, rows.map((r) => r.actorId).filter((x): x is string => !!x)),
    excerpts(db, rows[0]!.userId, rows),
  ]);
  return rows.map((r) => {
    const actor = r.actorId ? actors.get(r.actorId) ?? null : null;
    const { text, href } = describeNotification(r.type as NotificationType, actor?.displayName ?? 'Someone', r.data);
    return { id: r.id, type: r.type as NotificationType, actor, target: { type: r.targetType as NotificationView['target']['type'], id: r.targetId },
      text, href, read: !!r.readAt, createdAt: r.createdAt.toISOString(), excerpt: excerpt.get(`${r.targetType}:${r.targetId}`) ?? null };
  });
}

export async function unreadCount(db: Db, userId: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return row?.n ?? 0;
}

export async function notify(deps: Pick<AppDeps, 'db' | 'bus' | 'now'>, n: NotifyInput): Promise<void> {
  const { db, bus, now } = deps;
  if (n.actorId && n.actorId === n.userId) return;
  if (n.actorId) {
    if (await isBlockedEitherWay(db, n.userId, n.actorId)) return;
    const muted = await db.select().from(mutes).where(and(eq(mutes.userId, n.userId), eq(mutes.targetId, n.actorId))).limit(1);
    if (muted.length) return;
  }
  const [pref] = await db.select().from(notificationPrefs)
    .where(and(eq(notificationPrefs.userId, n.userId), eq(notificationPrefs.type, n.type))).limit(1);
  if (pref && !pref.enabled) return;
  const [row] = await db.insert(notifications).values({
    id: newId(), userId: n.userId, type: n.type, actorId: n.actorId, targetType: n.targetType, targetId: n.targetId,
    data: n.data ?? {}, createdAt: now(),
  }).returning();
  const [view] = await toNotificationViews(db, [row!]);
  bus.toUser(n.userId, 'notification:new', { notification: view, unreadCount: await unreadCount(db, n.userId) });
}

export async function notifyMany(deps: Pick<AppDeps, 'db' | 'bus' | 'now'>, userIds: Iterable<string>, base: Omit<NotifyInput, 'userId'>) {
  for (const userId of new Set(userIds)) await notify(deps, { ...base, userId });
}
