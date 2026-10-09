# Phase 3 — Communities, messaging, tokens, realtime, discovery (Tasks 9–13)

Read the plan index `../2026-10-09-shillex.md` first. Conventions from Phase 2 apply (route plugins, `requireUser`, `.ts` import extensions).

---

### Task 9: Communities, membership, invites, channels, threads

**Files:**
- Create: `apps/server/src/services/unread.ts`, `apps/server/src/services/communities.ts`
- Create: `apps/server/src/routes/communities.ts`, `apps/server/src/routes/channels.ts`
- Modify: `apps/server/src/app.ts` (register both)
- Test: `apps/server/test/communities.test.ts`

**Interfaces:**
- Consumes: visibility, `setCommunityMentionVisibility`, `notify`, `hydratePosts`, `loadUserByUsername`, `toUserSummary`, `SLOW_MODE_OPTIONS`.
- Produces:
  - `unreadInScope(db, a: { userId: string; scopeType: 'channel' | 'conversation'; scopeId: string; since: Date }): Promise<number>` (capped at 99; counts visible messages by others after the read marker, or after `since` when no marker)
  - `markRead(db, userId, scopeType, scopeId, messageId): Promise<void>` (never moves backwards)
  - `communitySummaries(deps, viewerId, rows: CommunityRow[]): Promise<CommunitySummary[]>`
  - `channelViews(db, viewerId, rows: ChannelRow[], member: MemberRow | null): Promise<ChannelView[]>`
  - `communityDetail(deps, viewerId, access: CommunityAccess): Promise<CommunityDetail>`
  - `evictFromCommunity(deps, userId, communityId): Promise<void>` — `bus.evict` for `community:<id>` and every `channel:<channelId>`
  - Routes:
    - `GET /api/communities?filter=joined|discover&q=` → `{ communities: CommunitySummary[] }` (discover lists public + private, never invite-only)
    - `POST /api/communities` → `201 { community: CommunityDetail }` (creator = owner; creates `#general`)
    - `GET /api/communities/:slug` → `{ community: CommunityDetail }`
    - `PATCH /api/communities/:slug` (mod; `visibility` owner-only) → `{ community: CommunityDetail }`
    - `POST /api/communities/:slug/join` → `{ status: 'active' | 'pending' }`; 403 `INVITE_REQUIRED` / `BANNED`
    - `DELETE /api/communities/:slug/membership` → 204; 400 `OWNER_CANNOT_LEAVE`
    - `POST /api/communities/:slug/invites` (mod) → `201 { invite: InviteView }`
    - `GET /api/invites/:code` → `{ community: CommunitySummary; valid: boolean }`
    - `POST /api/invites/:code/accept` → `{ community: CommunitySummary }`; 410 `INVITE_EXPIRED`
    - `GET /api/communities/:slug/members` → `{ members: MemberView[] }`
    - `GET /api/communities/:slug/requests` (mod) → `{ members: MemberView[] }`
    - `POST /api/communities/:slug/requests/:userId/approve|reject` (mod) → 204
    - `POST /api/communities/:slug/members/:userId/remove|ban|unban` (mod) → 204
    - `PUT /api/communities/:slug/members/:userId/role` `{ role: 'mod' | 'member' }` (owner) → 204
    - `GET /api/communities/:slug/threads?cursor` → `Page<PostView>`
    - `GET /api/users/:username/communities` → `{ communities: CommunitySummary[] }` (public only unless viewing self)
    - `POST /api/communities/:slug/channels` (mod) `{ name, topic? }` → `201 { channel: ChannelView }`
    - `PATCH /api/channels/:id` (mod) `{ name?, topic?, slowModeSeconds?, holdNewMemberPosts? }` → `{ channel: ChannelView }`

- [ ] **Step 1: Failing tests**

`apps/server/test/communities.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestApp, type TestCtx, type TestUser } from './helpers.ts';
import { tokenMentions, notifications } from '../src/db/schema.ts';

const MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
let ctx: TestCtx; let owner: TestUser; let joiner: TestUser; let outsider: TestUser;
beforeAll(async () => {
  ctx = await makeTestApp();
  owner = await ctx.createUser('owner'); joiner = await ctx.createUser('joiner'); outsider = await ctx.createUser('outsider');
  for (const [slug, visibility] of [['pub', 'public'], ['priv', 'private'], ['inv', 'invite']] as const) {
    const r = await ctx.as(owner).post('/api/communities', { name: `C ${slug}`, slug, description: `${slug} desc`, visibility });
    expect(r.status).toBe(201);
  }
});
afterAll(() => ctx.close());

describe('communities', () => {
  it('creator is owner with a #general channel', async () => {
    const d = (await ctx.as(owner).get('/api/communities/pub')).body.community;
    expect(d.community).toMatchObject({ slug: 'pub', myRole: 'owner', memberCount: 1 });
    expect(d.channels.map((c: any) => c.name)).toEqual(['general']);
    expect(d.isMod).toBe(true);
  });
  it('rejects duplicate and malformed slugs', async () => {
    expect((await ctx.as(owner).post('/api/communities', { name: 'Dup', slug: 'pub', visibility: 'public' })).status).toBe(409);
    expect((await ctx.as(owner).post('/api/communities', { name: 'Bad', slug: 'Bad Slug!', visibility: 'public' })).status).toBe(400);
  });
  it('discover lists public and private but never invite-only', async () => {
    const slugs = (await ctx.as(outsider).get('/api/communities?filter=discover')).body.communities.map((c: any) => c.slug);
    expect(slugs).toEqual(expect.arrayContaining(['pub', 'priv']));
    expect(slugs).not.toContain('inv');
  });
  it('private detail hides content from non-members; invite-only 404s', async () => {
    const d = (await ctx.as(outsider).get('/api/communities/priv')).body.community;
    expect(d).toMatchObject({ canRead: false, channels: [], owner: null, moderators: [] });
    expect((await ctx.as(outsider).get('/api/communities/inv')).status).toBe(404);
    expect((await ctx.as(outsider).get('/api/communities/priv/threads')).status).toBe(403);
  });
  it('public join is immediate', async () => {
    expect((await ctx.as(joiner).post('/api/communities/pub/join')).body).toEqual({ status: 'active' });
    expect((await ctx.as(joiner).get('/api/communities?filter=joined')).body.communities.map((c: any) => c.slug)).toEqual(['pub']);
  });
  it('private join creates a request that a mod approves', async () => {
    expect((await ctx.as(joiner).post('/api/communities/priv/join')).body).toEqual({ status: 'pending' });
    const n = await ctx.db.select().from(notifications).where(eq(notifications.userId, owner.id));
    expect(n.some((x) => x.type === 'join_request')).toBe(true);
    const reqs = (await ctx.as(owner).get('/api/communities/priv/requests')).body.members;
    expect(reqs.map((m: any) => m.user.username)).toEqual(['joiner']);
    expect((await ctx.as(joiner).get('/api/communities/priv/requests')).status).toBe(403);
    expect((await ctx.as(owner).post(`/api/communities/priv/requests/${joiner.id}/approve`)).status).toBe(204);
    expect((await ctx.as(joiner).get('/api/communities/priv')).body.community.canRead).toBe(true);
  });
  it('invite-only requires an invite; invites expire and run out', async () => {
    expect((await ctx.as(joiner).post('/api/communities/inv/join')).body.code).toBe('INVITE_REQUIRED');
    const inv = (await ctx.as(owner).post('/api/communities/inv/invites', { maxUses: 1, expiresInHours: 1 })).body.invite;
    expect(inv.url).toMatch(new RegExp(`/invite/${inv.code}$`));
    expect((await ctx.as(joiner).get(`/api/invites/${inv.code}`)).body).toMatchObject({ valid: true, community: { slug: 'inv' } });
    expect((await ctx.as(joiner).post(`/api/invites/${inv.code}/accept`)).status).toBe(200);
    expect((await ctx.as(outsider).post(`/api/invites/${inv.code}/accept`)).body.code).toBe('INVITE_EXPIRED');
    const inv2 = (await ctx.as(owner).post('/api/communities/inv/invites', { expiresInHours: 1 })).body.invite;
    ctx.clock.advance(2 * 3600_000);
    expect((await ctx.as(outsider).post(`/api/invites/${inv2.code}/accept`)).status).toBe(410);
  });
  it('owner cannot leave; members can', async () => {
    expect((await ctx.as(owner).del('/api/communities/pub/membership')).body.code).toBe('OWNER_CANNOT_LEAVE');
    const o2 = await ctx.createUser('leaver');
    await ctx.as(o2).post('/api/communities/pub/join');
    expect((await ctx.as(o2).del('/api/communities/pub/membership')).status).toBe(204);
  });
  it('ban evicts sockets and blocks rejoin', async () => {
    const victim = await ctx.createUser('victim');
    await ctx.as(victim).post('/api/communities/pub/join');
    ctx.bus.clear();
    expect((await ctx.as(owner).post(`/api/communities/pub/members/${victim.id}/ban`)).status).toBe(204);
    expect(ctx.bus.evictions.map((e) => e.room)).toEqual(expect.arrayContaining([expect.stringMatching(/^community:/), expect.stringMatching(/^channel:/)]));
    expect((await ctx.as(victim).post('/api/communities/pub/join')).body.code).toBe('BANNED');
    expect((await ctx.as(joiner).post(`/api/communities/pub/members/${owner.id}/ban`)).status).toBe(403);
  });
  it('channel settings are mod-only and slow mode must be an allowed value', async () => {
    const ch = (await ctx.as(owner).get('/api/communities/pub')).body.community.channels[0];
    expect((await ctx.as(joiner).patch(`/api/channels/${ch.id}`, { slowModeSeconds: 30 })).status).toBe(403);
    expect((await ctx.as(owner).patch(`/api/channels/${ch.id}`, { slowModeSeconds: 7 })).status).toBe(400);
    expect((await ctx.as(owner).patch(`/api/channels/${ch.id}`, { slowModeSeconds: 30 })).body.channel.slowModeSeconds).toBe(30);
    const c2 = await ctx.as(owner).post('/api/communities/pub/channels', { name: 'alpha-calls', topic: 'calls only' });
    expect(c2.body.channel).toMatchObject({ name: 'alpha-calls', topic: 'calls only' });
  });
  it('changing visibility to private flips existing mentions to non-public', async () => {
    const p = (await ctx.as(owner).post('/api/posts', { body: `thread ${MINT}`, communityId: (await ctx.as(owner).get('/api/communities/pub')).body.community.community.id })).body.post;
    expect((await ctx.db.select().from(tokenMentions).where(eq(tokenMentions.sourceId, p.id)))[0]!.isPublic).toBe(true);
    expect((await ctx.as(owner).patch('/api/communities/pub', { visibility: 'private' })).status).toBe(200);
    expect((await ctx.db.select().from(tokenMentions).where(eq(tokenMentions.sourceId, p.id)))[0]!.isPublic).toBe(false);
    await ctx.as(owner).patch('/api/communities/pub', { visibility: 'public' });
  });
  it('threads list community posts; user communities hide non-public for others', async () => {
    const t = await ctx.as(joiner).get('/api/communities/pub/threads');
    expect(t.body.items.length).toBeGreaterThan(0);
    const mine = (await ctx.as(joiner).get('/api/users/joiner/communities')).body.communities.map((c: any) => c.slug);
    expect(mine).toEqual(expect.arrayContaining(['pub', 'priv', 'inv']));
    const theirs = (await ctx.as(outsider).get('/api/users/joiner/communities')).body.communities.map((c: any) => c.slug);
    expect(theirs).toEqual(['pub']);
  });
});
```

- [ ] **Step 2: Unread and community services**

`apps/server/src/services/unread.ts`:
```ts
import { and, eq, gt, gte, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { messages, readMarkers } from '../db/schema.ts';

export async function unreadInScope(db: Db, a: { userId: string; scopeType: 'channel' | 'conversation'; scopeId: string; since: Date }): Promise<number> {
  const [marker] = await db.select().from(readMarkers).where(and(
    eq(readMarkers.userId, a.userId), eq(readMarkers.scopeType, a.scopeType), eq(readMarkers.scopeId, a.scopeId),
  )).limit(1);
  const scopeCol = a.scopeType === 'channel' ? messages.channelId : messages.conversationId;
  const sub = db.select({ id: messages.id }).from(messages).where(and(
    eq(scopeCol, a.scopeId), eq(messages.status, 'visible'), ne(messages.authorId, a.userId),
    marker ? gt(messages.id, marker.lastReadMessageId) : gte(messages.createdAt, a.since),
  )).limit(99).as('unread_sub');
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(sub);
  return row?.n ?? 0;
}

export async function markRead(db: Db, userId: string, scopeType: 'channel' | 'conversation', scopeId: string, messageId: string) {
  await db.insert(readMarkers).values({ userId, scopeType, scopeId, lastReadMessageId: messageId })
    .onConflictDoUpdate({
      target: [readMarkers.userId, readMarkers.scopeType, readMarkers.scopeId],
      set: { lastReadMessageId: sql`greatest(${readMarkers.lastReadMessageId}, excluded.last_read_message_id)` },
    });
}
```

`apps/server/src/services/communities.ts`:
```ts
import { and, eq, inArray, max } from 'drizzle-orm';
import type { ChannelView, CommunityDetail, CommunitySummary } from '@shillex/shared';
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
    community: summary!, bannerUrl: c.bannerUrl ?? `/media/banner/c${c.id}.svg`, rules: c.rules, createdAt: c.createdAt.toISOString(),
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

```

- [ ] **Step 3: Routes**

