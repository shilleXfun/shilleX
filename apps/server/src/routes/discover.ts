import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gt, inArray, notInArray, sql } from 'drizzle-orm';
import type { DiscoverView, LiveRoomView, NewCoinView, PersonSuggestion, SidebarView } from '@shillex/shared';
import { channels, communities, communityMembers, follows, messages, posts, tokenMentions, tokens, users } from '../db/schema.ts';
import { requireUser } from '../lib/auth.ts';
import { hiddenAuthorIds } from '../services/visibility.ts';
import { communitySummaries, communityAvatar } from '../services/communities.ts';
import { tokenRowToView } from '../tokens/view.ts';
import { toUserSummary } from '../services/users.ts';

const DISCOVER_COMMUNITY_POOL = 50;

export default async function discoverRoutes(app: FastifyInstance) {
  const deps = app.deps;
  const { db, now, presence, config } = deps;

  async function liveRooms(limit: number): Promise<LiveRoomView[]> {
    const t = now().getTime();
    const since15 = new Date(t - 15 * 60_000);
    const since24 = new Date(t - 24 * 3600_000);
    const rows = await db.select({
      ch: channels, c: communities,
      recent: sql<number>`count(*) filter (where ${messages.createdAt} > ${since15})::int`,
      last: sql<Date>`max(${messages.createdAt})`,
    }).from(messages).innerJoin(channels, eq(channels.id, messages.channelId)).innerJoin(communities, eq(communities.id, channels.communityId))
      .where(and(eq(communities.visibility, 'public'), eq(messages.status, 'visible'), gt(messages.createdAt, since24)))
      .groupBy(channels.id, communities.id)
      .orderBy(sql`count(*) filter (where ${messages.createdAt} > ${since15}) desc`, sql`max(${messages.createdAt}) desc`).limit(limit);
    const out: LiveRoomView[] = [];
    for (const r of rows) {
      const memberIds = (await db.select({ u: communityMembers.userId }).from(communityMembers).where(and(eq(communityMembers.communityId, r.c.id), eq(communityMembers.status, 'active')))).map((m) => m.u);
      out.push({
        community: { id: r.c.id, slug: r.c.slug, name: r.c.name, visibility: r.c.visibility, avatarUrl: communityAvatar(r.c) },
        channel: { id: r.ch.id, name: r.ch.name }, messagesLast15m: r.recent, onlineCount: presence.countOnline(memberIds),
        lastActivityAt: new Date(r.last).toISOString(),
      });
    }
    return out;
  }

  async function coins(limit: number): Promise<{ newCoins: NewCoinView[]; promoted: NewCoinView[] }> {
    const since = new Date(now().getTime() - 24 * 3600_000);
    const firsts = await db.select({
      mint: tokenMentions.mint, first: sql<Date>`min(${tokenMentions.createdAt})`,
      m24: sql<number>`count(*) filter (where ${tokenMentions.createdAt} > ${since})::int`,
    }).from(tokenMentions).where(eq(tokenMentions.isPublic, true)).groupBy(tokenMentions.mint)
      .orderBy(sql`min(${tokenMentions.createdAt}) desc`).limit(200);
    if (!firsts.length) return { newCoins: [], promoted: [] };
    const rows = await db.select().from(tokens).where(and(inArray(tokens.mint, firsts.map((f) => f.mint)), inArray(tokens.status, ['resolved', 'unindexed'])));
    const byMint = new Map(rows.map((r) => [r.mint, r]));
    const all: NewCoinView[] = firsts.filter((f) => byMint.has(f.mint)).map((f) => {
      const r = byMint.get(f.mint)!;
      return { token: tokenRowToView(r), firstMentionAt: new Date(f.first).toISOString(), mentions24h: f.m24, promoted: r.promoted };
    });
    return { newCoins: all.filter((c) => !c.promoted).slice(0, limit), promoted: all.filter((c) => c.promoted).slice(0, 3) };
  }

  async function people(viewerId: string, limit: number): Promise<PersonSuggestion[]> {
    const hidden = await hiddenAuthorIds(db, viewerId);
    const followed = (await db.select({ id: follows.followeeId }).from(follows).where(eq(follows.followerId, viewerId))).map((r) => r.id);
    const exclude = [...new Set([viewerId, ...hidden, ...followed])];
    const since = new Date(now().getTime() - 7 * 24 * 3600_000);
    const rows = await db.select({
      u: users,
      activity: sql<number>`(select count(*)::int from ${posts} p where p.author_id = "users"."id" and p.created_at > ${since} and p.deleted_at is null and p.community_id is null)
        + (select count(*)::int from ${messages} m join ${channels} ch on ch.id = m.channel_id join ${communities} co on co.id = ch.community_id where m.author_id = "users"."id" and m.created_at > ${since} and m.status = 'visible' and co.visibility = 'public')`,
      followers: sql<number>`(select count(*)::int from ${follows} f where f.followee_id = "users"."id")`,
    }).from(users).where(notInArray(users.id, exclude)).orderBy(desc(sql`2`)).limit(limit * 3);
    const viaFollowed = followed.length ? await db.select({ followee: follows.followeeId, via: users.username }).from(follows)
      .innerJoin(users, eq(users.id, follows.followerId)).where(inArray(follows.followerId, followed)) : [];
    return rows.filter((r) => r.activity > 0 || r.followers > 0).slice(0, limit).map((r) => {
      const via = viaFollowed.find((v) => v.followee === r.u.id);
      return { user: toUserSummary(r.u), bio: r.u.bio, followers: r.followers, reason: via ? `Followed by @${via.via}` : 'Active this week' };
    });
  }

  app.get('/discover', async (req) => {
    const me = requireUser(req);
    const commRows = await db.select().from(communities).where(eq(communities.visibility, 'public'))
      .orderBy(desc(sql`(select count(*) from ${communityMembers} cm where cm.community_id = "communities"."id" and cm.status = 'active')`), communities.id).limit(DISCOVER_COMMUNITY_POOL);
    const summaries = (await communitySummaries(deps, me.id, commRows))
      .sort((a, b) => b.onlineCount - a.onlineCount || b.memberCount - a.memberCount).slice(0, 8);
    const { newCoins, promoted } = await coins(20);
    const view: DiscoverView = { liveRooms: await liveRooms(8), communities: summaries, people: await people(me.id, 8), newCoins, promoted };
    return view;
  });

  app.get('/sidebar', async (req) => {
    const me = requireUser(req);
    const { newCoins, promoted } = await coins(5);
    const view: SidebarView = { liveRooms: await liveRooms(5), people: await people(me.id, 3), newCoins, promoted: promoted[0] ?? null, demoSimulator: config.demoSimulator };
    return view;
  });
}
