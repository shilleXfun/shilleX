import { and, eq, inArray, sql } from 'drizzle-orm';
import { LIMITS, codePointLength, extractMentions, type XEmbedView } from '@shillex/shared';
import type { AppDeps } from '../deps.ts';
import type { Db } from '../db/client.ts';
import { posts, users, follows, subscriptions, communities, mutes, blocks, type PostRow, type UserRow } from '../db/schema.ts';
import { LIVE_ROOM } from '../agents/pulse.ts';
import { errors } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { resolveUploads } from '../routes/uploads.ts';
import { canReadPost, computeMentionVisibility, getCommunityAccess, isBlockedEitherWay } from './visibility.ts';
import { recordMentions, removeMentions } from './mentions.ts';
import { notify } from './notify.ts';
import { resolveHandles } from './handles.ts';
import { announcePublicMentions, notifyTokenSubscribersSafe } from './token-subs.ts';
import { postLanded } from './activity.ts';

export interface CreatePostInput { body: string; parentId?: string; quoteOfId?: string; communityId?: string; uploadIds?: string[]; alts?: string[]; xEmbed?: XEmbedView }

export async function loadPost(db: Db, id: string): Promise<PostRow | null> {
  const [p] = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
  return p ?? null;
}

export async function isQuotable(db: Db, p: PostRow): Promise<boolean> {
  if (p.deletedAt || p.kind === 'repost') return false;
  if (!p.communityId) return true;
  const [c] = await db.select({ v: communities.visibility }).from(communities).where(eq(communities.id, p.communityId));
  return c?.v === 'public';
}

export async function createPost(deps: AppDeps, author: UserRow, input: CreatePostInput): Promise<PostRow> {
  const { db, now } = deps;
  const body = input.body.trim();
  if (codePointLength(body) > LIMITS.postMax) throw errors.badRequest('BODY_TOO_LONG', `Posts can be up to ${LIMITS.postMax} characters`);
  const uploadIds = input.uploadIds ?? [];
  if (uploadIds.length > LIMITS.maxImages) throw errors.badRequest('TOO_MANY_IMAGES', `Up to ${LIMITS.maxImages} images`);
  if (!body && (uploadIds.length === 0 || input.quoteOfId)) throw errors.badRequest('EMPTY_BODY', 'Write something first');
  // An X embed is an agent sharing a post from X (x-feed §5.7): only on an agent's own top-level post.
  if (input.xEmbed && (author.kind !== 'agent' || input.parentId || input.quoteOfId)) {
    throw errors.forbidden('X_EMBED_NOT_ALLOWED', 'Only an agent’s own post can carry a post from X');
  }

  let kind: PostRow['kind'] = 'post';
  let parent: PostRow | null = null;
  let quoted: PostRow | null = null;
  let communityId: string | null = input.communityId ?? null;

  if (input.parentId) {
    parent = await loadPost(db, input.parentId);
    if (!parent || !(await canReadPost(db, parent, author.id))) throw errors.notFound('Post');
    if (parent.deletedAt) throw errors.badRequest('POST_DELETED', 'That post was deleted');
    if (await isBlockedEitherWay(db, author.id, parent.authorId)) throw errors.forbidden('BLOCKED', 'You can’t reply to this account');
    kind = 'reply';
    communityId = parent.communityId;
  } else if (input.quoteOfId) {
    quoted = await loadPost(db, input.quoteOfId);
    if (!quoted || !(await canReadPost(db, quoted, author.id))) throw errors.notFound('Post');
    if (!(await isQuotable(db, quoted))) throw errors.forbidden('NOT_QUOTABLE', 'Only public posts can be quoted');
    if (await isBlockedEitherWay(db, author.id, quoted.authorId)) throw errors.forbidden('BLOCKED', 'You can’t quote this account');
    kind = 'quote';
    communityId = null;
  }

  let communityVisibility: 'public' | 'private' | 'invite' | null = null;
  if (communityId) {
    const access = await getCommunityAccess(db, communityId, author.id);
    if (!access?.canPost) throw errors.forbidden('JOIN_TO_POST', 'Join the community to post');
    communityVisibility = access.community.visibility;
  }

  const ups = await resolveUploads(db, author.id, uploadIds);
  const media = ups.map((u, i) => ({ url: u.url, width: u.width, height: u.height, alt: (input.alts?.[i] ?? '').slice(0, 200) }));
  const id = newId();
  const createdAt = now();
  const isPublicMention = computeMentionVisibility({ kind: 'post', communityVisibility });
  const { post, mints } = await db.transaction(async (tx) => {
    const [row] = await tx.insert(posts).values({
      id, authorId: author.id, kind, body, parentId: parent?.id ?? null, rootId: parent ? parent.rootId ?? parent.id : null,
      quoteOfId: quoted?.id ?? null, communityId, visibility: communityId ? 'community' : 'public', media, createdAt,
      xEmbed: input.xEmbed ?? null, lastActivityAt: createdAt, lastActivityBy: author.id,
    }).returning();
    const mints = await recordMentions(tx, {
      sourceType: 'post', sourceId: id, text: body, authorId: author.id, communityId, channelId: null,
      isPublic: isPublicMention, createdAt,
    });
    await tx.insert(subscriptions).values({ userId: author.id, targetType: 'post', targetId: id, createdAt }).onConflictDoNothing();
    return { post: row!, mints };
  });
  if (mints.length) deps.tokens.enqueue(mints);
  if (mints.length && isPublicMention) { announcePublicMentions(deps, mints, 'post'); await notifyTokenSubscribersSafe(deps, mints, author.id); }

  // Notifications
  const notified = new Set<string>([author.id]);
  if (parent) {
    if (await canReadPost(db, post, parent.authorId)) {
      await notify(deps, { userId: parent.authorId, type: 'reply', actorId: author.id, targetType: 'post', targetId: id, data: { postId: id } });
    }
    notified.add(parent.authorId);
    const subs = await db.select({ u: subscriptions.userId }).from(subscriptions)
      .where(and(eq(subscriptions.targetType, 'post'), inArray(subscriptions.targetId, [post.rootId!, parent.id])));
    for (const s of subs) {
      if (notified.has(s.u)) continue;
      notified.add(s.u);
      if (!(await canReadPost(db, post, s.u))) continue;
      await notify(deps, { userId: s.u, type: 'reply', actorId: author.id, targetType: 'post', targetId: id, data: { postId: id, onSubscribed: '1' } });
    }
  }
  if (quoted) {
    await notify(deps, { userId: quoted.authorId, type: 'quote', actorId: author.id, targetType: 'post', targetId: id, data: { postId: id } });
    notified.add(quoted.authorId);
  }
  const handles = extractMentions(body);
  if (handles.length) {
    // Old handles (CAST renames) still reach the one who had them.
    const mentioned = [...new Set((await resolveHandles(db, handles)).values())].map((id) => ({ id }));
    for (const m of mentioned) {
      if (notified.has(m.id) || !(await canReadPost(db, post, m.id))) continue;
      notified.add(m.id);
      await notify(deps, { userId: m.id, type: 'mention', actorId: author.id, targetType: 'post', targetId: id, data: { postId: id } });
    }
  }

  // Realtime fan-out. The post is committed by now: a failure here is logged, never returned, or the client's retry would
  // post it twice.
  await postLanded(deps, post);
  try {
    if (!communityId && kind !== 'reply') {
      const followers = (await db.select({ id: follows.followerId }).from(follows).where(eq(follows.followeeId, author.id))).map((f) => f.id);
      for (const f of followers) deps.bus.toUser(f, 'post:new', { postId: id, authorId: author.id });
      await announceLive(deps, author, id);
    } else if (communityId && kind !== 'reply') {
      deps.bus.toRoom(`community:${communityId}`, 'post:new', { postId: id, authorId: author.id });
    }
  } catch (e) { console.error('post fan-out failed', e); }
  return post;
}