`apps/server/src/routes/communities.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { and, desc, eq, ilike, inArray, lt, ne, or, sql } from 'drizzle-orm';
import type { InviteView, MemberView, Page, PostView } from '@shillex/shared';
import { communities, communityMembers, channels, invites, posts, users, type CommunityRow } from '../db/schema.ts';
import { requireUser } from '../lib/auth.ts';
import { parse } from '../lib/validate.ts';
import { AppError, errors } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { clampLimit } from '../lib/pagination.ts';
import { getCommunityAccessBySlug, requireCommunityRead, requireMod, type CommunityAccess } from '../services/visibility.ts';
import { channelViews, communityDetail, communitySummaries, evictFromCommunity } from '../services/communities.ts';
import { setCommunityMentionVisibility } from '../services/mentions.ts';
import { notify } from '../services/notify.ts';
import { hydratePosts, collectMints } from '../services/hydrate.ts';
import { toUserSummary } from '../services/users.ts';
import { loadUserByUsername } from './users.ts';

const Slug = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/, '3–32 lowercase letters, numbers or dashes');
const Visibility = z.enum(['public', 'private', 'invite']);
const Create = z.object({ name: z.string().trim().min(3).max(40), slug: Slug, description: z.string().max(280).default(''), visibility: Visibility, rules: z.string().max(2000).default('') });
const Update = z.object({ name: z.string().trim().min(3).max(40).optional(), description: z.string().max(280).optional(), rules: z.string().max(2000).optional(), visibility: Visibility.optional() });
const InviteBody = z.object({ maxUses: z.number().int().min(1).max(1000).optional(), expiresInHours: z.number().int().min(1).max(720).optional() });

export default async function communitiesRoutes(app: FastifyInstance) {
  const deps = app.deps;
  const { db, now, config } = deps;

  async function access(slug: string, userId: string): Promise<CommunityAccess> {
    const a = await getCommunityAccessBySlug(db, slug, userId);
    if (!a || (a.community.visibility === 'invite' && !a.isActive)) throw errors.notFound('Community');
    return a;
  }
  const memberViews = async (communityId: string, status: 'active' | 'pending'): Promise<MemberView[]> => {
    const rows = await db.select({ m: communityMembers, u: users }).from(communityMembers).innerJoin(users, eq(users.id, communityMembers.userId))
      .where(and(eq(communityMembers.communityId, communityId), eq(communityMembers.status, status)));
    const rank = { owner: 0, mod: 1, member: 2 } as const;
    return rows.map(({ m, u }) => ({ user: toUserSummary(u), role: m.role, status: m.status, online: deps.presence.isOnline(u.id), joinedAt: m.joinedAt.toISOString() }))
      .sort((a, b) => rank[a.role] - rank[b.role] || Number(b.online) - Number(a.online) || a.user.username.localeCompare(b.user.username));
  };

  app.get<{ Querystring: { filter?: string; q?: string } }>('/communities', async (req) => {
    const me = requireUser(req);
    const q = (req.query.q ?? '').trim().replace(/[%_]/g, '');
    let rows: CommunityRow[];
    if (req.query.filter === 'joined') {
      rows = (await db.select({ c: communities }).from(communityMembers).innerJoin(communities, eq(communities.id, communityMembers.communityId))
        .where(and(eq(communityMembers.userId, me.id), eq(communityMembers.status, 'active')))).map((r) => r.c);
      rows.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      rows = await db.select().from(communities).where(and(
        ne(communities.visibility, 'invite'),
        q ? or(ilike(communities.name, `%${q}%`), ilike(communities.description, `%${q}%`)) : undefined,
      )).limit(100);
    }
    const list = await communitySummaries(deps, me.id, rows);
    if (req.query.filter !== 'joined') list.sort((a, b) => b.onlineCount - a.onlineCount || b.memberCount - a.memberCount);
    return { communities: list };
  });

  app.post('/communities', async (req, reply) => {
    const me = requireUser(req);
    const body = parse(Create, req.body);
    const taken = await db.select({ id: communities.id }).from(communities).where(eq(communities.slug, body.slug)).limit(1);
    if (taken.length) throw errors.conflict('SLUG_TAKEN', 'That community URL is taken');
    const id = newId();
    const createdAt = now();
    await db.insert(communities).values({ id, ...body, ownerId: me.id, createdAt });
    await db.insert(communityMembers).values({ communityId: id, userId: me.id, role: 'owner', status: 'active', joinedAt: createdAt });
    await db.insert(channels).values({ id: newId(), communityId: id, name: 'general', topic: 'Say gm', position: 0 });
    return reply.status(201).send({ community: await communityDetail(deps, me.id, await access(body.slug, me.id)) });
  });

  app.get<{ Params: { slug: string } }>('/communities/:slug', async (req) => {
    const me = requireUser(req);
    return { community: await communityDetail(deps, me.id, await access(req.params.slug, me.id)) };
  });

  app.patch<{ Params: { slug: string } }>('/communities/:slug', async (req) => {
    const me = requireUser(req);
    const a = requireMod(await access(req.params.slug, me.id));
    const body = parse(Update, req.body);
    if (body.visibility && !a.isOwner) throw errors.forbidden('OWNER_ONLY', 'Only the owner can change visibility');
    await db.update(communities).set(body).where(eq(communities.id, a.community.id));
    if (body.visibility && (body.visibility === 'public') !== (a.community.visibility === 'public')) {
      await setCommunityMentionVisibility(db, a.community.id, body.visibility === 'public');
    }
    return { community: await communityDetail(deps, me.id, await access(req.params.slug, me.id)) };
  });

  app.post<{ Params: { slug: string } }>('/communities/:slug/join', async (req) => {
    const me = requireUser(req);
    const a = await access(req.params.slug, me.id);
    if (a.member?.status === 'banned') throw errors.forbidden('BANNED', 'You are banned from this community');
    if (a.member) return { status: a.member.status };
    if (a.community.visibility === 'invite') throw errors.forbidden('INVITE_REQUIRED', 'This community is invite-only');
    const status = a.community.visibility === 'public' ? 'active' as const : 'pending' as const;
    await db.insert(communityMembers).values({ communityId: a.community.id, userId: me.id, role: 'member', status, joinedAt: now() });
    if (status === 'pending') {
      const mods = await db.select({ u: communityMembers.userId }).from(communityMembers).where(and(
        eq(communityMembers.communityId, a.community.id), eq(communityMembers.status, 'active'), inArray(communityMembers.role, ['owner', 'mod'])));
      for (const m of mods) await notify(deps, { userId: m.u, type: 'join_request', actorId: me.id, targetType: 'community', targetId: a.community.id, data: { slug: a.community.slug, communityName: a.community.name } });
    }
    deps.bus.toUser(me.id, 'community:update', { communityId: a.community.id });
    return { status };
  });

  app.delete<{ Params: { slug: string } }>('/communities/:slug/membership', async (req, reply) => {
    const me = requireUser(req);
    const a = await access(req.params.slug, me.id);
    if (a.isOwner) throw errors.badRequest('OWNER_CANNOT_LEAVE', 'Owners can’t leave their own community');
    if (a.member?.status === 'banned') throw errors.forbidden('BANNED', 'You are banned from this community');
    await db.delete(communityMembers).where(and(eq(communityMembers.communityId, a.community.id), eq(communityMembers.userId, me.id)));
    await evictFromCommunity(deps, me.id, a.community.id);
    return reply.status(204).send();
  });

  app.post<{ Params: { slug: string } }>('/communities/:slug/invites', async (req, reply) => {
    const me = requireUser(req);
    const a = requireMod(await access(req.params.slug, me.id));
    const body = parse(InviteBody, req.body ?? {});
    const code = randomBytes(9).toString('base64url');
    const expiresAt = body.expiresInHours ? new Date(now().getTime() + body.expiresInHours * 3600_000) : null;
    await db.insert(invites).values({ code, communityId: a.community.id, createdBy: me.id, expiresAt, maxUses: body.maxUses ?? null, createdAt: now() });
    const invite: InviteView = { code, url: `${config.publicUrl}/invite/${code}`, expiresAt: expiresAt?.toISOString() ?? null, maxUses: body.maxUses ?? null, uses: 0 };
    return reply.status(201).send({ invite });
  });

  async function loadInvite(code: string) {
    const [inv] = await db.select().from(invites).where(eq(invites.code, code)).limit(1);
    if (!inv) throw errors.notFound('Invite');
    const valid = (!inv.expiresAt || inv.expiresAt > now()) && (inv.maxUses === null || inv.uses < inv.maxUses);
    const [c] = await db.select().from(communities).where(eq(communities.id, inv.communityId));
    return { inv, valid, community: c! };
  }
  app.get<{ Params: { code: string } }>('/invites/:code', async (req) => {
    const me = requireUser(req);
    const { valid, community } = await loadInvite(req.params.code);
    return { community: (await communitySummaries(deps, me.id, [community]))[0], valid };
  });
  app.post<{ Params: { code: string } }>('/invites/:code/accept', async (req) => {
    const me = requireUser(req);
    const { inv, valid, community } = await loadInvite(req.params.code);
    const [existing] = await db.select().from(communityMembers).where(and(eq(communityMembers.communityId, community.id), eq(communityMembers.userId, me.id)));
    if (existing?.status === 'banned') throw errors.forbidden('BANNED', 'You are banned from this community');
    if (existing?.status !== 'active') {
      if (!valid) throw new AppError(410, 'INVITE_EXPIRED', 'This invite has expired or been used up');
      await db.insert(communityMembers).values({ communityId: community.id, userId: me.id, role: 'member', status: 'active', joinedAt: now() })
        .onConflictDoUpdate({ target: [communityMembers.communityId, communityMembers.userId], set: { status: 'active', joinedAt: now() } });
      await db.update(invites).set({ uses: sql`${invites.uses} + 1` }).where(eq(invites.code, inv.code));
    }
    return { community: (await communitySummaries(deps, me.id, [community]))[0] };
  });

  app.get<{ Params: { slug: string } }>('/communities/:slug/members', async (req) => {
    const me = requireUser(req);
    const a = requireCommunityRead(await access(req.params.slug, me.id));
    return { members: await memberViews(a.community.id, 'active') };
  });
  app.get<{ Params: { slug: string } }>('/communities/:slug/requests', async (req) => {
    const me = requireUser(req);
    const a = requireMod(await access(req.params.slug, me.id));
    return { members: await memberViews(a.community.id, 'pending') };
  });
  app.post<{ Params: { slug: string; userId: string; action: string } }>('/communities/:slug/requests/:userId/:action', async (req, reply) => {
    const me = requireUser(req);
    const a = requireMod(await access(req.params.slug, me.id));
    const where = and(eq(communityMembers.communityId, a.community.id), eq(communityMembers.userId, req.params.userId), eq(communityMembers.status, 'pending'));
    if (req.params.action === 'approve') await db.update(communityMembers).set({ status: 'active', joinedAt: now() }).where(where);
    else if (req.params.action === 'reject') await db.delete(communityMembers).where(where);
    else throw errors.notFound('Action');
    deps.bus.toUser(req.params.userId, 'community:update', { communityId: a.community.id });
    return reply.status(204).send();
  });

  app.post<{ Params: { slug: string; userId: string; action: string } }>('/communities/:slug/members/:userId/:action', async (req, reply) => {
    const me = requireUser(req);
    const a = requireMod(await access(req.params.slug, me.id));
    const [target] = await db.select().from(communityMembers).where(and(eq(communityMembers.communityId, a.community.id), eq(communityMembers.userId, req.params.userId)));
    if (target?.role === 'owner' || (target?.role === 'mod' && !a.isOwner) || req.params.userId === me.id) {
      throw errors.forbidden('CANNOT_MODERATE', 'You can’t moderate this member');
    }
    const key = and(eq(communityMembers.communityId, a.community.id), eq(communityMembers.userId, req.params.userId));
    switch (req.params.action) {
      case 'remove': if (target) await db.delete(communityMembers).where(key); break;
      case 'ban':
        await db.insert(communityMembers).values({ communityId: a.community.id, userId: req.params.userId, role: 'member', status: 'banned', joinedAt: now() })
          .onConflictDoUpdate({ target: [communityMembers.communityId, communityMembers.userId], set: { status: 'banned', role: 'member' } });
        break;
      case 'unban': if (target?.status === 'banned') await db.delete(communityMembers).where(key); break;
      default: throw errors.notFound('Action');
    }
    if (req.params.action !== 'unban') await evictFromCommunity(deps, req.params.userId, a.community.id);
    deps.bus.toUser(req.params.userId, 'community:update', { communityId: a.community.id });
    return reply.status(204).send();
  });

  app.put<{ Params: { slug: string; userId: string } }>('/communities/:slug/members/:userId/role', async (req, reply) => {
    const me = requireUser(req);
    const a = await access(req.params.slug, me.id);
    if (!a.isOwner) throw errors.forbidden('OWNER_ONLY', 'Only the owner can change roles');
    const { role } = parse(z.object({ role: z.enum(['mod', 'member']) }), req.body);
    if (req.params.userId === me.id) throw errors.badRequest('SELF', 'You are the owner');
    await db.update(communityMembers).set({ role }).where(and(eq(communityMembers.communityId, a.community.id), eq(communityMembers.userId, req.params.userId), eq(communityMembers.status, 'active')));
    return reply.status(204).send();
  });

  app.get<{ Params: { slug: string }; Querystring: { cursor?: string; limit?: string } }>('/communities/:slug/threads', async (req) => {
    const me = requireUser(req);
    const a = requireCommunityRead(await access(req.params.slug, me.id));
    const limit = clampLimit(req.query.limit, 20, 50);
    const rows = await db.select().from(posts).where(and(
      eq(posts.communityId, a.community.id), inArray(posts.kind, ['post', 'quote']), sql`${posts.deletedAt} is null`,
      req.query.cursor ? lt(posts.id, req.query.cursor) : undefined,
    )).orderBy(desc(posts.id)).limit(limit + 1);
    const items = await hydratePosts(db, me.id, rows.slice(0, limit));
    const page: Page<PostView> = { items, nextCursor: rows.length > limit ? rows[limit - 1]!.id : null, tokens: await deps.tokens.getViews(collectMints(items)) };
    return page;
  });

  app.get<{ Params: { username: string } }>('/users/:username/communities', async (req) => {
    const me = requireUser(req);
    const u = await loadUserByUsername(db, req.params.username);
    const rows = (await db.select({ c: communities }).from(communityMembers).innerJoin(communities, eq(communities.id, communityMembers.communityId))
      .where(and(eq(communityMembers.userId, u.id), eq(communityMembers.status, 'active')))).map((r) => r.c)
      .filter((c) => u.id === me.id || c.visibility === 'public');
    return { communities: await communitySummaries(deps, me.id, rows) };
  });

  app.post<{ Params: { slug: string } }>('/communities/:slug/channels', async (req, reply) => {
    const me = requireUser(req);
    const a = requireMod(await access(req.params.slug, me.id));
    const body = parse(z.object({ name: z.string().regex(/^[a-z0-9-]{1,24}$/), topic: z.string().max(120).default('') }), req.body);
    const count = await db.select({ id: channels.id }).from(channels).where(eq(channels.communityId, a.community.id));
    if (count.length >= 20) throw errors.badRequest('TOO_MANY_CHANNELS', 'Up to 20 channels per community');
    const [row] = await db.insert(channels).values({ id: newId(), communityId: a.community.id, name: body.name, topic: body.topic, position: count.length }).returning();
    deps.bus.toRoom(`community:${a.community.id}`, 'community:update', { communityId: a.community.id });
    return reply.status(201).send({ channel: (await channelViews(db, me.id, [row!], a.member))[0] });
  });
}
```

`apps/server/src/routes/channels.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { SLOW_MODE_OPTIONS } from '@shillex/shared';
import { channels } from '../db/schema.ts';
import { requireUser } from '../lib/auth.ts';
import { parse } from '../lib/validate.ts';
import { requireChannel, requireMod } from '../services/visibility.ts';
import { channelViews } from '../services/communities.ts';

const Patch = z.object({
  name: z.string().regex(/^[a-z0-9-]{1,24}$/).optional(),
  topic: z.string().max(120).optional(),
  slowModeSeconds: z.number().int().refine((n) => (SLOW_MODE_OPTIONS as readonly number[]).includes(n), 'Unsupported slow mode').optional(),
  holdNewMemberPosts: z.boolean().optional(),
});

export default async function channelsRoutes(app: FastifyInstance) {
  const { db, bus } = app.deps;
  app.patch<{ Params: { id: string } }>('/channels/:id', async (req) => {
    const me = requireUser(req);
    const { channel, access } = await requireChannel(db, req.params.id, me.id, 'read');
    requireMod(access);
    const body = parse(Patch, req.body);
    const [row] = await db.update(channels).set(body).where(eq(channels.id, channel.id)).returning();
    bus.toRoom(`community:${channel.communityId}`, 'community:update', { communityId: channel.communityId });
    return { channel: (await channelViews(db, me.id, [row!], access.member))[0] };
  });
}
```

- [ ] **Step 4: Register, run, commit**

Register `communitiesRoutes` and `channelsRoutes` with `/api`.
Run: `npm test -w @shillex/server && npm run typecheck -w @shillex/server` → PASS.
```bash
git add apps/server
git commit -m "feat(server): communities, membership flows, invites, channels and moderation of members"
```

---

### Task 10: Messages, conversations, moderation, pins, reports, search

**Files:**
- Create: `apps/server/src/services/moderation.ts`, `apps/server/src/services/messages.ts`
- Modify: `apps/server/src/services/hydrate.ts` (add `hydrateMessages`)
- Create: `apps/server/src/routes/messages.ts`, `routes/conversations.ts`, `routes/pins.ts`, `routes/reports.ts`, `routes/search.ts`
- Modify: `apps/server/src/app.ts` (decorate `guards`, register routes)
- Test: `apps/server/test/moderation.test.ts`, `test/messages.test.ts`, `test/conversations.test.ts`, `test/pins-reports.test.ts`

**Interfaces:**
- Consumes: Task 9 services, visibility, mentions, notify, `resolveUploads`.
- Produces:
  - `class RateLimiter(max, windowMs)` with `hit(key: string, nowMs: number): { ok: true } | { ok: false; retryAfterSec: number }`
  - `class DuplicateFilter(windowMs)` with `isDuplicate(userId: string, body: string, nowMs: number): boolean` (bodies normalized; bodies shorter than 4 chars never count — "gm" is allowed)
  - `checkSlowMode(last: Date | null, slowSec: number, now: Date): { ok: true } | { ok: false; retryAfterSec: number }`
  - `linkMentionCount(body: string): number` (urls + @mentions + mints), `isNewAccount(createdAt: Date, now: Date): boolean`
  - `interface MessageGuards { rate: RateLimiter; dupes: DuplicateFilter }`, `createGuards(): MessageGuards`; `app.guards` decorated in `buildApp`
  - `hydrateMessages(db, viewerId, rows: MessageRow[]): Promise<MessageView[]>` (message reactions include `userIds`)
  - `sendMessage(deps, guards, input: SendMessageInput): Promise<{ row: MessageRow; view: MessageView; tokens: Record<string, TokenView> }>` where `SendMessageInput = { scope: ScopeRef; author: UserRow; body: string; replyToId?: string; attachments?: ({ type: 'image'; uploadId: string; alt?: string } | { type: 'token'; mint: string })[]; nonce?: string }`
  - `emitMessage(deps, row: MessageRow, event: 'message:new' | 'message:update', extra?: object): Promise<void>`
  - `loadMessageAccess(db, messageId, userId): Promise<{ row: MessageRow; isMod: boolean; channel: ChannelRow | null }>`
  - Routes:
    - `GET /api/channels/:id/messages?before&after&limit` / `GET /api/conversations/:id/messages?...` → `Page<MessageView>` (items oldest→newest; `nextCursor` = id to pass as `before`)
    - `POST /api/channels/:id/messages` / `POST /api/conversations/:id/messages` → `201 { message, tokens }`; errors `EMPTY_BODY`, `BODY_TOO_LONG`, `RATE_LIMITED`, `DUPLICATE`, `SLOW_MODE` (details `{ retryAfterSec }`), `TOO_MANY_LINKS`, `BLOCKED`, `JOIN_TO_POST`, `BANNED`
    - `DELETE /api/messages/:id` → 204; `PUT|DELETE /api/messages/:id/reactions/:emoji` → `{ reactions }`; `POST /api/messages/:id/approve` → `{ message }`
    - `POST /api/channels/:id/read` / `POST /api/conversations/:id/read` `{ messageId }` → 204
    - `GET /api/conversations` → `{ conversations: ConversationView[] }`; `POST /api/conversations` `{ kind: 'dm', username } | { kind: 'group', name, usernames }` → `201|200 { conversation }`; `GET /api/conversations/:id`; `PATCH /api/conversations/:id` `{ name?, muted? }`; `POST /api/conversations/:id/members` `{ usernames }`; `DELETE /api/conversations/:id/members/me` → 204
    - `GET /api/communities/:slug/pins` → `{ pins: PinView[] }`; `POST /api/communities/:slug/pins` `{ targetType, targetId }` → `201 { pin }`; `DELETE /api/pins/:id` → 204
    - `POST /api/reports` `{ targetType, targetId, reason }` → `201 { id }`; `GET /api/communities/:slug/reports` → `{ reports: ReportView[] }`; `POST /api/reports/:id/resolve` `{ action: 'dismiss' | 'remove_content' }` → 204
    - `GET /api/search/messages?q&conversationId` → `{ hits: MessageSearchHit[] }`

- [ ] **Step 1: Failing moderation unit tests**

