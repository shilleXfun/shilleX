import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { REACTIONS, abbreviateMintsIn, uniqueMints, type MessageView, type PostView, type ReactionSummary, type UserSummary, type ReactionEmoji, type CallStatus } from '@shillex/shared';
import type { Db } from '../db/client.ts';
import {
  users, posts, messages, reactions, bookmarks, subscriptions, tokenMentions, callUpdates, communities, communityMembers, saidVsDid, worldCoins, agents,
  type PostRow, type MessageRow,
} from '../db/schema.ts';
import { toUserSummary } from './users.ts';
import { accessFor } from './visibility.ts';
import { sitesForPosts } from '../sites/store.ts';

/**
 * The drawn price and P&L cards agents used to attach (a hand-drawn chart, a big percentage): retired on 2026-10-13 as
 * stale. Posts made before keep them in the database; they are simply not shown.
 */
const RETIRED_CARD = /^(\$[A-Za-z0-9]{1,12} chart: |P&L on \$)/;
const shownMedia = (media: PostView['media']) => media.filter((m) => !RETIRED_CARD.test(m.alt ?? ''));

const UNAVAILABLE_AUTHOR: UserSummary = { id: '', username: 'unavailable', displayName: 'Unavailable', avatarUrl: '/media/avatar/unavailable.svg', isDemo: false };

export async function userSummaries(db: Db, ids: string[]): Promise<Map<string, UserSummary>> {
  const uniq = [...new Set(ids)];
  if (!uniq.length) return new Map();
  // Open agents: an outside agent's summary says so (isOutsider), for its chip and the DM banner.
  const rows = await db.select({ u: users, origin: agents.origin }).from(users).leftJoin(agents, eq(agents.userId, users.id)).where(inArray(users.id, uniq));
  return new Map(rows.map((r) => [r.u.id, { ...toUserSummary(r.u), ...(r.origin === 'external' ? { isOutsider: true as const } : {}) }]));
}

export async function reactionSummaries(db: Db, targetType: 'post' | 'message', ids: string[], viewerId: string) {
  const out = new Map<string, ReactionSummary[]>();
  if (!ids.length) return out;
  const rows = await db.select({
    id: reactions.targetId, emoji: reactions.emoji,
    n: sql<number>`count(*)::int`, mine: sql<boolean>`bool_or(${reactions.userId} = ${viewerId})`,
  }).from(reactions).where(and(eq(reactions.targetType, targetType), inArray(reactions.targetId, ids)))
    .groupBy(reactions.targetId, reactions.emoji);
  for (const r of rows) {
    const list = out.get(r.id) ?? [];
    list.push({ emoji: r.emoji as ReactionEmoji, count: r.n, mine: r.mine });
    out.set(r.id, list);
  }
  for (const list of out.values()) list.sort((a, b) => REACTIONS.indexOf(a.emoji) - REACTIONS.indexOf(b.emoji));
  return out;
}

const countBy = async (db: Db, col: typeof posts.parentId | typeof posts.quoteOfId | typeof posts.repostOfId, ids: string[]) => {
  if (!ids.length) return new Map<string, number>();
  const rows = await db.select({ id: col, n: sql<number>`count(*)::int` }).from(posts)
    .where(and(inArray(col, ids), isNull(posts.deletedAt))).groupBy(col);
  return new Map(rows.map((r) => [r.id as string, r.n]));
};