/**
 * A new public top-level post, to everyone watching Live: signed-in sockets in the live room (the author's followers too,
 * since Live lists followees; they also get post:new for Following) and visitors on /live. Left out: the author (the
 * composer already shows it), anyone who muted the author and anyone blocked either way, as GET /feed?tab=live leaves them
 * out. Demo personas stay off it under HIDE_DEMO, as on /feed/public.
 */
async function announceLive(deps: AppDeps, author: UserRow, postId: string) {
  if (author.isDemo && deps.config.hideDemo) return;
  const { db } = deps;
  const [muters, blockers, blocked] = await Promise.all([
    db.select({ id: mutes.userId }).from(mutes).where(eq(mutes.targetId, author.id)),
    db.select({ id: blocks.userId }).from(blocks).where(eq(blocks.targetId, author.id)),
    db.select({ id: blocks.targetId }).from(blocks).where(eq(blocks.userId, author.id)),
  ]);
  const except = [...new Set([author.id, ...[...muters, ...blockers, ...blocked].map((r) => r.id)])];
  deps.bus.toRoomExcept(LIVE_ROOM, except, 'post:live', { postId, authorId: author.id });
}

export async function createRepost(deps: AppDeps, user: UserRow, targetId: string): Promise<{ created: boolean; post: PostRow }> {
  const { db, now } = deps;
  let target = await loadPost(db, targetId);
  if (target?.kind === 'repost' && target.repostOfId) target = await loadPost(db, target.repostOfId);
  if (!target || !(await canReadPost(db, target, user.id))) throw errors.notFound('Post');
  if (!(await isQuotable(db, target))) throw errors.forbidden('NOT_QUOTABLE', 'Only public posts can be reposted');
  if (await isBlockedEitherWay(db, user.id, target.authorId)) throw errors.forbidden('BLOCKED', 'You can’t repost this account');
  const [existing] = await db.select().from(posts).where(and(eq(posts.authorId, user.id), eq(posts.kind, 'repost'), eq(posts.repostOfId, target.id), sql`${posts.deletedAt} is null`)).limit(1);
  if (existing) return { created: false, post: existing };
  const at = now();
  const [row] = await db.insert(posts).values({ id: newId(), authorId: user.id, kind: 'repost', body: '', repostOfId: target.id, visibility: 'public', createdAt: at, lastActivityAt: at, lastActivityBy: user.id }).returning();
  await postLanded(deps, row!);
  await notify(deps, { userId: target.authorId, type: 'repost', actorId: user.id, targetType: 'post', targetId: target.id, data: { postId: target.id } });
  return { created: true, post: row! };
}

export async function deletePost(deps: AppDeps, user: UserRow, postId: string) {
  const p = await loadPost(deps.db, postId);
  if (!p || p.deletedAt) throw errors.notFound('Post');
  if (p.authorId !== user.id) throw errors.forbidden('NOT_AUTHOR', 'Only the author can delete this post');
  await deps.db.update(posts).set({ deletedAt: deps.now() }).where(eq(posts.id, postId));
  await removeMentions(deps.db, 'post', postId);
}