`apps/server/test/moderation.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { RateLimiter, DuplicateFilter, checkSlowMode, linkMentionCount, isNewAccount } from '../src/services/moderation.ts';

const MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

describe('RateLimiter', () => {
  it('allows max hits per window then reports retry-after', () => {
    const rl = new RateLimiter(3, 10_000);
    expect([0, 1, 2].map((t) => rl.hit('u', t).ok)).toEqual([true, true, true]);
    expect(rl.hit('u', 3)).toEqual({ ok: false, retryAfterSec: 10 });
    expect(rl.hit('u', 10_001).ok).toBe(true);
    expect(rl.hit('other', 3).ok).toBe(true);
  });
});
describe('DuplicateFilter', () => {
  it('flags the same normalized text within the window', () => {
    const d = new DuplicateFilter(60_000);
    expect(d.isDuplicate('u', 'BUY NOW  frens', 0)).toBe(false);
    expect(d.isDuplicate('u', 'buy now frens', 1000)).toBe(true);
    expect(d.isDuplicate('v', 'buy now frens', 1000)).toBe(false);
    expect(d.isDuplicate('u', 'buy now frens', 62_000)).toBe(false);
  });
  it('never flags short chatter like gm', () => {
    const d = new DuplicateFilter(60_000);
    expect(d.isDuplicate('u', 'gm', 0)).toBe(false);
    expect(d.isDuplicate('u', 'gm', 1)).toBe(false);
  });
});
describe('checkSlowMode', () => {
  const now = new Date('2026-10-09T12:00:30Z');
  it('computes retry-after', () => {
    expect(checkSlowMode(null, 30, now)).toEqual({ ok: true });
    expect(checkSlowMode(new Date('2026-10-09T12:00:10Z'), 30, now)).toEqual({ ok: false, retryAfterSec: 10 });
    expect(checkSlowMode(new Date('2026-10-09T12:00:00Z'), 30, now)).toEqual({ ok: true });
    expect(checkSlowMode(new Date('2026-10-09T12:00:29Z'), 0, now)).toEqual({ ok: true });
  });
});
describe('link/mention caps', () => {
  it('counts urls, @mentions and mints', () => {
    expect(linkMentionCount(`@a_b_c https://x.io ${MINT} plain`)).toBe(3);
  });
  it('new accounts are < 24h old', () => {
    const now = new Date('2026-10-09T12:00:00Z');
    expect(isNewAccount(new Date('2026-10-09T00:00:00Z'), now)).toBe(true);
    expect(isNewAccount(new Date('2026-10-08T11:00:00Z'), now)).toBe(false);
  });
});
```

- [ ] **Step 2: Implement `moderation.ts`**

`apps/server/src/services/moderation.ts`:
```ts
import { LIMITS, tokenizeBody } from '@shillex/shared';

export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number) {}
  hit(key: string, nowMs: number): { ok: true } | { ok: false; retryAfterSec: number } {
    const recent = (this.hits.get(key) ?? []).filter((t) => nowMs - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((this.windowMs - (nowMs - recent[0]!)) / 1000)) };
    }
    recent.push(nowMs);
    this.hits.set(key, recent);
    return { ok: true };
  }
}

export const normalizeBody = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

export class DuplicateFilter {
  private seen = new Map<string, Map<string, number>>();
  constructor(private windowMs: number) {}
  isDuplicate(userId: string, body: string, nowMs: number): boolean {
    const norm = normalizeBody(body);
    if (norm.length < 4) return false;
    const mine = this.seen.get(userId) ?? new Map<string, number>();
    for (const [k, t] of mine) if (nowMs - t >= this.windowMs) mine.delete(k);
    const dup = mine.has(norm);
    mine.set(norm, nowMs);
    this.seen.set(userId, mine);
    return dup;
  }
}

export function checkSlowMode(last: Date | null, slowSec: number, now: Date): { ok: true } | { ok: false; retryAfterSec: number } {
  if (!slowSec || !last) return { ok: true };
  const wait = slowSec * 1000 - (now.getTime() - last.getTime());
  return wait > 0 ? { ok: false, retryAfterSec: Math.ceil(wait / 1000) } : { ok: true };
}

export const linkMentionCount = (body: string) => tokenizeBody(body).filter((s) => s.type !== 'text').length;
export const isNewAccount = (createdAt: Date, now: Date) => now.getTime() - createdAt.getTime() < LIMITS.newAccountMs;

export interface MessageGuards { rate: RateLimiter; dupes: DuplicateFilter }
export const createGuards = (): MessageGuards => ({
  rate: new RateLimiter(LIMITS.messageRateCount, LIMITS.messageRateWindowMs),
  dupes: new DuplicateFilter(LIMITS.duplicateWindowMs),
});
```

In `src/app.ts`:
```ts
import { createGuards, type MessageGuards } from './services/moderation.ts';
declare module 'fastify' { interface FastifyInstance { guards: MessageGuards } }
// inside buildApp, after decorate('deps'):
app.decorate('guards', createGuards());
```

Run: `npm test -w @shillex/server -- moderation` → PASS.

- [ ] **Step 3: Failing message/conversation tests**

`apps/server/test/messages.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestApp, type TestCtx, type TestUser } from './helpers.ts';
import { tokenMentions, notifications } from '../src/db/schema.ts';

const MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
let ctx: TestCtx; let mod: TestUser; let member: TestUser; let fresh: TestUser; let outsider: TestUser;
let pubChannel: string; let privChannel: string;

beforeAll(async () => {
  ctx = await makeTestApp();
  mod = await ctx.createUser('mod_mia'); member = await ctx.createUser('member_max'); outsider = await ctx.createUser('outsider_ola');
  fresh = await ctx.createUser('fresh_fred', { createdAt: new Date('2026-10-09T11:00:00Z') });
  await ctx.as(mod).post('/api/communities', { name: 'Trench', slug: 'trench', visibility: 'public' });
  await ctx.as(mod).post('/api/communities', { name: 'Vault', slug: 'vault', visibility: 'private' });
  for (const u of [member, fresh]) await ctx.as(u).post('/api/communities/trench/join');
  pubChannel = (await ctx.as(mod).get('/api/communities/trench')).body.community.channels[0].id;
  privChannel = (await ctx.as(mod).get('/api/communities/vault')).body.community.channels[0].id;
});
afterAll(() => ctx.close());
beforeEach(() => { ctx.bus.clear(); ctx.clock.advance(61_000); });

describe('channel messages', () => {
  it('members post; message is broadcast and public mentions recorded', async () => {
    const r = await ctx.as(member).post(`/api/channels/${pubChannel}/messages`, { body: `aping ${MINT}`, nonce: 'n1' });
    expect(r.status).toBe(201);
    expect(r.body.message).toMatchObject({ body: `aping ${MINT}`, mints: [MINT], nonce: 'n1', status: 'visible', scope: { type: 'channel', id: pubChannel } });
    expect(ctx.bus.find('message:new').map((e) => e.target)).toContain(`channel:${pubChannel}`);
    expect(ctx.bus.find('channel:activity').map((e) => e.target)).toContain(expect.stringMatching(/^community:/));
    const m = await ctx.db.select().from(tokenMentions).where(eq(tokenMentions.sourceId, r.body.message.id));
    expect(m[0]).toMatchObject({ isPublic: true, channelId: pubChannel });
  });
  it('non-members can read public channels but not post', async () => {
    expect((await ctx.as(outsider).get(`/api/channels/${pubChannel}/messages`)).status).toBe(200);
    expect((await ctx.as(outsider).post(`/api/channels/${pubChannel}/messages`, { body: 'hi' })).body.code).toBe('JOIN_TO_POST');
    expect((await ctx.as(outsider).get(`/api/channels/${privChannel}/messages`)).status).toBe(403);
  });
  it('private channel mentions are never public', async () => {
    const r = await ctx.as(mod).post(`/api/channels/${privChannel}/messages`, { body: `secret ${MINT}` });
    const m = await ctx.db.select().from(tokenMentions).where(eq(tokenMentions.sourceId, r.body.message.id));
    expect(m[0]!.isPublic).toBe(false);
  });
  it('replies must target the same scope and show a preview', async () => {
    const a = (await ctx.as(member).post(`/api/channels/${pubChannel}/messages`, { body: 'original take' })).body.message;
    ctx.clock.advance(61_000);
    const b = await ctx.as(mod).post(`/api/channels/${pubChannel}/messages`, { body: 'agree', replyToId: a.id });
    expect(b.body.message.replyTo).toMatchObject({ id: a.id, snippet: 'original take', author: { username: 'member_max' } });
    const priv = (await ctx.as(mod).post(`/api/channels/${privChannel}/messages`, { body: 'priv msg' })).body.message;
    expect((await ctx.as(member).post(`/api/channels/${pubChannel}/messages`, { body: 'x', replyToId: priv.id })).status).toBe(400);
  });
  it('pagination returns oldest→newest with a before cursor', async () => {
    for (let i = 0; i < 5; i++) { ctx.clock.advance(61_000); await ctx.as(mod).post(`/api/channels/${pubChannel}/messages`, { body: `page msg ${i}` }); }
    const p1 = (await ctx.as(member).get(`/api/channels/${pubChannel}/messages?limit=3`)).body;
    expect(p1.items.map((m: any) => m.body)).toEqual(['page msg 2', 'page msg 3', 'page msg 4']);
    const p2 = (await ctx.as(member).get(`/api/channels/${pubChannel}/messages?limit=3&before=${p1.nextCursor}`)).body;
    expect(p2.items.at(-1).body).toBe('page msg 1');
    const after = (await ctx.as(member).get(`/api/channels/${pubChannel}/messages?after=${p1.items[0].id}`)).body;
    expect(after.items.map((m: any) => m.body)).toEqual(['page msg 3', 'page msg 4']);
  });
  it('@mentions in channels notify readable members only', async () => {
    await ctx.as(member).post(`/api/channels/${pubChannel}/messages`, { body: 'ping @mod_mia' });
    const n = await ctx.db.select().from(notifications).where(eq(notifications.userId, mod.id));
    expect(n.some((x) => x.type === 'mention' && (x.data as any).href?.includes('/c/trench/'))).toBe(true);
  });
});

describe('spam controls', () => {
  it('slow mode blocks non-mods and reports retry-after; mods are exempt', async () => {
    await ctx.as(mod).patch(`/api/channels/${pubChannel}`, { slowModeSeconds: 30 });
    expect((await ctx.as(member).post(`/api/channels/${pubChannel}/messages`, { body: 'first slow' })).status).toBe(201);
    ctx.clock.advance(10_000);
    const r = await ctx.as(member).post(`/api/channels/${pubChannel}/messages`, { body: 'second slow' });
    expect(r.status).toBe(429);
    expect(r.body).toMatchObject({ code: 'SLOW_MODE', details: { retryAfterSec: 20 } });
    expect((await ctx.as(mod).post(`/api/channels/${pubChannel}/messages`, { body: 'mod a' })).status).toBe(201);
    expect((await ctx.as(mod).post(`/api/channels/${pubChannel}/messages`, { body: 'mod b' })).status).toBe(201);
    await ctx.as(mod).patch(`/api/channels/${pubChannel}`, { slowModeSeconds: 0 });
  });
  it('duplicate text within 60s is rejected', async () => {
    expect((await ctx.as(member).post(`/api/channels/${pubChannel}/messages`, { body: 'this is the play' })).status).toBe(201);
    ctx.clock.advance(1000);
    expect((await ctx.as(member).post(`/api/channels/${pubChannel}/messages`, { body: 'THIS is the  play' })).body.code).toBe('DUPLICATE');
  });
  it('rate limit: 10 messages per 10s', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await ctx.as(member).post(`/api/channels/${pubChannel}/messages`, { body: `burst number ${i}` })).status);
    expect(codes.slice(0, 10).every((c) => c === 201)).toBe(true);
    expect(codes[10]).toBe(429);
  });
  it('new accounts are capped at 2 links/mentions', async () => {
    const r = await ctx.as(fresh).post(`/api/channels/${pubChannel}/messages`, { body: `${MINT} https://a.io https://b.io` });
    expect(r.body.code).toBe('TOO_MANY_LINKS');
    expect((await ctx.as(fresh).post(`/api/channels/${pubChannel}/messages`, { body: `${MINT} https://a.io` })).status).toBe(201);
  });
  it('held posts are visible only to author and mods until approved', async () => {
    await ctx.as(mod).patch(`/api/channels/${pubChannel}`, { holdNewMemberPosts: true });
    const newbie = await ctx.createUser('newbie_ned');
    await ctx.as(newbie).post('/api/communities/trench/join');
    const r = await ctx.as(newbie).post(`/api/channels/${pubChannel}/messages`, { body: `held ${MINT}` });
    expect(r.body.message.status).toBe('held');
    expect(ctx.bus.find('message:new').map((e) => e.target).sort()).toEqual([`user:${mod.id}`, `user:${newbie.id}`].sort());
    expect(await ctx.db.select().from(tokenMentions).where(eq(tokenMentions.sourceId, r.body.message.id))).toHaveLength(0);
    const seenByMember = (await ctx.as(member).get(`/api/channels/${pubChannel}/messages?limit=100`)).body.items.map((m: any) => m.id);
    expect(seenByMember).not.toContain(r.body.message.id);
    expect((await ctx.as(member).post(`/api/messages/${r.body.message.id}/approve`)).status).toBe(403);
    const ok = await ctx.as(mod).post(`/api/messages/${r.body.message.id}/approve`);
    expect(ok.body.message.status).toBe('visible');
    expect(await ctx.db.select().from(tokenMentions).where(eq(tokenMentions.sourceId, r.body.message.id))).toHaveLength(1);
    await ctx.as(mod).patch(`/api/channels/${pubChannel}`, { holdNewMemberPosts: false });
  });
});

describe('message actions', () => {
  it('reactions carry userIds; deletion by author or mod tombstones and removes mentions', async () => {
    const m = (await ctx.as(member).post(`/api/channels/${pubChannel}/messages`, { body: `del me ${MINT}` })).body.message;
    const r = await ctx.as(mod).put(`/api/messages/${m.id}/reactions/${encodeURIComponent('🚀')}`);
    expect(r.body.reactions).toEqual([{ emoji: '🚀', count: 1, mine: true, userIds: [mod.id] }]);
    expect(ctx.bus.find('message:update').length).toBe(1);
    expect((await ctx.as(outsider).del(`/api/messages/${m.id}`)).status).toBe(403);
    expect((await ctx.as(mod).del(`/api/messages/${m.id}`)).status).toBe(204);
    expect(await ctx.db.select().from(tokenMentions).where(eq(tokenMentions.sourceId, m.id))).toHaveLength(0);
    const page = (await ctx.as(member).get(`/api/channels/${pubChannel}/messages?limit=100`)).body.items;
    expect(page.find((x: any) => x.id === m.id)).toMatchObject({ status: 'deleted', body: '', mints: [] });
  });
  it('read markers drive unread counts', async () => {
    ctx.clock.advance(61_000);
    const last = (await ctx.as(mod).post(`/api/channels/${pubChannel}/messages`, { body: 'unread test' })).body.message;
    const before = (await ctx.as(member).get('/api/communities/trench')).body.community.channels[0].unread;
    expect(before).toBeGreaterThan(0);
    await ctx.as(member).post(`/api/channels/${pubChannel}/read`, { messageId: last.id });
    expect((await ctx.as(member).get('/api/communities/trench')).body.community.channels[0].unread).toBe(0);
  });
});
```

`apps/server/test/conversations.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestApp, type TestCtx, type TestUser } from './helpers.ts';
import { tokenMentions } from '../src/db/schema.ts';

const MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
let ctx: TestCtx; let a: TestUser; let b: TestUser; let c: TestUser; let d: TestUser;
beforeAll(async () => {
  ctx = await makeTestApp();
  a = await ctx.createUser('dm_a'); b = await ctx.createUser('dm_b'); c = await ctx.createUser('dm_c'); d = await ctx.createUser('dm_d');
});
afterAll(() => ctx.close());
beforeEach(() => { ctx.bus.clear(); ctx.clock.advance(61_000); });