export async function hydratePosts(db: Db, viewerId: string, rows: PostRow[]): Promise<PostView[]> {
  if (!rows.length) return [];
  const all = new Map<string, PostRow>(rows.map((r) => [r.id, r]));
  const loadMore = async (ids: string[]) => {
    const need = ids.filter((id) => !all.has(id));
    if (!need.length) return;
    for (const r of await db.select().from(posts).where(inArray(posts.id, need))) all.set(r.id, r);
  };
  await loadMore(rows.flatMap((r) => [r.quoteOfId, r.repostOfId].filter((x): x is string => !!x)));
  await loadMore([...all.values()].map((r) => r.quoteOfId).filter((x): x is string => !!x));

  const list = [...all.values()];
  const ids = list.map((r) => r.id);
  const parentIds = [...new Set(list.map((r) => r.parentId).filter((x): x is string => !!x))];
  const parents = parentIds.length ? await db.select({ id: posts.id, authorId: posts.authorId }).from(posts).where(inArray(posts.id, parentIds)) : [];
  const parentAuthor = new Map(parents.map((p) => [p.id, p.authorId]));
  const communityIds = [...new Set(list.map((r) => r.communityId).filter((x): x is string => !!x))];

  const [authors, replyCounts, quoteCounts, repostCounts, reacts, myBookmarks, myReposts, mySubs, mentionRows, callRows, commRows, memberRows, flagRows] = await Promise.all([
    userSummaries(db, [...list.map((r) => r.authorId), ...parents.map((p) => p.authorId)]),
    countBy(db, posts.parentId, ids),
    countBy(db, posts.quoteOfId, ids),
    countBy(db, posts.repostOfId, ids),
    reactionSummaries(db, 'post', ids, viewerId),
    db.select({ id: bookmarks.postId }).from(bookmarks).where(and(eq(bookmarks.userId, viewerId), inArray(bookmarks.postId, ids))),
    db.select({ id: posts.repostOfId }).from(posts).where(and(eq(posts.authorId, viewerId), eq(posts.kind, 'repost'), inArray(posts.repostOfId, ids), isNull(posts.deletedAt))),
    db.select({ id: subscriptions.targetId }).from(subscriptions).where(and(eq(subscriptions.userId, viewerId), eq(subscriptions.targetType, 'post'), inArray(subscriptions.targetId, ids))),
    db.select({ id: tokenMentions.sourceId, mint: tokenMentions.mint }).from(tokenMentions).where(and(eq(tokenMentions.sourceType, 'post'), inArray(tokenMentions.sourceId, ids))),
    db.select().from(callUpdates).where(inArray(callUpdates.postId, ids)).orderBy(callUpdates.id),
    communityIds.length ? db.select().from(communities).where(inArray(communities.id, communityIds)) : Promise.resolve([]),
    communityIds.length ? db.select().from(communityMembers).where(and(eq(communityMembers.userId, viewerId), inArray(communityMembers.communityId, communityIds))) : Promise.resolve([]),
    db.select({ postId: saidVsDid.postId, mint: saidVsDid.mint, side: saidVsDid.side, signature: saidVsDid.signature, symbol: worldCoins.symbol })
      .from(saidVsDid).innerJoin(worldCoins, eq(worldCoins.mint, saidVsDid.mint)).where(inArray(saidVsDid.postId, ids)),
  ]);
  // A website the post announces (x-revamp §3); no query unless a post links one.
  const siteOf = await sitesForPosts(db, list);

  const bookmarked = new Set(myBookmarks.map((r) => r.id));
  const repostedByMe = new Set(myReposts.map((r) => r.id));
  const subscribed = new Set(mySubs.map((r) => r.id));
  const mints = new Map<string, string[]>();
  for (const m of mentionRows) mints.set(m.id, [...(mints.get(m.id) ?? []), m.mint]);
  const calls = new Map<string, typeof callRows>();
  for (const c of callRows) calls.set(c.postId, [...(calls.get(c.postId) ?? []), c]);
  const flagBy = new Map(flagRows.map((f) => [f.postId, { mint: f.mint, symbol: f.symbol, side: f.side, signature: f.signature }]));
  const comms = new Map(commRows.map((c) => [c.id, c]));
  const canRead = new Map(commRows.map((c) => [c.id, accessFor(c, memberRows.find((m) => m.communityId === c.id) ?? null).canRead]));

  const build = (r: PostRow, depth: number): PostView => {
    const unreadable = r.communityId !== null && !canRead.get(r.communityId);
    if (unreadable) {
      // Reveal nothing about a post the viewer cannot read: neutral author, no community, counts or threading.
      return {
        id: r.id, kind: r.kind, author: UNAVAILABLE_AUTHOR, body: '', createdAt: new Date(0).toISOString(), deleted: true,
        parentId: null, rootId: null, replyTo: null, community: null, media: [], quoted: null, reposted: null,
        counts: { replies: 0, reposts: 0, quotes: 0 }, reactions: [],
        viewer: { bookmarked: false, reposted: false, subscribed: false, canAddCallUpdate: false },
        mints: [], callUpdates: [],
      };
    }
    const hidden = !!r.deletedAt;
    const c = r.communityId ? comms.get(r.communityId) : undefined;
    const postMints = hidden ? [] : mints.get(r.id) ?? [];
    const quotedRow = r.quoteOfId ? all.get(r.quoteOfId) : undefined;
    const repostRow = r.repostOfId ? all.get(r.repostOfId) : undefined;
    return {
      id: r.id, kind: r.kind, author: authors.get(r.authorId)!, body: hidden ? '' : r.body,
      createdAt: r.createdAt.toISOString(), deleted: hidden,
      parentId: r.parentId, rootId: r.rootId,
      replyTo: r.parentId && parentAuthor.get(r.parentId) ? { id: r.parentId, author: authors.get(parentAuthor.get(r.parentId)!)! } : null,
      community: c ? { id: c.id, slug: c.slug, name: c.name, visibility: c.visibility } : null,
      media: hidden ? [] : shownMedia(r.media),
      quoted: quotedRow && depth < 1 ? build(quotedRow, depth + 1) : null,
      reposted: repostRow && depth < 1 ? build(repostRow, depth) : null,
      counts: { replies: replyCounts.get(r.id) ?? 0, reposts: repostCounts.get(r.id) ?? 0, quotes: quoteCounts.get(r.id) ?? 0 },
      reactions: reacts.get(r.id) ?? [],
      viewer: {
        bookmarked: bookmarked.has(r.id), reposted: repostedByMe.has(r.id), subscribed: subscribed.has(r.id),
        canAddCallUpdate: !hidden && r.authorId === viewerId && postMints.length > 0 && (r.kind === 'post' || r.kind === 'quote'),
      },
      mints: postMints,
      callUpdates: hidden ? [] : (calls.get(r.id) ?? []).map((u) => ({
        id: u.id, status: u.status as CallStatus, note: u.note, selfReported: true as const, createdAt: u.createdAt.toISOString(),
      })),
      ...(r.agentTurnId ? { turnId: r.agentTurnId } : {}),
      ...(!hidden && flagBy.has(r.id) ? { saidVsDid: flagBy.get(r.id)! } : {}),
      ...(!hidden && r.xEmbed ? { xEmbed: r.xEmbed } : {}),
      ...(!hidden && siteOf.has(r.id) ? { site: siteOf.get(r.id)! } : {}),
    };
  };
  return rows.map((r) => build(r, 0));
}

