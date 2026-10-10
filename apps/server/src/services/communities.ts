import { and, eq, inArray, max } from 'drizzle-orm';
import { generatedBannerUrl, type ChannelView, type CommunityDetail, type CommunitySummary } from '@shillex/shared';
import type { AppDeps } from '../deps.ts';
import type { Db } from '../db/client.ts';
import { channels, communityMembers, messages, users, type ChannelRow, type CommunityRow, type MemberRow } from '../db/schema.ts';
import { toUserSummary } from './users.ts';
import { unreadInScope } from './unread.ts';
import type { CommunityAccess } from './visibility.ts';

export const communityAvatar = (c: Pick<CommunityRow, 'id' | 'avatarUrl'>) => c.avatarUrl ?? `/media/avatar/c${c.id}.svg`;

export async function channelViews(db: Db, viewerId: string, rows: ChannelRow[], member: MemberRow | null): Promise<ChannelView[]> {
  if (!rows.length) return [];
  const last = await db.select({ ch: messages.channelId, id: max(messages.id) }).from(messages)
    .where(and(inArray(messages.channelId, rows.map((r) => r.id)), eq(messages.status, 'visible'))).groupBy(messages.channelId);
  const lastBy = new Map(last.map((l) => [l.ch!, l.id]));
  const active = member?.status === 'active';
  const out: ChannelView[] = [];
  for (const r of [...rows].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))) {
    out.push({
      id: r.id, communityId: r.communityId, name: r.name, topic: r.topic, position: r.position,
      slowModeSeconds: r.slowModeSeconds, holdNewMemberPosts: r.holdNewMemberPosts,
      unread: active ? await unreadInScope(db, { userId: viewerId, scopeType: 'channel', scopeId: r.id, since: member!.joinedAt }) : 0,
      lastMessageId: lastBy.get(r.id) ?? null,
    });
  }
  return out;
}

export async function communitySummaries(deps: Pick<AppDeps, 'db' | 'presence'>, viewerId: string, rows: CommunityRow[]): Promise<CommunitySummary[]> {
  const { db, presence } = deps;
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [members, mine, chans] = await Promise.all([
    db.select({ c: communityMembers.communityId, u: communityMembers.userId }).from(communityMembers)
      .where(and(inArray(communityMembers.communityId, ids), eq(communityMembers.status, 'active'))),
    db.select().from(communityMembers).where(and(inArray(communityMembers.communityId, ids), eq(communityMembers.userId, viewerId))),
    db.select().from(channels).where(inArray(channels.communityId, ids)),
  ]);
  const out: CommunitySummary[] = [];
  for (const c of rows) {
    const memberIds = members.filter((m) => m.c === c.id).map((m) => m.u);
    const me = mine.find((m) => m.communityId === c.id) ?? null;
    let unread = 0;
    if (me?.status === 'active') {
      for (const ch of chans.filter((x) => x.communityId === c.id)) {
        unread += await unreadInScope(db, { userId: viewerId, scopeType: 'channel', scopeId: ch.id, since: me.joinedAt });
      }
    }
    out.push({
      id: c.id, slug: c.slug, name: c.name, description: c.description, avatarUrl: communityAvatar(c), visibility: c.visibility,
      memberCount: memberIds.length, onlineCount: presence.countOnline(memberIds),
      myRole: me ? me.role : null, myStatus: me ? me.status : null, unread: Math.min(unread, 99), isDemo: c.isDemo,
    });
  }
  return out;
}

export async function communityDetail(deps: Pick<AppDeps, 'db' | 'presence'>, viewerId: string, access: CommunityAccess): Promise<CommunityDetail> {
  const { db } = deps;
  const c = access.community;
  const [summary] = await communitySummaries(deps, viewerId, [c]);
  if (!access.canRead) {
    return { community: summary!, bannerUrl: null, rules: '', createdAt: c.createdAt.toISOString(), owner: null, moderators: [], canRead: false, canPost: false, isMod: false, channels: [] };
  }
  const [ownerRow] = await db.select().from(users).where(eq(users.id, c.ownerId));
  const mods = await db.select({ u: users }).from(communityMembers).innerJoin(users, eq(users.id, communityMembers.userId))
    .where(and(eq(communityMembers.communityId, c.id), eq(communityMembers.status, 'active'), eq(communityMembers.role, 'mod')));
  const chans = await db.select().from(channels).where(eq(channels.communityId, c.id));
  return {
    community: summary!, bannerUrl: c.bannerUrl ?? generatedBannerUrl(`c${c.id}`), rules: c.rules, createdAt: c.createdAt.toISOString(),
    owner: ownerRow ? toUserSummary(ownerRow) : null, moderators: mods.map((m) => toUserSummary(m.u)),
    canRead: true, canPost: access.canPost, isMod: access.isMod,
    channels: await channelViews(db, viewerId, chans, access.member),
  };
}

export async function evictFromCommunity(deps: Pick<AppDeps, 'db' | 'bus'>, userId: string, communityId: string) {
  deps.bus.evict(userId, `community:${communityId}`);
  const chans = await deps.db.select({ id: channels.id }).from(channels).where(eq(channels.communityId, communityId));
  for (const ch of chans) deps.bus.evict(userId, `channel:${ch.id}`);
}