describe('conversations', () => {
  let dmId: string; let groupId: string;
  it('creates a DM once (idempotent) and notifies', async () => {
    const r1 = await ctx.as(a).post('/api/conversations', { kind: 'dm', username: 'dm_b' });
    expect(r1.status).toBe(201);
    dmId = r1.body.conversation.id;
    const r2 = await ctx.as(b).post('/api/conversations', { kind: 'dm', username: 'dm_a' });
    expect(r2.status).toBe(200);
    expect(r2.body.conversation.id).toBe(dmId);
  });
  it('messages go to every member’s user room; private mentions are never public', async () => {
    const r = await ctx.as(a).post(`/api/conversations/${dmId}/messages`, { body: `check ${MINT}`, attachments: [{ type: 'token', mint: MINT }] });
    expect(r.status).toBe(201);
    expect(r.body.message.attachments).toEqual([{ type: 'token', mint: MINT }]);
    expect(ctx.bus.find('message:new').map((e) => e.target).sort()).toEqual([`user:${a.id}`, `user:${b.id}`].sort());
    const m = await ctx.db.select().from(tokenMentions).where(eq(tokenMentions.sourceId, r.body.message.id));
    expect(m.every((x) => x.isPublic === false)).toBe(true);
  });
  it('non-members get 404, never 403', async () => {
    expect((await ctx.as(c).get(`/api/conversations/${dmId}/messages`)).status).toBe(404);
    expect((await ctx.as(c).post(`/api/conversations/${dmId}/messages`, { body: 'hi' })).status).toBe(404);
  });
  it('groups: create, list with unread, rename, add, leave (with eviction)', async () => {
    const g = await ctx.as(a).post('/api/conversations', { kind: 'group', name: 'Degen desk', usernames: ['dm_b', 'dm_c'] });
    groupId = g.body.conversation.id;
    expect(g.body.conversation.members).toHaveLength(3);
    await ctx.as(b).post(`/api/conversations/${groupId}/messages`, { body: 'gm desk' });
    const list = (await ctx.as(c).get('/api/conversations')).body.conversations;
    expect(list.find((x: any) => x.id === groupId)).toMatchObject({ unread: 1, lastMessage: { body: 'gm desk' } });
    expect((await ctx.as(a).patch(`/api/conversations/${groupId}`, { name: 'Desk 2' })).body.conversation.name).toBe('Desk 2');
    expect((await ctx.as(a).post(`/api/conversations/${groupId}/members`, { usernames: ['dm_d'] })).body.conversation.members).toHaveLength(4);
    expect((await ctx.as(c).del(`/api/conversations/${groupId}/members/me`)).status).toBe(204);
    expect(ctx.bus.evictions).toContainEqual({ userId: c.id, room: `conversation:${groupId}` });
    expect((await ctx.as(c).get(`/api/conversations/${groupId}/messages`)).status).toBe(404);
  });
  it('blocks prevent DMs both ways', async () => {
    await ctx.as(d).put('/api/users/dm_a/block');
    expect((await ctx.as(a).post('/api/conversations', { kind: 'dm', username: 'dm_d' })).body.code).toBe('BLOCKED');
    const existing = await ctx.as(a).post('/api/conversations', { kind: 'dm', username: 'dm_b' });
    expect(existing.status).toBe(200);
    await ctx.as(b).put('/api/users/dm_a/block');
    expect((await ctx.as(a).post(`/api/conversations/${dmId}/messages`, { body: 'still there?' })).body.code).toBe('BLOCKED');
  });
  it('group size is capped at 20', async () => {
    const many = await Promise.all(Array.from({ length: 20 }, (_, i) => ctx.createUser(`bulk_${i}`)));
    const r = await ctx.as(c).post('/api/conversations', { kind: 'group', name: 'Too big', usernames: many.map((u) => u.username) });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('GROUP_TOO_LARGE');
  });
  it('search only covers conversations you are in', async () => {
    await ctx.as(c).post('/api/conversations', { kind: 'dm', username: 'dm_d' });
    const hits = (await ctx.as(c).get('/api/search/messages?q=check')).body.hits;
    expect(hits).toEqual([]);
    const hitsA = (await ctx.as(a).get('/api/search/messages?q=check')).body.hits;
    expect(hitsA[0].message.body).toContain('check');
  });
});
```

`apps/server/test/pins-reports.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, type TestCtx, type TestUser } from './helpers.ts';

let ctx: TestCtx; let mod: TestUser; let user: TestUser; let channelId: string; let communityId: string;
beforeAll(async () => {
  ctx = await makeTestApp();
  mod = await ctx.createUser('pin_mod'); user = await ctx.createUser('pin_user');
  await ctx.as(mod).post('/api/communities', { name: 'Pins', slug: 'pins', visibility: 'public' });
  await ctx.as(user).post('/api/communities/pins/join');
  const d = (await ctx.as(mod).get('/api/communities/pins')).body.community;
  channelId = d.channels[0].id; communityId = d.community.id;
});
afterAll(() => ctx.close());

describe('pins', () => {
  it('mods pin messages and posts from their community only', async () => {
    const m = (await ctx.as(user).post(`/api/channels/${channelId}/messages`, { body: 'pin me' })).body.message;
    expect((await ctx.as(user).post('/api/communities/pins/pins', { targetType: 'message', targetId: m.id })).status).toBe(403);
    const pin = await ctx.as(mod).post('/api/communities/pins/pins', { targetType: 'message', targetId: m.id });
    expect(pin.status).toBe(201);
    const outside = (await ctx.as(mod).post('/api/posts', { body: 'not community' })).body.post;
    expect((await ctx.as(mod).post('/api/communities/pins/pins', { targetType: 'post', targetId: outside.id })).status).toBe(400);
    const list = (await ctx.as(user).get('/api/communities/pins/pins')).body.pins;
    expect(list[0]).toMatchObject({ channelId, message: { body: 'pin me' } });
    expect((await ctx.as(mod).del(`/api/pins/${list[0].id}`)).status).toBe(204);
  });
});

describe('reports', () => {
  it('reports route to community mods who can remove content', async () => {
    const m = (await ctx.as(mod).post(`/api/channels/${channelId}/messages`, { body: 'spammy link farm' })).body.message;
    const r = await ctx.as(user).post('/api/reports', { targetType: 'message', targetId: m.id, reason: 'spam' });
    expect(r.status).toBe(201);
    expect((await ctx.as(user).get('/api/communities/pins/reports')).status).toBe(403);
    const reports = (await ctx.as(mod).get('/api/communities/pins/reports')).body.reports;
    expect(reports[0]).toMatchObject({ reason: 'spam', status: 'open', preview: { body: 'spammy link farm' } });
    expect((await ctx.as(mod).post(`/api/reports/${reports[0].id}/resolve`, { action: 'remove_content' })).status).toBe(204);
    const page = (await ctx.as(user).get(`/api/channels/${channelId}/messages`)).body.items;
    expect(page.find((x: any) => x.id === m.id).status).toBe('deleted');
    expect((await ctx.as(user).get('/api/notifications')).body.items[0].type).toBe('report_resolved');
  });
  it('cannot report content you cannot read', async () => {
    expect((await ctx.as(user).post('/api/reports', { targetType: 'message', targetId: 'nope', reason: 'x' })).status).toBe(404);
  });
  it('validates communityId linkage', () => { expect(communityId).toBeTruthy(); });
});
```

Run: `npm test -w @shillex/server` → Expected: FAIL (routes missing).

- [ ] **Step 4: `hydrateMessages`**

Append to `apps/server/src/services/hydrate.ts`:
```ts
import { uniqueMints, type MessageView } from '@shillex/shared';
import { messages, type MessageRow } from '../db/schema.ts';

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
    const reacts = [...(reactBy.get(r.id) ?? new Map()).entries()]
      .map(([emoji, userIds]) => ({ emoji: emoji as ReactionEmoji, count: userIds.length, mine: userIds.includes(viewerId), userIds: userIds.slice(0, 50) }))
      .sort((a, b) => REACTIONS.indexOf(a.emoji) - REACTIONS.indexOf(b.emoji));
    return {
      id: r.id,
      scope: r.channelId ? { type: 'channel' as const, id: r.channelId } : { type: 'conversation' as const, id: r.conversationId! },
      author: authors.get(r.authorId)!,
      body: deleted ? '' : r.body,
      replyTo: reply ? {
        id: reply.id, author: authors.get(reply.authorId)!, deleted: reply.status === 'deleted',
        snippet: reply.status === 'deleted' ? '' : reply.body.slice(0, 120),
      } : null,
      attachments: deleted ? [] : r.attachments,
      reactions: deleted ? [] : reacts,
      status: r.status,
      mints: deleted ? [] : [...new Set([...uniqueMints(r.body), ...tokenAttachments])],
      createdAt: r.createdAt.toISOString(),
      nonce: null,
    };
  });
}
```
Merge these imports into the file's existing import lines (do not duplicate `import` statements).

- [ ] **Step 5: `services/messages.ts`**

`apps/server/src/services/messages.ts`:
```ts
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { LIMITS, codePointLength, extractMentions, isValidSolanaAddress, type ScopeRef, type TokenView, type MessageView } from '@shillex/shared';
import type { AppDeps } from '../deps.ts';
import type { Db } from '../db/client.ts';
import { messages, channels, communities, communityMembers, conversationMembers, users, type ChannelRow, type MessageRow, type UserRow } from '../db/schema.ts';
import { AppError, errors } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { resolveUploads } from '../routes/uploads.ts';
import { computeMentionVisibility, getCommunityAccess, isBlockedEitherWay, requireChannel, requireConversationMember } from './visibility.ts';
import { recordMentions } from './mentions.ts';
import { notify } from './notify.ts';
import { hydrateMessages } from './hydrate.ts';
import { markRead } from './unread.ts';
import { checkSlowMode, isNewAccount, linkMentionCount, type MessageGuards } from './moderation.ts';

export type AttachmentInput = { type: 'image'; uploadId: string; alt?: string } | { type: 'token'; mint: string };
export interface SendMessageInput { scope: ScopeRef; author: UserRow; body: string; replyToId?: string; attachments?: AttachmentInput[]; nonce?: string }

export async function memberIdsOf(db: Db, conversationId: string): Promise<string[]> {
  return (await db.select({ u: conversationMembers.userId }).from(conversationMembers).where(eq(conversationMembers.conversationId, conversationId))).map((r) => r.u);
}
async function modIdsOf(db: Db, communityId: string): Promise<string[]> {
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

  const rate = guards.rate.hit(input.author.id, at.getTime());
  if (!rate.ok) throw errors.tooMany('RATE_LIMITED', 'You’re sending messages too fast', rate.retryAfterSec);
  if (isNewAccount(input.author.createdAt, at) && linkMentionCount(body) > LIMITS.newAccountLinkMentionCap) {
    throw errors.badRequest('TOO_MANY_LINKS', `New accounts can include up to ${LIMITS.newAccountLinkMentionCap} links, mentions or addresses per message`);
  }
  if (channel && channel.slowModeSeconds > 0 && !isMod) {
    const [last] = await db.select({ at: messages.createdAt }).from(messages)
      .where(and(eq(messages.channelId, channel.id), eq(messages.authorId, input.author.id))).orderBy(desc(messages.id)).limit(1);
    const sm = checkSlowMode(last?.at ?? null, channel.slowModeSeconds, at);
    if (!sm.ok) throw new AppError(429, 'SLOW_MODE', `Slow mode is on — wait ${sm.retryAfterSec}s`, { retryAfterSec: sm.retryAfterSec });
  }
  if (body && guards.dupes.isDuplicate(input.author.id, body, at.getTime())) throw errors.tooMany('DUPLICATE', 'You just sent that');

  if (input.replyToId) {
    const [target] = await db.select().from(messages).where(eq(messages.id, input.replyToId));
    const same = target && (channel ? target.channelId === channel.id : target.conversationId === input.scope.id);
    if (!same) throw errors.badRequest('BAD_REPLY', 'You can only reply within the same conversation');
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
```

- [ ] **Step 6: `routes/messages.ts`**

`apps/server/src/routes/messages.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, desc, eq, gt, lt, ne, or } from 'drizzle-orm';
import { REACTIONS, type MessageView, type Page } from '@shillex/shared';
import { messages, reactions, communities } from '../db/schema.ts';
import { requireUser } from '../lib/auth.ts';
import { parse } from '../lib/validate.ts';
import { errors } from '../lib/errors.ts';
import { clampLimit } from '../lib/pagination.ts';
import { requireChannel, requireConversationMember } from '../services/visibility.ts';
import { hydrateMessages } from '../services/hydrate.ts';
import { afterVisible, emitMessage, loadMessageAccess, sendMessage } from '../services/messages.ts';
import { removeMentions } from '../services/mentions.ts';
import { markRead } from '../services/unread.ts';

const Send = z.object({
  body: z.string().max(10_000).default(''),
  replyToId: z.string().optional(),
  nonce: z.string().max(64).optional(),
  attachments: z.array(z.discriminatedUnion('type', [
    z.object({ type: z.literal('image'), uploadId: z.string(), alt: z.string().max(200).optional() }),
    z.object({ type: z.literal('token'), mint: z.string() }),
  ])).max(5).optional(),
});

export default async function messagesRoutes(app: FastifyInstance) {
  const deps = app.deps;
  const { db, now } = deps;

  async function list(scope: 'channel' | 'conversation', id: string, viewerId: string, isMod: boolean, q: { before?: string; after?: string; limit?: string }) {
    const limit = clampLimit(q.limit, 50, 100);
    const scopeCol = scope === 'channel' ? messages.channelId : messages.conversationId;
    const visibleToMe = or(ne(messages.status, 'held'), eq(messages.authorId, viewerId), isMod ? eq(messages.status, 'held') : undefined);
    if (q.after) {
      const rows = await db.select().from(messages).where(and(eq(scopeCol, id), visibleToMe, gt(messages.id, q.after))).orderBy(asc(messages.id)).limit(limit);
      const items = await hydrateMessages(db, viewerId, rows);
      return { items, nextCursor: null, tokens: await deps.tokens.getViews(items.flatMap((m) => m.mints)) } satisfies Page<MessageView>;
    }
    const rows = await db.select().from(messages).where(and(eq(scopeCol, id), visibleToMe, q.before ? lt(messages.id, q.before) : undefined))
      .orderBy(desc(messages.id)).limit(limit + 1);
    const pageRows = rows.slice(0, limit).reverse();
    const items = await hydrateMessages(db, viewerId, pageRows);
    const page: Page<MessageView> = { items, nextCursor: rows.length > limit ? pageRows[0]!.id : null, tokens: await deps.tokens.getViews(items.flatMap((m) => m.mints)) };
    return page;
  }

  app.get<{ Params: { id: string }; Querystring: { before?: string; after?: string; limit?: string } }>('/channels/:id/messages', async (req) => {
    const me = requireUser(req);
    const { access } = await requireChannel(db, req.params.id, me.id, 'read');
    return list('channel', req.params.id, me.id, access.isMod, req.query);
  });
  app.get<{ Params: { id: string }; Querystring: { before?: string; after?: string; limit?: string } }>('/conversations/:id/messages', async (req) => {
    const me = requireUser(req);
    await requireConversationMember(db, req.params.id, me.id);
    return list('conversation', req.params.id, me.id, false, req.query);
  });

  for (const scope of ['channel', 'conversation'] as const) {
    app.post<{ Params: { id: string } }>(`/${scope}s/:id/messages`, async (req, reply) => {
      const me = requireUser(req);
      const body = parse(Send, req.body);
      const r = await sendMessage(deps, app.guards, { scope: { type: scope, id: req.params.id }, author: me, ...body });
      return reply.status(201).send({ message: r.view, tokens: r.tokens });
    });
    app.post<{ Params: { id: string } }>(`/${scope}s/:id/read`, async (req, reply) => {
      const me = requireUser(req);
      const { messageId } = parse(z.object({ messageId: z.string() }), req.body);
      if (scope === 'channel') await requireChannel(db, req.params.id, me.id, 'read');
      else await requireConversationMember(db, req.params.id, me.id);
      await markRead(db, me.id, scope, req.params.id, messageId);
      return reply.status(204).send();
    });
  }

  app.delete<{ Params: { id: string } }>('/messages/:id', async (req, reply) => {
    const me = requireUser(req);
    const { row, isMod } = await loadMessageAccess(db, req.params.id, me.id);
    if (row.authorId !== me.id && !isMod) throw errors.forbidden('NOT_ALLOWED', 'Only the author or a moderator can delete this');
    const [upd] = await db.update(messages).set({ status: 'deleted' }).where(eq(messages.id, row.id)).returning();
    await removeMentions(db, 'message', row.id);
    await emitMessage(deps, upd!, 'message:update');
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>('/messages/:id/approve', async (req) => {
    const me = requireUser(req);
    const { row, isMod, channel } = await loadMessageAccess(db, req.params.id, me.id);
    if (!isMod || !channel) throw errors.forbidden('MODS_ONLY', 'Only moderators can approve messages');
    if (row.status !== 'held') throw errors.badRequest('NOT_HELD', 'This message is not awaiting approval');
    const [upd] = await db.update(messages).set({ status: 'visible' }).where(eq(messages.id, row.id)).returning();
    const [c] = await db.select({ v: communities.visibility }).from(communities).where(eq(communities.id, channel.communityId));
    await afterVisible(deps, upd!, channel, c!.v);
    const [view] = await hydrateMessages(db, me.id, [upd!]);
    await emitMessage(deps, upd!, 'message:new', { tokens: await deps.tokens.getViews(view!.mints) });
    return { message: view };
  });

  app.put<{ Params: { id: string; emoji: string } }>('/messages/:id/reactions/:emoji', async (req) => {
    const me = requireUser(req);
    const emoji = decodeURIComponent(req.params.emoji);
    if (!(REACTIONS as readonly string[]).includes(emoji)) throw errors.badRequest('BAD_REACTION', 'Unsupported reaction');
    const { row } = await loadMessageAccess(db, req.params.id, me.id);
    if (row.status !== 'visible') throw errors.badRequest('NOT_VISIBLE', 'You can’t react to this message');
    await db.insert(reactions).values({ targetType: 'message', targetId: row.id, userId: me.id, emoji, createdAt: now() }).onConflictDoNothing();
    await emitMessage(deps, row, 'message:update');
    const [view] = await hydrateMessages(db, me.id, [row]);
    return { reactions: view!.reactions };
  });
  app.delete<{ Params: { id: string; emoji: string } }>('/messages/:id/reactions/:emoji', async (req) => {
    const me = requireUser(req);
    const { row } = await loadMessageAccess(db, req.params.id, me.id);
    await db.delete(reactions).where(and(eq(reactions.targetType, 'message'), eq(reactions.targetId, row.id), eq(reactions.userId, me.id), eq(reactions.emoji, decodeURIComponent(req.params.emoji))));
    await emitMessage(deps, row, 'message:update');
    const [view] = await hydrateMessages(db, me.id, [row]);
    return { reactions: view!.reactions };
  });
}
```

- [ ] **Step 7: `routes/conversations.ts`**

`apps/server/src/routes/conversations.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { LIMITS, type ConversationView } from '@shillex/shared';
import { conversations, conversationMembers, messages, type ConversationRow } from '../db/schema.ts';
import { requireUser } from '../lib/auth.ts';
import { parse } from '../lib/validate.ts';
import { errors } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { requireConversationMember, isBlockedEitherWay } from '../services/visibility.ts';
import { hydrateMessages, userSummaries } from '../services/hydrate.ts';
import { unreadInScope } from '../services/unread.ts';
import { memberIdsOf } from '../services/messages.ts';
import { notify } from '../services/notify.ts';
import { loadUserByUsername } from './users.ts';

const Create = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('dm'), username: z.string() }),
  z.object({ kind: z.literal('group'), name: z.string().trim().min(1).max(40), usernames: z.array(z.string()).min(1).max(50) }),
]);