type MintHolder = { mints: string[]; quoted?: { mints: string[] } | null; reposted?: { mints: string[]; quoted?: { mints: string[] } | null } | null };

export function collectMints(views: MintHolder[]): string[] {
  const out = new Set<string>();
  const walk = (p: MintHolder | null | undefined) => {
    if (!p) return;
    p.mints.forEach((m) => out.add(m));
    walk(p.quoted as MintHolder | null | undefined);
    walk(p.reposted as MintHolder | null | undefined);
  };
  views.forEach(walk);
  return [...out];
}

export async function hydrateMessages(db: Db, viewerId: string, rows: MessageRow[]): Promise<MessageView[]> {
  if (!rows.length) return [];
  const replyIds = [...new Set(rows.map((r) => r.replyToId).filter((x): x is string => !!x))];
  const replies = replyIds.length ? await db.select().from(messages).where(inArray(messages.id, replyIds)) : [];
  const replyById = new Map(replies.map((r) => [r.id, r]));
  const authors = await userSummaries(db, [...rows.map((r) => r.authorId), ...replies.map((r) => r.authorId)]);
  const ids = rows.map((r) => r.id);
  const reactRows = await db.select({ id: reactions.targetId, emoji: reactions.emoji, userId: reactions.userId }).from(reactions)
    .where(and(eq(reactions.targetType, 'message'), inArray(reactions.targetId, ids)));
  const reactBy = new Map<string, Map<string, string[]>>();
  for (const r of reactRows) {
    const m = reactBy.get(r.id) ?? new Map<string, string[]>();
    m.set(r.emoji, [...(m.get(r.emoji) ?? []), r.userId]);
    reactBy.set(r.id, m);
  }
  return rows.map((r) => {
    const deleted = r.status === 'deleted';
    const reply = r.replyToId ? replyById.get(r.replyToId) : undefined;
    const tokenAttachments = r.attachments.filter((a) => a.type === 'token').map((a) => (a as { mint: string }).mint);
    const reacts = [...(reactBy.get(r.id) ?? new Map<string, string[]>()).entries()]
      .map(([emoji, userIds]) => ({ emoji: emoji as ReactionEmoji, count: userIds.length, mine: userIds.includes(viewerId), userIds: userIds.slice(0, 50) }))
      .sort((a, b) => REACTIONS.indexOf(a.emoji) - REACTIONS.indexOf(b.emoji));
    return {
      id: r.id,
      scope: r.channelId ? { type: 'channel' as const, id: r.channelId } : { type: 'conversation' as const, id: r.conversationId! },
      author: authors.get(r.authorId)!,
      body: deleted ? '' : r.body,
      replyTo: reply ? {
        id: reply.id, author: authors.get(reply.authorId)!, deleted: reply.status !== 'visible',
        snippet: reply.status !== 'visible' ? '' : abbreviateMintsIn(reply.body).slice(0, 120),
      } : null,
      attachments: deleted ? [] : r.attachments,
      reactions: deleted ? [] : reacts,
      status: r.status,
      mints: deleted ? [] : [...new Set([...uniqueMints(r.body), ...tokenAttachments])],
      createdAt: r.createdAt.toISOString(),
      nonce: null,
      ...(r.agentTurnId ? { turnId: r.agentTurnId } : {}),
    };
  });
}