export default async function conversationsRoutes(app: FastifyInstance) {
  const deps = app.deps;
  const { db, now, bus } = deps;

  async function view(c: ConversationRow, viewerId: string): Promise<ConversationView> {
    const members = await db.select().from(conversationMembers).where(eq(conversationMembers.conversationId, c.id));
    const me = members.find((m) => m.userId === viewerId)!;
    const summaries = await userSummaries(db, members.map((m) => m.userId));
    const [last] = await db.select().from(messages).where(and(eq(messages.conversationId, c.id), eq(messages.status, 'visible'))).orderBy(desc(messages.id)).limit(1);
    return {
      id: c.id, kind: c.kind, name: c.name, createdAt: c.createdAt.toISOString(), muted: me.muted,
      members: members.map((m) => summaries.get(m.userId)!).filter(Boolean),
      lastMessage: last ? (await hydrateMessages(db, viewerId, [last]))[0]! : null,
      unread: await unreadInScope(db, { userId: viewerId, scopeType: 'conversation', scopeId: c.id, since: me.joinedAt }),
    };
  }
  const notifyUpdate = async (id: string) => { for (const u of await memberIdsOf(db, id)) bus.toUser(u, 'conversation:update', { conversationId: id }); };

  app.get('/conversations', async (req) => {
    const me = requireUser(req);
    const rows = (await db.select({ c: conversations }).from(conversationMembers).innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
      .where(eq(conversationMembers.userId, me.id))).map((r) => r.c);
    const views = await Promise.all(rows.map((c) => view(c, me.id)));
    views.sort((a, b) => (b.lastMessage?.id ?? b.createdAt).localeCompare(a.lastMessage?.id ?? a.createdAt));
    return { conversations: views };
  });

  app.post('/conversations', async (req, reply) => {
    const me = requireUser(req);
    const body = parse(Create, req.body);
    if (body.kind === 'dm') {
      const other = await loadUserByUsername(db, body.username);
      if (other.id === me.id) throw errors.badRequest('SELF', 'You can’t DM yourself');
      const dmKey = [me.id, other.id].sort().join(':');
      const [existing] = await db.select().from(conversations).where(eq(conversations.dmKey, dmKey));
      if (existing) return reply.status(200).send({ conversation: await view(existing, me.id) });
      if (await isBlockedEitherWay(db, me.id, other.id)) throw errors.forbidden('BLOCKED', 'You can’t message this account');
      const id = newId();
      const [c] = await db.insert(conversations).values({ id, kind: 'dm', dmKey, createdBy: me.id, createdAt: now() }).returning();
      await db.insert(conversationMembers).values([me.id, other.id].map((userId) => ({ conversationId: id, userId, joinedAt: now() })));
      await notify(deps, { userId: other.id, type: 'dm', actorId: me.id, targetType: 'user', targetId: me.id, data: { conversationId: id } });
      await notifyUpdate(id);
      return reply.status(201).send({ conversation: await view(c!, me.id) });
    }
    const others = [];
    for (const u of [...new Set(body.usernames.map((x) => x.toLowerCase()))]) {
      const row = await loadUserByUsername(db, u);
      if (row.id !== me.id && !(await isBlockedEitherWay(db, me.id, row.id))) others.push(row);
    }
    if (others.length + 1 > LIMITS.groupMax) throw errors.badRequest('GROUP_TOO_LARGE', `Groups can have up to ${LIMITS.groupMax} members`);
    if (!others.length) throw errors.badRequest('NO_MEMBERS', 'Add at least one person');
    const id = newId();
    const [c] = await db.insert(conversations).values({ id, kind: 'group', name: body.name, createdBy: me.id, createdAt: now() }).returning();
    await db.insert(conversationMembers).values([me, ...others].map((u) => ({ conversationId: id, userId: u.id, joinedAt: now() })));
    for (const o of others) await notify(deps, { userId: o.id, type: 'dm', actorId: me.id, targetType: 'user', targetId: me.id, data: { conversationId: id } });
    await notifyUpdate(id);
    return reply.status(201).send({ conversation: await view(c!, me.id) });
  });

  app.get<{ Params: { id: string } }>('/conversations/:id', async (req) => {
    const me = requireUser(req);
    return { conversation: await view(await requireConversationMember(db, req.params.id, me.id), me.id) };
  });

  app.patch<{ Params: { id: string } }>('/conversations/:id', async (req) => {
    const me = requireUser(req);
    const c = await requireConversationMember(db, req.params.id, me.id);
    const body = parse(z.object({ name: z.string().trim().min(1).max(40).optional(), muted: z.boolean().optional() }), req.body);
    if (body.name !== undefined) {
      if (c.kind !== 'group') throw errors.badRequest('DM_NO_NAME', 'Direct messages can’t be renamed');
      await db.update(conversations).set({ name: body.name }).where(eq(conversations.id, c.id));
      await notifyUpdate(c.id);
    }
    if (body.muted !== undefined) await db.update(conversationMembers).set({ muted: body.muted }).where(and(eq(conversationMembers.conversationId, c.id), eq(conversationMembers.userId, me.id)));
    return { conversation: await view((await db.select().from(conversations).where(eq(conversations.id, c.id)))[0]!, me.id) };
  });

  app.post<{ Params: { id: string } }>('/conversations/:id/members', async (req) => {
    const me = requireUser(req);
    const c = await requireConversationMember(db, req.params.id, me.id);
    if (c.kind !== 'group') throw errors.badRequest('NOT_GROUP', 'Only group chats can add members');
    const { usernames } = parse(z.object({ usernames: z.array(z.string()).min(1).max(20) }), req.body);
    const current = await memberIdsOf(db, c.id);
    const add = [];
    for (const u of usernames) {
      const row = await loadUserByUsername(db, u);
      if (!current.includes(row.id) && !(await isBlockedEitherWay(db, me.id, row.id))) add.push(row);
    }
    if (current.length + add.length > LIMITS.groupMax) throw errors.badRequest('GROUP_TOO_LARGE', `Groups can have up to ${LIMITS.groupMax} members`);
    if (add.length) await db.insert(conversationMembers).values(add.map((u) => ({ conversationId: c.id, userId: u.id, joinedAt: now() })));
    await notifyUpdate(c.id);
    return { conversation: await view(c, me.id) };
  });

  app.delete<{ Params: { id: string } }>('/conversations/:id/members/me', async (req, reply) => {
    const me = requireUser(req);
    const c = await requireConversationMember(db, req.params.id, me.id);
    if (c.kind !== 'group') throw errors.badRequest('NOT_GROUP', 'You can’t leave a direct message; block or mute instead');
    await db.delete(conversationMembers).where(and(eq(conversationMembers.conversationId, c.id), eq(conversationMembers.userId, me.id)));
    bus.evict(me.id, `conversation:${c.id}`);
    await notifyUpdate(c.id);
    return reply.status(204).send();
  });
}
```

- [ ] **Step 8: `routes/pins.ts`, `routes/reports.ts`, `routes/search.ts`**

`apps/server/src/routes/pins.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { PinView } from '@shillex/shared';
import { pins, posts, messages, channels } from '../db/schema.ts';
import { requireUser } from '../lib/auth.ts';
import { parse } from '../lib/validate.ts';
import { errors } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { getCommunityAccess, getCommunityAccessBySlug, requireCommunityRead, requireMod } from '../services/visibility.ts';
import { hydrateMessages, hydratePosts } from '../services/hydrate.ts';

export default async function pinsRoutes(app: FastifyInstance) {
  const { db, now, bus } = app.deps;

  async function pinViews(rows: (typeof pins.$inferSelect)[], viewerId: string): Promise<PinView[]> {
    const postIds = rows.filter((r) => r.targetType === 'post').map((r) => r.targetId);
    const msgIds = rows.filter((r) => r.targetType === 'message').map((r) => r.targetId);
    const postViews = postIds.length ? await hydratePosts(db, viewerId, await db.select().from(posts).where(inArray(posts.id, postIds))) : [];
    const msgViews = msgIds.length ? await hydrateMessages(db, viewerId, await db.select().from(messages).where(inArray(messages.id, msgIds))) : [];
    return rows.map((r) => ({
      id: r.id, channelId: r.channelId, createdAt: r.createdAt.toISOString(),
      post: postViews.find((p) => p.id === r.targetId) ?? null, message: msgViews.find((m) => m.id === r.targetId) ?? null,
    })).filter((p) => !(p.post?.deleted || p.message?.status === 'deleted'));
  }

  app.get<{ Params: { slug: string } }>('/communities/:slug/pins', async (req) => {
    const me = requireUser(req);
    const a = requireCommunityRead(await getCommunityAccessBySlug(db, req.params.slug, me.id));
    const rows = await db.select().from(pins).where(eq(pins.communityId, a.community.id)).orderBy(desc(pins.id));
    return { pins: await pinViews(rows, me.id) };
  });

  app.post<{ Params: { slug: string } }>('/communities/:slug/pins', async (req, reply) => {
    const me = requireUser(req);
    const a = requireMod(requireCommunityRead(await getCommunityAccessBySlug(db, req.params.slug, me.id)));
    const body = parse(z.object({ targetType: z.enum(['post', 'message']), targetId: z.string() }), req.body);
    let channelId: string | null = null;
    if (body.targetType === 'post') {
      const [p] = await db.select().from(posts).where(eq(posts.id, body.targetId));
      if (!p || p.communityId !== a.community.id) throw errors.badRequest('WRONG_COMMUNITY', 'Only posts from this community can be pinned');
    } else {
      const [m] = await db.select({ m: messages, ch: channels }).from(messages).innerJoin(channels, eq(channels.id, messages.channelId)).where(eq(messages.id, body.targetId));
      if (!m || m.ch.communityId !== a.community.id) throw errors.badRequest('WRONG_COMMUNITY', 'Only messages from this community can be pinned');
      channelId = m.ch.id;
    }
    const [row] = await db.insert(pins).values({ id: newId(), communityId: a.community.id, channelId, targetType: body.targetType, targetId: body.targetId, pinnedBy: me.id, createdAt: now() }).returning();
    bus.toRoom(`community:${a.community.id}`, 'community:update', { communityId: a.community.id });
    return reply.status(201).send({ pin: (await pinViews([row!], me.id))[0] });
  });

  app.delete<{ Params: { id: string } }>('/pins/:id', async (req, reply) => {
    const me = requireUser(req);
    const [pin] = await db.select().from(pins).where(eq(pins.id, req.params.id));
    if (!pin) throw errors.notFound('Pin');
    const a = await getCommunityAccess(db, pin.communityId, me.id);
    if (!a?.isMod) throw errors.forbidden('MODS_ONLY', 'Only moderators can unpin');
    await db.delete(pins).where(and(eq(pins.id, pin.id)));
    bus.toRoom(`community:${pin.communityId}`, 'community:update', { communityId: pin.communityId });
    return reply.status(204).send();
  });
}
```

`apps/server/src/routes/reports.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import type { ReportView } from '@shillex/shared';
import { reports, posts, messages, users } from '../db/schema.ts';
import { requireUser } from '../lib/auth.ts';
import { parse } from '../lib/validate.ts';
import { errors } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { canReadPost, getCommunityAccess, getCommunityAccessBySlug, requireMod } from '../services/visibility.ts';
import { loadMessageAccess, emitMessage } from '../services/messages.ts';
import { removeMentions } from '../services/mentions.ts';
import { userSummaries } from '../services/hydrate.ts';
import { notify } from '../services/notify.ts';

const Body = z.object({ targetType: z.enum(['post', 'message', 'user']), targetId: z.string(), reason: z.string().trim().min(1).max(500) });

export default async function reportsRoutes(app: FastifyInstance) {
  const deps = app.deps;
  const { db, now } = deps;

  app.post('/reports', async (req, reply) => {
    const me = requireUser(req);
    const body = parse(Body, req.body);
    let communityId: string | null = null;
    if (body.targetType === 'post') {
      const [p] = await db.select().from(posts).where(eq(posts.id, body.targetId));
      if (!p || !(await canReadPost(db, p, me.id))) throw errors.notFound('Post');
      communityId = p.communityId;
    } else if (body.targetType === 'message') {
      const { channel } = await loadMessageAccess(db, body.targetId, me.id);
      communityId = channel?.communityId ?? null;
    } else {
      const [u] = await db.select().from(users).where(eq(users.id, body.targetId));
      if (!u) throw errors.notFound('User');
    }
    const id = newId();
    await db.insert(reports).values({ id, reporterId: me.id, ...body, communityId, createdAt: now() });
    return reply.status(201).send({ id });
  });

  app.get<{ Params: { slug: string } }>('/communities/:slug/reports', async (req) => {
    const me = requireUser(req);
    const a = await getCommunityAccessBySlug(db, req.params.slug, me.id);
    if (!a) throw errors.notFound('Community');
    requireMod(a);
    const rows = await db.select().from(reports).where(and(eq(reports.communityId, a.community.id), eq(reports.status, 'open'))).orderBy(desc(reports.id));
    const people = await userSummaries(db, rows.map((r) => r.reporterId));
    const out: ReportView[] = [];
    for (const r of rows) {
      let preview: ReportView['preview'] = null;
      if (r.targetType === 'post') {
        const [p] = await db.select().from(posts).where(eq(posts.id, r.targetId));
        if (p) preview = { author: (await userSummaries(db, [p.authorId])).get(p.authorId) ?? null, body: p.deletedAt ? '' : p.body };
      } else if (r.targetType === 'message') {
        const [m] = await db.select().from(messages).where(eq(messages.id, r.targetId));
        if (m) preview = { author: (await userSummaries(db, [m.authorId])).get(m.authorId) ?? null, body: m.status === 'deleted' ? '' : m.body };
      }
      out.push({ id: r.id, reporter: people.get(r.reporterId)!, targetType: r.targetType, targetId: r.targetId, reason: r.reason, status: r.status, createdAt: r.createdAt.toISOString(), preview });
    }
    return { reports: out };
  });

  app.post<{ Params: { id: string } }>('/reports/:id/resolve', async (req, reply) => {
    const me = requireUser(req);
    const { action } = parse(z.object({ action: z.enum(['dismiss', 'remove_content']) }), req.body);
    const [r] = await db.select().from(reports).where(eq(reports.id, req.params.id));
    if (!r || !r.communityId) throw errors.notFound('Report');
    const a = await getCommunityAccess(db, r.communityId, me.id);
    if (!a?.isMod) throw errors.forbidden('MODS_ONLY', 'Only moderators can resolve reports');
    if (action === 'remove_content') {
      if (r.targetType === 'post') {
        await db.update(posts).set({ deletedAt: now() }).where(eq(posts.id, r.targetId));
        await removeMentions(db, 'post', r.targetId);
      } else if (r.targetType === 'message') {
        const [upd] = await db.update(messages).set({ status: 'deleted' }).where(eq(messages.id, r.targetId)).returning();
        await removeMentions(db, 'message', r.targetId);
        if (upd) await emitMessage(deps, upd, 'message:update');
      }
    }
    await db.update(reports).set({ status: action === 'dismiss' ? 'dismissed' : 'resolved', resolvedBy: me.id }).where(eq(reports.id, r.id));
    await notify(deps, { userId: r.reporterId, type: 'report_resolved', actorId: null, targetType: 'report', targetId: r.id });
    return reply.status(204).send();
  });
}
```

`apps/server/src/routes/search.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, ilike, inArray } from 'drizzle-orm';
import type { MessageSearchHit } from '@shillex/shared';
import { messages, conversationMembers, conversations } from '../db/schema.ts';
import { requireUser } from '../lib/auth.ts';
import { hydrateMessages, userSummaries } from '../services/hydrate.ts';

export default async function searchRoutes(app: FastifyInstance) {
  const { db } = app.deps;
  app.get<{ Querystring: { q?: string; conversationId?: string } }>('/search/messages', async (req) => {
    const me = requireUser(req);
    const q = (req.query.q ?? '').trim().replace(/[%_\\]/g, '');
    if (q.length < 2) return { hits: [] };
    const mine = (await db.select({ id: conversationMembers.conversationId }).from(conversationMembers).where(eq(conversationMembers.userId, me.id))).map((r) => r.id);
    const scope = req.query.conversationId ? mine.filter((id) => id === req.query.conversationId) : mine;
    if (!scope.length) return { hits: [] };
    const rows = await db.select().from(messages).where(and(inArray(messages.conversationId, scope), eq(messages.status, 'visible'), ilike(messages.body, `%${q}%`)))
      .orderBy(desc(messages.id)).limit(50);
    const views = await hydrateMessages(db, me.id, rows);
    const convs = await db.select().from(conversations).where(inArray(conversations.id, [...new Set(rows.map((r) => r.conversationId!))]));
    const memberRows = await db.select().from(conversationMembers).where(inArray(conversationMembers.conversationId, convs.map((c) => c.id)));
    const names = await userSummaries(db, memberRows.map((m) => m.userId));
    const label = (id: string) => {
      const c = convs.find((x) => x.id === id)!;
      if (c.name) return c.name;
      return memberRows.filter((m) => m.conversationId === id && m.userId !== me.id).map((m) => names.get(m.userId)?.displayName).join(', ');
    };
    const hits: MessageSearchHit[] = views.map((m) => ({ message: m, conversation: { id: m.scope.id, name: label(m.scope.id) } }));
    return { hits };
  });
}
```

- [ ] **Step 9: Register, run, commit**

Register `messagesRoutes`, `conversationsRoutes`, `pinsRoutes`, `reportsRoutes`, `searchRoutes` with `/api`.
Run: `npm test -w @shillex/server && npm run typecheck -w @shillex/server` → PASS.
```bash
git add apps/server
git commit -m "feat(server): channel and private messaging with spam controls, pins, reports, search"
```

---

### Task 11: Token resolver and token routes

**Files:**
- Create: `apps/server/src/tokens/rpc.ts`, `tokens/dexscreener.ts`, `tokens/resolver.ts`
- Create: `apps/server/src/services/token-subs.ts`
- Create: `apps/server/src/routes/tokens.ts`
- Modify: `apps/server/src/services/posts.ts` and `services/messages.ts` (call `notifyTokenSubscribers` for public mentions), `apps/server/src/index.ts` (use `TokenResolver`), `src/app.ts` (register `tokensRoutes`)
- Test: `apps/server/test/resolver.test.ts`, `apps/server/test/tokens.test.ts`

**Interfaces:**
- Consumes: `readTokenViews`, `tokenRowToView`, `pendingTokenView`, `isStale` (Task 6), `EventBus`.
- Produces:
  - `class UpstreamError extends Error`
  - `fetchMintAccount(rpcUrl, mint, fetchImpl?, timeoutMs?): Promise<MintAccount>` where `MintAccount = { kind: 'mint'; program: 'spl-token' | 'spl-token-2022'; decimals: number | null; name: string | null; symbol: string | null } | { kind: 'not_mint' }`
  - `fetchDexBest(mint, fetchImpl?, timeoutMs?): Promise<DexBest | null>`
  - `class TokenResolver implements TokenResolverPort` — constructor `{ db, bus, rpcUrl, live, fetchImpl?, now?, concurrency? }`
  - `notifyTokenSubscribers(deps, mints: string[], actorId: string): Promise<void>` (≤1 notification per user per token per hour)
  - Routes:
    - `GET /api/tokens/:mint` → `{ token: TokenView; links: ExternalLink[]; stats: TokenDiscussionStats }` (400 `INVALID_ADDRESS`)
    - `POST /api/tokens/resolve` `{ mints: string[] (≤25) }` → `{ tokens: Record<string, TokenView> }`
    - `GET /api/tokens/:mint/posts?cursor` → `Page<PostView>` (public mentions only)
    - `GET /api/tokens/:mint/chat?cursor` → `Page<PublicChatMention>` (public-community channel messages only)
    - `PUT|DELETE /api/tokens/:mint/subscription` → `{ subscribed: boolean }`

- [ ] **Step 1: Failing resolver tests (includes Review Focus #2)**

`apps/server/test/resolver.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, type DbHandle } from '../src/db/client.ts';
import { tokens } from '../src/db/schema.ts';
import { TokenResolver } from '../src/tokens/resolver.ts';
import { RecordingBus } from '../src/realtime/bus.ts';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@shillex/shared';

const MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const PAIR = '5zpyutJu9ee6jFymDGoK7F6S5Kczqtc9FomP3ueKuyA9';
const PAIR2 = 'So11111111111111111111111111111111111111112';
const RPC = 'https://rpc.test';

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
function fakeFetch(h: { rpc?: Handler; dex?: Handler }) {
  const calls = { rpc: 0, dex: 0 };
  const f = (async (input: any, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith(RPC)) { calls.rpc++; return h.rpc!(url, init); }
    if (url.startsWith('https://api.dexscreener.com/')) { calls.dex++; return h.dex!(url, init); }
    throw new Error(`unexpected ${url}`);
  }) as typeof fetch;
  return { f, calls };
}
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
const mintAccount = (owner = TOKEN_PROGRAM_ID, extra: object = {}) => json({ jsonrpc: '2.0', id: 1, result: { value: { owner, data: { parsed: { type: 'mint', info: { decimals: 6, ...extra } }, program: 'spl-token' } } } });
const pair = (o: Partial<{ base: string; liq: number | undefined; pairAddress: string; mcap: number }>) => ({
  chainId: 'solana', dexId: 'raydium', pairAddress: o.pairAddress ?? PAIR,
  baseToken: { address: o.base ?? MINT, name: 'Bonk', symbol: 'BONK' }, quoteToken: { address: PAIR2, name: 'SOL', symbol: 'SOL' },
  liquidity: o.liq === undefined ? undefined : { usd: o.liq }, marketCap: o.mcap ?? 1_000_000, fdv: 1_100_000,
  pairCreatedAt: Date.parse('2026-10-01T00:00:00Z'), info: { imageUrl: 'https://cdn.dexscreener.com/x.png' },
});

let h: DbHandle; let bus: RecordingBus; let clock: Date;
const make = (fetchImpl: typeof fetch, live = true) => new TokenResolver({ db: h.db, bus, rpcUrl: RPC, live, fetchImpl, now: () => clock });
beforeEach(async () => { h = await createDb({}); bus = new RecordingBus(); clock = new Date('2026-10-09T12:00:00Z'); });
afterAll(async () => { await h?.close(); });

describe('TokenResolver', () => {
  it('wallets and missing accounts are not tokens and never hit dexscreener', async () => {
    const { f, calls } = fakeFetch({ rpc: () => json({ result: { value: { owner: '11111111111111111111111111111111', data: ['', 'base64'] } } }) });
    expect((await make(f).resolve(MINT)).status).toBe('not_a_token');
    expect(calls.dex).toBe(0);
    const g = fakeFetch({ rpc: () => json({ result: { value: null } }) });
    expect((await make(g.f).resolve(PAIR)).status).toBe('not_a_token');
  });
  it('resolves using the highest-liquidity pair where the mint is the base token', async () => {
    const { f } = fakeFetch({ rpc: () => mintAccount(), dex: () => json([pair({ liq: 5_000, pairAddress: PAIR2 }), pair({ liq: 90_000 }), pair({ base: PAIR2, liq: 9e9 })]) });
    const v = await make(f).resolve(MINT);
    expect(v).toMatchObject({ status: 'resolved', source: 'live', symbol: 'BONK', liquidityUsd: 90_000, pairAddress: PAIR, decimals: 6, fetchedAt: clock.toISOString() });
    expect(bus.find('token:resolved')[0].target).toBe(`token:${MINT}`);
  });
  it('dedupes concurrent lookups', async () => {
    const { f, calls } = fakeFetch({ rpc: () => mintAccount(), dex: () => json([pair({ liq: 1 })]) });
    const r = make(f);
    await Promise.all([r.resolve(MINT), r.resolve(MINT), r.resolve(MINT)]);
    expect(calls.rpc).toBe(1);
  });

  describe('hostile upstream (Review Focus #2)', () => {
    it('empty pair list → unindexed, with Token-2022 metadata names', async () => {
      const { f } = fakeFetch({ rpc: () => mintAccount(TOKEN_2022_PROGRAM_ID, { extensions: [{ extension: 'tokenMetadata', state: { name: 'Fresh', symbol: 'FRSH' } }] }), dex: () => json([]) });
      expect(await make(f).resolve(MINT)).toMatchObject({ status: 'unindexed', name: 'Fresh', symbol: 'FRSH', liquidityUsd: null, pairAddress: null });
    });
    it('only quote-side pairs → unindexed (never borrow another token’s data)', async () => {
      const { f } = fakeFetch({ rpc: () => mintAccount(), dex: () => json([pair({ base: PAIR2, liq: 1e6 })]) });
      expect((await make(f).resolve(MINT)).status).toBe('unindexed');
    });
    it('missing liquidity → resolved with liquidityUsd null', async () => {
      const { f } = fakeFetch({ rpc: () => mintAccount(), dex: () => json([pair({ liq: undefined })]) });
      expect((await make(f).resolve(MINT)).liquidityUsd).toBeNull();
    });
    it('HTTP 429 → error, retried only after 60s', async () => {
      let status = 429;
      const { f, calls } = fakeFetch({ rpc: () => mintAccount(), dex: () => (status === 429 ? new Response('slow down', { status }) : json([pair({ liq: 10 })])) });
      const r = make(f);
      expect((await r.resolve(MINT)).status).toBe('error');
      status = 200;
      expect((await r.resolve(MINT)).status).toBe('error'); // still within retry window, cached
      expect(calls.dex).toBe(1);
      clock = new Date(clock.getTime() + 61_000);
      expect((await r.resolve(MINT)).status).toBe('resolved');
    });
    it('malformed JSON → error', async () => {
      const { f } = fakeFetch({ rpc: () => mintAccount(), dex: () => new Response('<html>cloudflare</html>', { status: 200 }) });
      expect((await make(f).resolve(MINT)).status).toBe('error');
    });
    it('RPC timeout → error, nothing invented', async () => {
      const { f } = fakeFetch({ rpc: () => { throw Object.assign(new Error('aborted'), { name: 'TimeoutError' }); } });
      const v = await make(f).resolve(MINT);
      expect(v).toMatchObject({ status: 'error', name: null, liquidityUsd: null });
    });
    it('a failed refresh keeps last good data instead of overwriting it', async () => {
      let fail = false;
      const { f } = fakeFetch({ rpc: () => mintAccount(), dex: () => (fail ? new Response('', { status: 500 }) : json([pair({ liq: 77 })])) });
      const r = make(f);
      await r.resolve(MINT);
      fail = true;
      clock = new Date(clock.getTime() + 6 * 60_000);
      const v = await r.resolve(MINT);
      expect(v).toMatchObject({ status: 'resolved', liquidityUsd: 77 });
    });
  });

  it('refreshes stale market data via dexscreener only', async () => {
    const { f, calls } = fakeFetch({ rpc: () => mintAccount(), dex: () => json([pair({ liq: 10 })]) });
    const r = make(f);
    await r.resolve(MINT);
    clock = new Date(clock.getTime() + 6 * 60_000);
    await r.resolve(MINT);
    expect(calls).toEqual({ rpc: 1, dex: 2 });
  });
  it('never fetches demo tokens', async () => {
    await h.db.insert(tokens).values({ mint: MINT, source: 'demo', status: 'resolved', name: 'Demo', symbol: 'DEMO' });
    const { f, calls } = fakeFetch({});
    expect((await make(f).resolve(MINT)).source).toBe('demo');
    expect(calls).toEqual({ rpc: 0, dex: 0 });
  });
  it('live lookup disabled → honest error, nothing persisted', async () => {
    const { f } = fakeFetch({});
    const v = await make(f, false).resolve(MINT);
    expect(v).toMatchObject({ status: 'error', error: 'Live lookup disabled' });
    expect(await h.db.select().from(tokens).where(eq(tokens.mint, MINT))).toHaveLength(0);
  });
  it('getViews returns pending for unknown mints and enqueues them', async () => {
    const { f, calls } = fakeFetch({ rpc: () => mintAccount(), dex: () => json([pair({ liq: 1 })]) });
    const r = make(f);
    const views = await r.getViews([MINT]);
    expect(views[MINT]!.status).toBe('pending');
    await r.idle();
    expect(calls.rpc).toBe(1);
  });
});
```

- [ ] **Step 2: Implement upstream clients**

`apps/server/src/tokens/rpc.ts`:
```ts
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@shillex/shared';

export class UpstreamError extends Error {}
export type MintAccount =
  | { kind: 'mint'; program: 'spl-token' | 'spl-token-2022'; decimals: number | null; name: string | null; symbol: string | null }
  | { kind: 'not_mint' };

export async function fetchMintAccount(rpcUrl: string, mint: string, fetchImpl: typeof fetch = fetch, timeoutMs = 8000): Promise<MintAccount> {
  let res: Response;
  try {
    res = await fetchImpl(rpcUrl, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [mint, { encoding: 'jsonParsed' }] }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new UpstreamError(`rpc unreachable: ${(e as Error).name}`);
  }
  if (!res.ok) throw new UpstreamError(`rpc http ${res.status}`);
  let body: any;
  try { body = await res.json(); } catch { throw new UpstreamError('rpc bad json'); }
  if (body?.error) throw new UpstreamError(`rpc error ${body.error.code ?? ''}`);
  const v = body?.result?.value;
  if (!v) return { kind: 'not_mint' };
  const parsed = v.data?.parsed;
  if ((v.owner !== TOKEN_PROGRAM_ID && v.owner !== TOKEN_2022_PROGRAM_ID) || parsed?.type !== 'mint') return { kind: 'not_mint' };
  const meta = (parsed.info?.extensions ?? []).find((e: any) => e?.extension === 'tokenMetadata')?.state;
  const str = (s: unknown) => (typeof s === 'string' && s.trim() ? s.trim().slice(0, 64) : null);
  return {
    kind: 'mint', program: v.owner === TOKEN_PROGRAM_ID ? 'spl-token' : 'spl-token-2022',
    decimals: Number.isInteger(parsed.info?.decimals) ? parsed.info.decimals : null,
    name: str(meta?.name), symbol: str(meta?.symbol),
  };
}
```

`apps/server/src/tokens/dexscreener.ts`:
```ts
import { isValidSolanaAddress } from '@shillex/shared';
import { UpstreamError } from './rpc.ts';

export interface DexBest {
  name: string | null; symbol: string | null; imageUrl: string | null;
  liquidityUsd: number | null; marketCapUsd: number | null; fdvUsd: number | null;
  pairAddress: string; dexId: string | null; pairCreatedAt: Date | null;
}
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown, max = 64) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

export async function fetchDexBest(mint: string, fetchImpl: typeof fetch = fetch, timeoutMs = 8000): Promise<DexBest | null> {
  let res: Response;
  try {
    res = await fetchImpl(`https://api.dexscreener.com/tokens/v1/solana/${encodeURIComponent(mint)}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new UpstreamError(`dexscreener unreachable: ${(e as Error).name}`);
  }
  if (!res.ok) throw new UpstreamError(`dexscreener http ${res.status}`);
  let data: unknown;
  try { data = await res.json(); } catch { throw new UpstreamError('dexscreener bad json'); }
  if (!Array.isArray(data)) throw new UpstreamError('dexscreener unexpected shape');
  const pairs = data.filter((p: any) => p?.chainId === 'solana' && p?.baseToken?.address === mint && typeof p?.pairAddress === 'string' && isValidSolanaAddress(p.pairAddress));
  if (!pairs.length) return null;
  pairs.sort((a: any, b: any) => (num(b.liquidity?.usd) ?? -1) - (num(a.liquidity?.usd) ?? -1));
  const p: any = pairs[0];
  const img = str(p.info?.imageUrl, 500);
  return {
    name: str(p.baseToken?.name), symbol: str(p.baseToken?.symbol, 24),
    imageUrl: img && img.startsWith('https://') ? img : null,
    liquidityUsd: num(p.liquidity?.usd), marketCapUsd: num(p.marketCap), fdvUsd: num(p.fdv),
    pairAddress: p.pairAddress, dexId: str(p.dexId), pairCreatedAt: num(p.pairCreatedAt) ? new Date(p.pairCreatedAt) : null,
  };
}
```

- [ ] **Step 3: Implement the resolver**

`apps/server/src/tokens/resolver.ts`:
```ts
import { eq } from 'drizzle-orm';
import { COPY, isValidSolanaAddress, type TokenView } from '@shillex/shared';
import type { Db } from '../db/client.ts';
import type { EventBus, TokenResolverPort } from '../deps.ts';
import { tokens, type TokenRow } from '../db/schema.ts';
import { fetchMintAccount } from './rpc.ts';
import { fetchDexBest } from './dexscreener.ts';
import { isStale, pendingTokenView, readTokenViews, tokenRowToView, ERROR_RETRY_MS } from './view.ts';

export interface ResolverOptions { db: Db; bus: EventBus; rpcUrl: string; live: boolean; fetchImpl?: typeof fetch; now?: () => Date; concurrency?: number }

export class TokenResolver implements TokenResolverPort {
  private inflight = new Map<string, Promise<TokenView>>();
  private failedRefresh = new Map<string, number>(); // mint -> time of last failed refresh of a good row
  private waiting: Array<() => void> = [];
  private active = 0;
  private fetchImpl: typeof fetch;
  private now: () => Date;
  constructor(private o: ResolverOptions) {
    this.fetchImpl = o.fetchImpl ?? fetch;
    this.now = o.now ?? (() => new Date());
  }

  async getViews(mints: string[]): Promise<Record<string, TokenView>> {
    const { views, missing, stale } = await readTokenViews(this.o.db, mints, this.now());
    this.enqueue([...missing, ...stale]);
    return views;
  }

  enqueue(mints: string[]): void {
    for (const m of new Set(mints)) {
      if (!isValidSolanaAddress(m) || this.inflight.has(m)) continue;
      void this.resolve(m).catch(() => undefined);
    }
  }

  resolve(mint: string): Promise<TokenView> {
    const existing = this.inflight.get(mint);
    if (existing) return existing;
    const p = this.schedule(() => this.doResolve(mint)).finally(() => this.inflight.delete(mint));
    this.inflight.set(mint, p);
    return p;
  }

  /** Resolves when no lookups are running or queued (tests and graceful shutdown). */
  async idle(): Promise<void> {
    while (this.inflight.size) await Promise.allSettled([...this.inflight.values()]);
  }

  private async schedule<T>(fn: () => Promise<T>): Promise<T> {
    const limit = this.o.concurrency ?? 4;
    if (this.active >= limit) await new Promise<void>((r) => this.waiting.push(r));
    this.active++;
    try { return await fn(); } finally { this.active--; this.waiting.shift()?.(); }
  }

  private async doResolve(mint: string): Promise<TokenView> {
    const { db } = this.o;
    const now = this.now();
    const [row] = await db.select().from(tokens).where(eq(tokens.mint, mint)).limit(1);
    if (row && !isStale(row, now)) return tokenRowToView(row);
    if (row && (row.status === 'resolved' || row.status === 'unindexed')) {
      const failedAt = this.failedRefresh.get(mint);
      if (failedAt && now.getTime() - failedAt < ERROR_RETRY_MS) return tokenRowToView(row);
    }
    if (!this.o.live) return row ? tokenRowToView(row) : { ...pendingTokenView(mint), status: 'error', error: COPY.liveLookupDisabled };

    try {
      if (row && (row.status === 'resolved' || row.status === 'unindexed')) {
        const dex = await fetchDexBest(mint, this.fetchImpl);
        const next: Partial<TokenRow> = dex ? this.fromDex(dex, row) : { fetchedAt: now };
        return this.save(mint, { ...row, ...next, status: dex ? 'resolved' : row.status, fetchedAt: now, error: null }, row);
      }
      const acct = await fetchMintAccount(this.o.rpcUrl, mint, this.fetchImpl);
      if (acct.kind === 'not_mint') return this.save(mint, { mint, source: 'live', status: 'not_a_token', fetchedAt: now, metaFetchedAt: now, error: null }, row);
      const dex = await fetchDexBest(mint, this.fetchImpl);
      const base: Partial<TokenRow> = { mint, source: 'live', decimals: acct.decimals, name: acct.name, symbol: acct.symbol, fetchedAt: now, metaFetchedAt: now, error: null };
      return this.save(mint, dex ? { ...base, ...this.fromDex(dex, base), status: 'resolved' } : { ...base, status: 'unindexed' }, row);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'lookup failed';
      if (row && (row.status === 'resolved' || row.status === 'unindexed')) {
        this.failedRefresh.set(mint, now.getTime());
        return tokenRowToView(row);
      }
      return this.save(mint, { mint, source: 'live', status: 'error', error: message.slice(0, 200), fetchedAt: now }, row);
    }
  }

  private fromDex(dex: NonNullable<Awaited<ReturnType<typeof fetchDexBest>>>, prev: Partial<TokenRow>): Partial<TokenRow> {
    return {
      name: prev.name ?? dex.name, symbol: prev.symbol ?? dex.symbol, imageUrl: dex.imageUrl ?? prev.imageUrl ?? null,
      liquidityUsd: dex.liquidityUsd, marketCapUsd: dex.marketCapUsd, fdvUsd: dex.fdvUsd,
      pairAddress: dex.pairAddress, dexId: dex.dexId, pairCreatedAt: dex.pairCreatedAt,
    };
  }

  private async save(mint: string, values: Partial<TokenRow>, prev: TokenRow | undefined): Promise<TokenView> {
    const { db } = this.o;
    const full = { mint, status: values.status!, ...values } as typeof tokens.$inferInsert;
    const [saved] = await db.insert(tokens).values(full).onConflictDoUpdate({ target: tokens.mint, set: { ...full, mint: undefined } }).returning();
    const view = tokenRowToView(saved!);
    this.failedRefresh.delete(mint);
    if (!prev || prev.status !== saved!.status || prev.fetchedAt?.getTime() !== saved!.fetchedAt?.getTime()) {
      this.o.bus.toRoom(`token:${mint}`, 'token:resolved', { token: view });
    }
    return view;
  }
}
```
Note: the `onConflictDoUpdate` `set` must not include `mint`; strip it with destructuring if `mint: undefined` is rejected by Drizzle (`const { mint: _m, ...set } = full`).

Run: `npm test -w @shillex/server -- resolver` → PASS.

- [ ] **Step 4: Token subscriptions + wire into posts/messages**

`apps/server/src/services/token-subs.ts`:
```ts
import { and, desc, eq, gt } from 'drizzle-orm';
import type { AppDeps } from '../deps.ts';
import { subscriptions, notifications, tokens } from '../db/schema.ts';
import { notify } from './notify.ts';

const THROTTLE_MS = 60 * 60 * 1000;

export async function notifyTokenSubscribers(deps: Pick<AppDeps, 'db' | 'bus' | 'now'>, mints: string[], actorId: string) {
  const { db, now } = deps;
  for (const mint of mints) {
    const subs = await db.select({ u: subscriptions.userId }).from(subscriptions).where(and(eq(subscriptions.targetType, 'token'), eq(subscriptions.targetId, mint)));
    if (!subs.length) continue;
    const [t] = await db.select({ symbol: tokens.symbol }).from(tokens).where(eq(tokens.mint, mint));
    for (const s of subs) {
      if (s.u === actorId) continue;
      const recent = await db.select({ id: notifications.id }).from(notifications).where(and(
        eq(notifications.userId, s.u), eq(notifications.type, 'token_discussion'), eq(notifications.targetId, mint),
        gt(notifications.createdAt, new Date(now().getTime() - THROTTLE_MS)),
      )).orderBy(desc(notifications.id)).limit(1);
      if (recent.length) continue;
      await notify(deps, { userId: s.u, type: 'token_discussion', actorId, targetType: 'token', targetId: mint, data: { mint, ...(t?.symbol ? { symbol: t.symbol } : {}) } });
    }
  }
}
```

In `services/posts.ts` `createPost`, after `recordMentions`:
```ts
const isPublicMention = computeMentionVisibility({ kind: 'post', communityVisibility });
// (use this variable for recordMentions' isPublic too)
if (mints.length && isPublicMention) await notifyTokenSubscribers(deps, mints, author.id);
```
In `services/messages.ts` `afterVisible`, after `recordMentions`:
```ts
if (mints.length && isPublic) await notifyTokenSubscribers(deps, mints, msg.authorId);
```
Add `import { notifyTokenSubscribers } from './token-subs.ts';` to both.

- [ ] **Step 5: Failing token route tests**

`apps/server/test/tokens.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, type TestCtx, type TestUser } from './helpers.ts';
import { tokens } from '../src/db/schema.ts';

const MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
let ctx: TestCtx; let a: TestUser; let b: TestUser;
beforeAll(async () => {
  ctx = await makeTestApp();
  a = await ctx.createUser('tok_a'); b = await ctx.createUser('tok_b');
  await ctx.db.insert(tokens).values({ mint: MINT, source: 'demo', status: 'resolved', name: 'Demo Bonk', symbol: 'DBONK', liquidityUsd: 1000, pairAddress: null });
  ctx.tokens.views.set(MINT, { mint: MINT, status: 'resolved', source: 'demo', name: 'Demo Bonk', symbol: 'DBONK', imageUrl: null, decimals: null, liquidityUsd: 1000, marketCapUsd: null, fdvUsd: null, pairAddress: null, dexId: null, pairCreatedAt: null, promoted: false, fetchedAt: null, error: null });
  await ctx.as(a).post('/api/communities', { name: 'Tok Pub', slug: 'tokpub', visibility: 'public' });
  const ch = (await ctx.as(a).get('/api/communities/tokpub')).body.community.channels[0].id;
  await ctx.as(a).post('/api/posts', { body: `post about ${MINT}` });
  await ctx.as(a).post(`/api/channels/${ch}/messages`, { body: `chat about ${MINT}` });
});
afterAll(() => ctx.close());

describe('token routes', () => {
  it('returns token, links (disabled for demo) and stats', async () => {
    const r = await ctx.as(b).get(`/api/tokens/${MINT}`);
    expect(r.body.token.symbol).toBe('DBONK');
    expect(r.body.links.every((l: any) => l.url === null && l.unavailableReason === 'Fictional demo token — not on-chain')).toBe(true);
    expect(r.body.stats).toMatchObject({ mentions24h: 2, posts24h: 1, chat24h: 1, subscribed: false });
  });
  it('rejects invalid addresses', async () => {
    expect((await ctx.as(b).get('/api/tokens/not-a-mint')).body.code).toBe('INVALID_ADDRESS');
    expect((await ctx.as(b).post('/api/tokens/resolve', { mints: Array(26).fill(MINT) })).status).toBe(400);
  });
  it('lists public posts and public chat mentioning the exact mint', async () => {
    const posts = (await ctx.as(b).get(`/api/tokens/${MINT}/posts`)).body.items;
    expect(posts.map((p: any) => p.body)).toEqual([`post about ${MINT}`]);
    const chat = (await ctx.as(b).get(`/api/tokens/${MINT}/chat`)).body.items;
    expect(chat[0]).toMatchObject({ message: { body: `chat about ${MINT}` }, community: { slug: 'tokpub' }, channel: { name: 'general' } });
  });
  it('subscription toggles and drives throttled notifications', async () => {
    expect((await ctx.as(b).put(`/api/tokens/${MINT}/subscription`)).body).toEqual({ subscribed: true });
    ctx.bus.clear();
    await ctx.as(a).post('/api/posts', { body: `again ${MINT}` });
    await ctx.as(a).post('/api/posts', { body: `and again ${MINT}` });
    const n = (await ctx.as(b).get('/api/notifications?filter=calls')).body.items.filter((x: any) => x.type === 'token_discussion');
    expect(n).toHaveLength(1);
    expect(n[0].text).toBe('New public discussion of $DBONK');
    expect((await ctx.as(b).del(`/api/tokens/${MINT}/subscription`)).body).toEqual({ subscribed: false });
  });
});
```

- [ ] **Step 6: Implement `routes/tokens.ts`**

`apps/server/src/routes/tokens.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, gt, lt, sql } from 'drizzle-orm';
import { buildTokenLinks, isValidSolanaAddress, type Page, type PostView, type PublicChatMention, type TokenDiscussionStats } from '@shillex/shared';
import { tokenMentions, posts, messages, channels, communities, subscriptions } from '../db/schema.ts';
import { requireUser } from '../lib/auth.ts';
import { parse } from '../lib/validate.ts';
import { errors } from '../lib/errors.ts';
import { clampLimit } from '../lib/pagination.ts';
import { hydrateMessages, hydratePosts, collectMints } from '../services/hydrate.ts';
import { canReadPost, hiddenAuthorIds } from '../services/visibility.ts';

const DAY = 24 * 60 * 60 * 1000;

export default async function tokensRoutes(app: FastifyInstance) {
  const deps = app.deps;
  const { db, now } = deps;
  const mintParam = (m: string) => { if (!isValidSolanaAddress(m)) throw errors.badRequest('INVALID_ADDRESS', 'Not a valid Solana address'); return m; };

  async function stats(mint: string, userId: string): Promise<TokenDiscussionStats> {
    const since = new Date(now().getTime() - DAY);
    const rows = await db.select({ t: tokenMentions.sourceType, n: sql<number>`count(*)::int` }).from(tokenMentions)
      .where(and(eq(tokenMentions.mint, mint), eq(tokenMentions.isPublic, true), gt(tokenMentions.createdAt, since))).groupBy(tokenMentions.sourceType);
    const posts24h = rows.find((r) => r.t === 'post')?.n ?? 0;
    const chat24h = rows.find((r) => r.t === 'message')?.n ?? 0;
    const sub = await db.select().from(subscriptions).where(and(eq(subscriptions.userId, userId), eq(subscriptions.targetType, 'token'), eq(subscriptions.targetId, mint))).limit(1);
    return { mentions24h: posts24h + chat24h, posts24h, chat24h, subscribed: sub.length > 0 };
  }

  app.get<{ Params: { mint: string } }>('/tokens/:mint', async (req) => {
    const me = requireUser(req);
    const mint = mintParam(req.params.mint);
    const token = await deps.tokens.resolve(mint);
    const links = token.status === 'resolved' || token.status === 'unindexed' ? buildTokenLinks({ mint, pairAddress: token.pairAddress, source: token.source }) : [];
    return { token, links, stats: await stats(mint, me.id) };
  });

  app.post('/tokens/resolve', async (req) => {
    requireUser(req);
    const { mints } = parse(z.object({ mints: z.array(z.string().refine(isValidSolanaAddress)).max(25) }), req.body);
    return { tokens: await deps.tokens.getViews(mints) };
  });

  app.get<{ Params: { mint: string }; Querystring: { cursor?: string; limit?: string } }>('/tokens/:mint/posts', async (req) => {
    const me = requireUser(req);
    const mint = mintParam(req.params.mint);
    const limit = clampLimit(req.query.limit, 20, 50);
    const hidden = await hiddenAuthorIds(db, me.id);
    const rows = await db.select({ p: posts }).from(tokenMentions).innerJoin(posts, eq(posts.id, tokenMentions.sourceId))
      .where(and(eq(tokenMentions.mint, mint), eq(tokenMentions.isPublic, true), eq(tokenMentions.sourceType, 'post'), sql`${posts.deletedAt} is null`,
        req.query.cursor ? lt(posts.id, req.query.cursor) : undefined))
      .orderBy(desc(posts.id)).limit(limit + 1);
    const visible = [];
    for (const r of rows.slice(0, limit)) if (!hidden.includes(r.p.authorId) && (await canReadPost(db, r.p, me.id))) visible.push(r.p);
    const items = await hydratePosts(db, me.id, visible);
    const page: Page<PostView> = { items, nextCursor: rows.length > limit ? rows[limit - 1]!.p.id : null, tokens: await deps.tokens.getViews(collectMints(items)) };
    return page;
  });

  app.get<{ Params: { mint: string }; Querystring: { cursor?: string; limit?: string } }>('/tokens/:mint/chat', async (req) => {
    const me = requireUser(req);
    const mint = mintParam(req.params.mint);
    const limit = clampLimit(req.query.limit, 20, 50);
    const hidden = await hiddenAuthorIds(db, me.id);
    const rows = await db.select({ m: messages, ch: channels, c: communities }).from(tokenMentions)
      .innerJoin(messages, eq(messages.id, tokenMentions.sourceId))
      .innerJoin(channels, eq(channels.id, messages.channelId))
      .innerJoin(communities, eq(communities.id, channels.communityId))
      .where(and(eq(tokenMentions.mint, mint), eq(tokenMentions.isPublic, true), eq(tokenMentions.sourceType, 'message'),
        eq(messages.status, 'visible'), eq(communities.visibility, 'public'), req.query.cursor ? lt(messages.id, req.query.cursor) : undefined))
      .orderBy(desc(messages.id)).limit(limit + 1);
    const kept = rows.slice(0, limit).filter((r) => !hidden.includes(r.m.authorId));
    const views = await hydrateMessages(db, me.id, kept.map((r) => r.m));
    const items: PublicChatMention[] = kept.map((r, i) => ({
      message: views[i]!, community: { id: r.c.id, slug: r.c.slug, name: r.c.name, visibility: r.c.visibility }, channel: { id: r.ch.id, name: r.ch.name },
    }));
    const page: Page<PublicChatMention> = { items, nextCursor: rows.length > limit ? rows[limit - 1]!.m.id : null, tokens: await deps.tokens.getViews(views.flatMap((v) => v.mints)) };
    return page;
  });

  app.put<{ Params: { mint: string } }>('/tokens/:mint/subscription', async (req) => {
    const me = requireUser(req);
    const mint = mintParam(req.params.mint);
    await db.insert(subscriptions).values({ userId: me.id, targetType: 'token', targetId: mint, createdAt: now() }).onConflictDoNothing();
    return { subscribed: true };
  });
  app.delete<{ Params: { mint: string } }>('/tokens/:mint/subscription', async (req) => {
    const me = requireUser(req);
    const mint = mintParam(req.params.mint);
    await db.delete(subscriptions).where(and(eq(subscriptions.userId, me.id), eq(subscriptions.targetType, 'token'), eq(subscriptions.targetId, mint)));
    return { subscribed: false };
  });
}
```

- [ ] **Step 7: Wire resolver into boot, register routes, run, commit**

In `src/index.ts` replace the temporary `tokens` object:
```ts
import { TokenResolver } from './tokens/resolver.ts';
// bus is still RecordingBus until Task 12
const bus = new RecordingBus();
const tokens = new TokenResolver({ db: handle.db, bus, rpcUrl: config.solanaRpcUrl, live: config.liveTokenLookup });
const app = await buildApp({ db: handle.db, dbKind: handle.kind, config, bus, tokens, presence: new InMemoryPresence(), now: () => new Date() });
```
Register `tokensRoutes` with `/api`.
Run: `npm test -w @shillex/server && npm run typecheck -w @shillex/server` → PASS.
```bash
git add apps/server
git commit -m "feat(server): verified token resolution via RPC + Dexscreener, token discussion routes"
```

---

### Task 12: Realtime (Socket.IO)

**Files:**
- Create: `apps/server/src/realtime/socket.ts`
- Modify: `apps/server/src/index.ts` (SocketBus + attachRealtime)
- Test: `apps/server/test/realtime.test.ts`

**Interfaces:**
- Consumes: `userForToken`, `SESSION_COOKIE`, visibility `requireChannel` / `requireConversationMember` / `requireCommunityRead` / `getCommunityAccess`, `PresenceRegistry`, `toUserSummary`, shared event maps.
- Produces:
  - `class SocketBus implements EventBus` with `attach(io)`
  - `attachRealtime(app: FastifyInstance, bus: SocketBus): Server<ClientToServerEvents, ServerToClientEvents>`
  - Room names: `user:<id>`, `channel:<id>`, `conversation:<id>`, `community:<id>`, `token:<mint>`
  - Socket auth via the `sx_session` cookie; unauthenticated connections are refused with error message `UNAUTHORIZED`

- [ ] **Step 1: Failing realtime tests (includes Review Focus #4)**

`apps/server/test/realtime.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io as ioc, type Socket } from 'socket.io-client';
import { makeTestApp, type TestCtx, type TestUser } from './helpers.ts';
import { SocketBus, attachRealtime } from '../src/realtime/socket.ts';

let ctx: TestCtx; let url: string; let mod: TestUser; let member: TestUser; let outsider: TestUser; let channelId: string;
const sockets: Socket[] = [];
function connect(u: TestUser | null): Promise<Socket> {
  const s = ioc(url, { transports: ['websocket'], extraHeaders: u ? { cookie: u.cookie } : {}, reconnection: false, forceNew: true });
  sockets.push(s);
  return new Promise((res, rej) => { s.on('connect', () => res(s)); s.on('connect_error', rej); });
}
const sub = (s: Socket, scope: string, id: string) => new Promise<any>((res) => s.emit('subscribe', { scope, id }, res));
const next = (s: Socket, ev: string, ms = 2000) => new Promise<any>((res, rej) => { const t = setTimeout(() => rej(new Error(`timeout ${ev}`)), ms); s.once(ev, (p: any) => { clearTimeout(t); res(p); }); });
const none = (s: Socket, ev: string, ms = 400) => new Promise<void>((res, rej) => { const h = () => rej(new Error(`unexpected ${ev}`)); s.once(ev, h); setTimeout(() => { s.off(ev, h); res(); }, ms); });

beforeAll(async () => {
  const bus = new SocketBus();
  ctx = await makeTestApp({ bus });
  attachRealtime(ctx.app, bus);
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = ctx.app.server.address() as { port: number };
  url = `http://127.0.0.1:${addr.port}`;
  mod = await ctx.createUser('rt_mod'); member = await ctx.createUser('rt_member'); outsider = await ctx.createUser('rt_out');
  await ctx.as(mod).post('/api/communities', { name: 'RT', slug: 'rt', visibility: 'public' });
  await ctx.as(mod).post('/api/communities', { name: 'RT Priv', slug: 'rtpriv', visibility: 'private' });
  await ctx.as(member).post('/api/communities/rt/join');
  channelId = (await ctx.as(mod).get('/api/communities/rt')).body.community.channels[0].id;
});
afterAll(async () => { sockets.forEach((s) => s.close()); await ctx.close(); });

describe('realtime', () => {
  it('refuses unauthenticated sockets', async () => {
    await expect(connect(null)).rejects.toThrow(/UNAUTHORIZED/);
  });
  it('authorizes subscriptions', async () => {
    const s = await connect(outsider);
    expect(await sub(s, 'channel', channelId)).toEqual({ ok: true }); // public channel is readable
    const privCh = (await ctx.as(mod).get('/api/communities/rtpriv')).body.community.channels[0].id;
    expect(await sub(s, 'channel', privCh)).toEqual({ ok: false, code: 'MEMBERS_ONLY' });
    expect(await sub(s, 'conversation', 'nope')).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(await sub(s, 'token', 'bad')).toEqual({ ok: false, code: 'INVALID_ADDRESS' });
  });
  it('delivers channel messages and typing to subscribers', async () => {
    const a = await connect(member); const b = await connect(mod);
    await sub(a, 'channel', channelId); await sub(b, 'channel', channelId);
    const got = next(a, 'message:new');
    await ctx.as(mod).post(`/api/channels/${channelId}/messages`, { body: 'live!' });
    expect((await got).message.body).toBe('live!');
    const typing = next(a, 'typing');
    b.emit('typing', { scope: 'channel', id: channelId });
    expect((await typing).user.username).toBe('rt_mod');
  });
  it('delivers DMs to user rooms without subscription', async () => {
    const s = await connect(member);
    const conv = (await ctx.as(mod).post('/api/conversations', { kind: 'dm', username: 'rt_member' })).body.conversation;
    const got = next(s, 'message:new');
    ctx.clock.advance(61_000);
    await ctx.as(mod).post(`/api/conversations/${conv.id}/messages`, { body: 'psst' });
    expect((await got).message.body).toBe('psst');
  });
  it('eviction: a banned member stops receiving channel events immediately (Review Focus #4)', async () => {
    const victim = await ctx.createUser('rt_victim');
    await ctx.as(victim).post('/api/communities/rt/join');
    const s = await connect(victim);
    expect(await sub(s, 'channel', channelId)).toEqual({ ok: true });
    await ctx.as(mod).post(`/api/communities/rt/members/${victim.id}/ban`);
    ctx.clock.advance(61_000);
    const silent = none(s, 'message:new');
    await ctx.as(mod).post(`/api/channels/${channelId}/messages`, { body: 'after ban' });
    await silent;
  });
  it('presence updates reach community rooms', async () => {
    const watcher = await connect(mod);
    await sub(watcher, 'community', (await ctx.as(mod).get('/api/communities/rt')).body.community.community.id);
    const p = next(watcher, 'presence');
    const late = await ctx.createUser('rt_late');
    await ctx.as(late).post('/api/communities/rt/join');
    await connect(late);
    expect(await p).toEqual({ userId: late.id, online: true });
  });
});
```

- [ ] **Step 2: Implement**

`apps/server/src/realtime/socket.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import { and, eq, ne, inArray } from 'drizzle-orm';
import { isValidSolanaAddress, type ClientToServerEvents, type RoomScope, type ServerToClientEvents } from '@shillex/shared';
import type { EventBus } from '../deps.ts';
import { communityMembers, conversationMembers, type UserRow } from '../db/schema.ts';
import { SESSION_COOKIE, userForToken } from '../lib/auth.ts';
import { AppError, errors } from '../lib/errors.ts';
import { getCommunityAccess, requireChannel, requireCommunityRead, requireConversationMember } from '../services/visibility.ts';
import { toUserSummary } from '../services/users.ts';

type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, { user: UserRow }>;

export class SocketBus implements EventBus {
  private io: IO | null = null;
  attach(io: IO) { this.io = io; }
  toRoom(room: string, event: string, payload: unknown) { this.io?.to(room).emit(event as any, payload as any); }
  toUser(userId: string, event: string, payload: unknown) { this.io?.to(`user:${userId}`).emit(event as any, payload as any); }
  evict(userId: string, room: string) { this.io?.in(`user:${userId}`).socketsLeave(room); }
}

export function attachRealtime(app: FastifyInstance, bus: SocketBus): IO {
  const { db, presence, now, config } = app.deps;
  const io: IO = new Server(app.server, { path: '/socket.io', cors: { origin: config.allowedOrigins, credentials: true } });

  io.use(async (socket, next) => {
    try {
      const cookies = app.parseCookie(socket.handshake.headers.cookie ?? '');
      const user = await userForToken(db, cookies[SESSION_COOKIE], now());
      if (!user) return next(new Error('UNAUTHORIZED'));
      socket.data.user = user;
      next();
    } catch { next(new Error('UNAUTHORIZED')); }
  });

  async function authorize(scope: RoomScope, id: string, userId: string) {
    switch (scope) {
      case 'channel': await requireChannel(db, id, userId, 'read'); return;
      case 'conversation': await requireConversationMember(db, id, userId); return;
      case 'community': requireCommunityRead(await getCommunityAccess(db, id, userId)); return;
      case 'token': if (!isValidSolanaAddress(id)) throw errors.badRequest('INVALID_ADDRESS', 'Invalid address'); return;
      default: throw errors.badRequest('BAD_SCOPE', 'Unknown scope');
    }
  }

  async function broadcastPresence(userId: string, online: boolean) {
    const comms = await db.select({ id: communityMembers.communityId }).from(communityMembers)
      .where(and(eq(communityMembers.userId, userId), eq(communityMembers.status, 'active')));
    for (const c of comms) io.to(`community:${c.id}`).emit('presence', { userId, online });
    const convs = (await db.select({ id: conversationMembers.conversationId }).from(conversationMembers).where(eq(conversationMembers.userId, userId))).map((r) => r.id);
    if (convs.length) {
      const peers = await db.selectDistinct({ u: conversationMembers.userId }).from(conversationMembers)
        .where(and(inArray(conversationMembers.conversationId, convs), ne(conversationMembers.userId, userId)));
      for (const p of peers) io.to(`user:${p.u}`).emit('presence', { userId, online });
    }
  }

  io.on('connection', async (socket) => {
    const user = socket.data.user;
    await socket.join(`user:${user.id}`);
    if (presence.connect(user.id, socket.id)) await broadcastPresence(user.id, true);

    socket.on('subscribe', async (p, ack) => {
      try {
        await authorize(p.scope, p.id, user.id);
        await socket.join(`${p.scope}:${p.id}`);
        ack?.({ ok: true });
      } catch (e) {
        ack?.({ ok: false, code: e instanceof AppError ? e.code : 'ERROR' });
      }
    });
    socket.on('unsubscribe', (p) => { void socket.leave(`${p.scope}:${p.id}`); });

    const lastTyping = new Map<string, number>();
    socket.on('typing', (p) => {
      if (p?.scope !== 'channel' && p?.scope !== 'conversation') return;
      const room = `${p.scope}:${p.id}`;
      if (!socket.rooms.has(room)) return;
      const t = Date.now();
      if ((lastTyping.get(room) ?? 0) > t - 1500) return;
      lastTyping.set(room, t);
      socket.to(room).emit('typing', { scope: { type: p.scope, id: p.id }, user: toUserSummary(user) });
    });

    socket.on('disconnect', async () => {
      if (presence.disconnect(user.id, socket.id)) await broadcastPresence(user.id, false);
    });
  });

  bus.attach(io);
  return io;
}
```
If `presence` arrives at the watcher before `subscribe` resolves in the test, the test awaits `sub(...)` first, so ordering is deterministic.

`apps/server/src/index.ts` — replace the bus:
```ts
import { SocketBus, attachRealtime } from './realtime/socket.ts';
const bus = new SocketBus();
const tokens = new TokenResolver({ db: handle.db, bus, rpcUrl: config.solanaRpcUrl, live: config.liveTokenLookup });
const presence = new InMemoryPresence();
const app = await buildApp({ db: handle.db, dbKind: handle.kind, config, bus, tokens, presence, now: () => new Date() });
attachRealtime(app, bus);
await app.listen({ port: config.port, host: '0.0.0.0' });
```

- [ ] **Step 3: Run, commit**

Run: `npm test -w @shillex/server && npm run typecheck -w @shillex/server` → PASS.
```bash
git add apps/server
git commit -m "feat(server): socket.io realtime with authorized rooms, typing, presence and eviction"
```

---

### Task 13: Discovery and sidebar

**Files:**
- Create: `apps/server/src/routes/discover.ts`
- Modify: `apps/server/src/app.ts`
- Test: `apps/server/test/discover.test.ts`

**Interfaces:**
- Consumes: `communitySummaries`, `hiddenAuthorIds`, `readTokenViews`, `toUserSummary`, presence.
- Produces:
  - `GET /api/discover` → `DiscoverView` (liveRooms ≤8, communities ≤8, people ≤8, newCoins ≤20, promoted ≤3)
  - `GET /api/sidebar` → `SidebarView` (liveRooms ≤5, people ≤3, newCoins ≤5, promoted ≤1, `demoSimulator: config.demoSimulator`)
  - Rules: live rooms are channels of **public** communities ordered by messages in the last 15 min, then most recent activity in the last 24 h; new coins are mints ordered by **first public mention time** (newest first), never by mention count, excluding `not_a_token`, `error` and `pending`; promoted tokens appear only in the `promoted` list; people exclude self, followed, muted and blocked-either-way.

- [ ] **Step 1: Failing tests**

`apps/server/test/discover.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, type TestCtx, type TestUser } from './helpers.ts';
import { tokens } from '../src/db/schema.ts';

const MINT_A = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const MINT_B = 'So11111111111111111111111111111111111111112';
const MINT_P = '5zpyutJu9ee6jFymDGoK7F6S5Kczqtc9FomP3ueKuyA9';
const MINT_SECRET = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

let ctx: TestCtx; let me: TestUser; let loud: TestUser; let quiet: TestUser; let blocker: TestUser;
beforeAll(async () => {
  ctx = await makeTestApp();
  me = await ctx.createUser('disc_me'); loud = await ctx.createUser('disc_loud'); quiet = await ctx.createUser('disc_quiet'); blocker = await ctx.createUser('disc_blocker');
  await ctx.db.insert(tokens).values([
    { mint: MINT_A, source: 'demo', status: 'resolved', symbol: 'AAA' },
    { mint: MINT_B, source: 'demo', status: 'resolved', symbol: 'BBB' },
    { mint: MINT_P, source: 'demo', status: 'resolved', symbol: 'PRO', promoted: true },
    { mint: MINT_SECRET, source: 'demo', status: 'resolved', symbol: 'SEC' },
  ]);
  await ctx.as(blocker).put('/api/users/disc_me/block');
  await ctx.as(loud).post('/api/communities', { name: 'Loud', slug: 'loud', visibility: 'public' });
  await ctx.as(loud).post('/api/communities', { name: 'Hidden', slug: 'hidden', visibility: 'private' });
  const ch = (await ctx.as(loud).get('/api/communities/loud')).body.community.channels[0].id;
  const hidden = (await ctx.as(loud).get('/api/communities/hidden')).body.community.channels[0].id;
  // MINT_A: many mentions, first mentioned earlier. MINT_B: one mention, newer.
  for (let i = 0; i < 5; i++) { ctx.clock.advance(61_000); await ctx.as(loud).post(`/api/channels/${ch}/messages`, { body: `${MINT_A} call ${i}` }); }
  ctx.clock.advance(61_000); await ctx.as(quiet).post('/api/posts', { body: `new one ${MINT_B}` });
  ctx.clock.advance(61_000); await ctx.as(quiet).post('/api/posts', { body: `promo ${MINT_P}` });
  ctx.clock.advance(61_000); await ctx.as(loud).post(`/api/channels/${hidden}/messages`, { body: `secret ${MINT_SECRET}` });
  for (let i = 0; i < 3; i++) { ctx.clock.advance(61_000); await ctx.as(loud).post(`/api/channels/${hidden}/messages`, { body: `busy private ${i}` }); }
});
afterAll(() => ctx.close());

describe('discover', () => {
  it('new coins are ordered by first public mention, not mention count; private mints never appear', async () => {
    const d = (await ctx.as(me).get('/api/discover')).body;
    expect(d.newCoins.map((c: any) => c.token.symbol)).toEqual(['BBB', 'AAA']);
    expect(d.newCoins.find((c: any) => c.token.symbol === 'AAA').mentions24h).toBe(5);
    expect(JSON.stringify(d)).not.toContain(MINT_SECRET);
  });
  it('promoted tokens are only in the labeled promoted list', async () => {
    const d = (await ctx.as(me).get('/api/discover')).body;
    expect(d.promoted.map((c: any) => c.token.symbol)).toEqual(['PRO']);
    expect(d.promoted[0].promoted).toBe(true);
    expect(d.newCoins.some((c: any) => c.token.symbol === 'PRO')).toBe(false);
  });
  it('live rooms only include public communities', async () => {
    const d = (await ctx.as(me).get('/api/discover')).body;
    expect(d.liveRooms.map((r: any) => r.community.slug)).toEqual(['loud']);
    expect(d.liveRooms[0].messagesLast15m).toBe(5);
  });
  it('people exclude self, blocked-either-way and followed users', async () => {
    await ctx.as(me).put('/api/users/disc_quiet/follow');
    const people = (await ctx.as(me).get('/api/discover')).body.people.map((p: any) => p.user.username);
    expect(people).toContain('disc_loud');
    expect(people).not.toContain('disc_me');
    expect(people).not.toContain('disc_quiet');
    expect(people).not.toContain('disc_blocker');
  });
  it('sidebar is the compact version and reports simulator state', async () => {
    const s = (await ctx.as(me).get('/api/sidebar')).body;
    expect(s.newCoins.length).toBeLessThanOrEqual(5);
    expect(s.promoted.token.symbol).toBe('PRO');
    expect(s.demoSimulator).toBe(false);
  });
});
```
Note: `MINT_SECRET` reuses the SPL Token program id purely as a valid 32-byte string; it is stored as a fictional demo token in this test.

- [ ] **Step 2: Implement `routes/discover.ts`**

`apps/server/src/routes/discover.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gt, inArray, notInArray, sql } from 'drizzle-orm';
import type { DiscoverView, LiveRoomView, NewCoinView, PersonSuggestion, SidebarView } from '@shillex/shared';
import { channels, communities, communityMembers, follows, messages, posts, tokenMentions, tokens, users } from '../db/schema.ts';
import { requireUser } from '../lib/auth.ts';
import { hiddenAuthorIds } from '../services/visibility.ts';
import { communitySummaries, communityAvatar } from '../services/communities.ts';
import { tokenRowToView } from '../tokens/view.ts';
import { toUserSummary } from '../services/users.ts';

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
      activity: sql<number>`(select count(*)::int from ${posts} p where p.author_id = ${users.id} and p.created_at > ${since} and p.deleted_at is null and p.community_id is null)
        + (select count(*)::int from ${messages} m where m.author_id = ${users.id} and m.created_at > ${since} and m.channel_id is not null)`,
      followers: sql<number>`(select count(*)::int from ${follows} f where f.followee_id = ${users.id})`,
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
    const commRows = await db.select().from(communities).where(eq(communities.visibility, 'public')).limit(50);
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
```
If `orderBy(desc(sql\`2\`))` is rejected, order by the `activity` expression explicitly (`desc(sql\`activity\`)` with `.as('activity')` on the field).

- [ ] **Step 3: Register, run, commit**

Register `discoverRoutes` with `/api`.
Run: `npm test -w @shillex/server && npm run typecheck -w @shillex/server` → PASS.
```bash
git add apps/server
git commit -m "feat(server): discovery — live rooms, people, new coins by recency with labeled promotions"
```
