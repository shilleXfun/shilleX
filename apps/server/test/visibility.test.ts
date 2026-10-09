import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, type TestCtx, type TestUser } from './helpers.ts';
import { channels, communities, communityMembers, blocks, mutes, conversations, conversationMembers } from '../src/db/schema.ts';
import { requireChannel, canReadPost, getCommunityAccessBySlug, accessFor, computeMentionVisibility, getCommunityAccess, requireCommunityRead, requireConversationMember, hiddenAuthorIds, isBlockedEitherWay } from '../src/services/visibility.ts';
import { newId } from '../src/lib/ids.ts';

const comm = (visibility: 'public' | 'private' | 'invite') => ({
  id: newId(), slug: `c-${visibility}-${Math.random().toString(36).slice(2, 7)}`, name: 'C', description: '', avatarUrl: null, bannerUrl: null,
  visibility, ownerId: 'x', rules: '', createdAt: new Date(), isDemo: false,
});
const mem = (role: 'owner' | 'mod' | 'member', status: 'active' | 'pending' | 'banned') => ({ communityId: 'c', userId: 'u', role, status, joinedAt: new Date() });

describe('accessFor (pure)', () => {
  it('public: anyone reads, only active members post', () => {
    expect(accessFor(comm('public'), null)).toMatchObject({ canRead: true, canPost: false, isMod: false });
    expect(accessFor(comm('public'), mem('member', 'active'))).toMatchObject({ canRead: true, canPost: true });
    expect(accessFor(comm('public'), mem('member', 'banned'))).toMatchObject({ canRead: true, canPost: false });
  });
  it('private/invite: only active members read', () => {
    for (const v of ['private', 'invite'] as const) {
      expect(accessFor(comm(v), null).canRead).toBe(false);
      expect(accessFor(comm(v), mem('member', 'pending')).canRead).toBe(false);
      expect(accessFor(comm(v), mem('member', 'active')).canRead).toBe(true);
    }
  });
  it('mods and owners', () => {
    expect(accessFor(comm('public'), mem('mod', 'active')).isMod).toBe(true);
    expect(accessFor(comm('public'), mem('owner', 'active'))).toMatchObject({ isMod: true, isOwner: true });
    expect(accessFor(comm('public'), mem('mod', 'banned')).isMod).toBe(false);
  });
});

describe('computeMentionVisibility', () => {
  it('only public posts and public-community content are public', () => {
    expect(computeMentionVisibility({ kind: 'post', communityVisibility: null })).toBe(true);
    expect(computeMentionVisibility({ kind: 'post', communityVisibility: 'public' })).toBe(true);
    expect(computeMentionVisibility({ kind: 'post', communityVisibility: 'private' })).toBe(false);
    expect(computeMentionVisibility({ kind: 'post', communityVisibility: 'invite' })).toBe(false);
    expect(computeMentionVisibility({ kind: 'channel_message', communityVisibility: 'public' })).toBe(true);
    expect(computeMentionVisibility({ kind: 'channel_message', communityVisibility: 'private' })).toBe(false);
    expect(computeMentionVisibility({ kind: 'channel_message', communityVisibility: 'invite' })).toBe(false);
    expect(computeMentionVisibility({ kind: 'conversation_message' })).toBe(false);
  });
});

describe('db-backed checks', () => {
  let ctx: TestCtx; let a: TestUser; let b: TestUser; let c: TestUser;
  beforeAll(async () => {
    ctx = await makeTestApp();
    a = await ctx.createUser('alice'); b = await ctx.createUser('bob'); c = await ctx.createUser('carol');
  });
  afterAll(() => ctx.close());

  it('requireCommunityRead: 404 for invite-only, 403 for private, ok for members', async () => {
    const inv = { ...comm('invite'), ownerId: a.id };
    const priv = { ...comm('private'), ownerId: a.id };
    await ctx.db.insert(communities).values([inv, priv]);
    await ctx.db.insert(communityMembers).values({ communityId: priv.id, userId: a.id, role: 'owner', status: 'active', joinedAt: new Date() });
    expect(() => requireCommunityRead(null)).toThrow(expect.objectContaining({ status: 404 }));
    const invB = await getCommunityAccess(ctx.db, inv.id, b.id);
    expect(() => requireCommunityRead(invB)).toThrow(expect.objectContaining({ status: 404 }));
    const privB = await getCommunityAccess(ctx.db, priv.id, b.id);
    expect(() => requireCommunityRead(privB)).toThrow(expect.objectContaining({ status: 403, code: 'MEMBERS_ONLY' }));
    const privA = await getCommunityAccess(ctx.db, priv.id, a.id);
    expect(requireCommunityRead(privA).canRead).toBe(true);
  });

  it('requireConversationMember: 404 for non-members', async () => {
    const id = newId();
    await ctx.db.insert(conversations).values({ id, kind: 'group', name: 'g', createdBy: a.id, createdAt: new Date() });
    await ctx.db.insert(conversationMembers).values({ conversationId: id, userId: a.id, joinedAt: new Date() });
    await expect(requireConversationMember(ctx.db, id, a.id)).resolves.toMatchObject({ id });
    await expect(requireConversationMember(ctx.db, id, b.id)).rejects.toMatchObject({ status: 404 });
  });

  it('blocks and mutes', async () => {
    await ctx.db.insert(blocks).values({ userId: b.id, targetId: a.id, createdAt: new Date() });
    await ctx.db.insert(mutes).values({ userId: a.id, targetId: c.id, createdAt: new Date() });
    expect(await isBlockedEitherWay(ctx.db, a.id, b.id)).toBe(true);
    expect(await isBlockedEitherWay(ctx.db, b.id, a.id)).toBe(true);
    expect(await isBlockedEitherWay(ctx.db, a.id, c.id)).toBe(false);
    expect((await hiddenAuthorIds(ctx.db, a.id)).sort()).toEqual([b.id, c.id].sort());
    expect(await hiddenAuthorIds(ctx.db, b.id)).toEqual([a.id]);
  });
});

describe('db-backed access (fresh fixtures)', () => {
  let ctx: TestCtx;
  beforeAll(async () => { ctx = await makeTestApp(); });
  afterAll(() => ctx.close());

  const uname = () => `u${Math.random().toString(36).slice(2, 9)}`;
  async function setup(visibility: 'public' | 'private' | 'invite') {
    const owner = await ctx.createUser(uname());
    const c = { ...comm(visibility), ownerId: owner.id };
    await ctx.db.insert(communities).values(c);
    const channelId = newId();
    await ctx.db.insert(channels).values({ id: channelId, communityId: c.id, name: 'general' });
    const join = async (role: 'owner' | 'mod' | 'member', status: 'active' | 'pending' | 'banned') => {
      const u = await ctx.createUser(uname());
      await ctx.db.insert(communityMembers).values({ communityId: c.id, userId: u.id, role, status, joinedAt: new Date() });
      return u;
    };
    return { c, channelId, outsider: await ctx.createUser(uname()), join };
  }
  const post = (communityId: string | null, authorId: string) => ({
    id: newId(), authorId, kind: 'post' as const, body: 'x', communityId,
    visibility: communityId ? 'community' as const : 'public' as const, createdAt: new Date(),
  });

  it('requireChannel on a public community', async () => {
    const s = await setup('public');
    await expect(requireChannel(ctx.db, s.channelId, s.outsider.id, 'read')).resolves.toMatchObject({ channel: { id: s.channelId } });
    await expect(requireChannel(ctx.db, s.channelId, s.outsider.id, 'post')).rejects.toMatchObject({ status: 403, code: 'JOIN_TO_POST' });
    const banned = await s.join('member', 'banned');
    await expect(requireChannel(ctx.db, s.channelId, banned.id, 'read')).resolves.toBeTruthy();
    await expect(requireChannel(ctx.db, s.channelId, banned.id, 'post')).rejects.toMatchObject({ status: 403, code: 'BANNED' });
    const active = await s.join('member', 'active');
    await expect(requireChannel(ctx.db, s.channelId, active.id, 'post')).resolves.toBeTruthy();
  });

  it('requireChannel: pending member of a private community gets MEMBERS_ONLY', async () => {
    const s = await setup('private');
    const pending = await s.join('member', 'pending');
    await expect(requireChannel(ctx.db, s.channelId, pending.id, 'read')).rejects.toMatchObject({ status: 403, code: 'MEMBERS_ONLY' });
  });

  it('requireChannel: invite-only channel is indistinguishable from a missing one', async () => {
    const s = await setup('invite');
    const missing = await requireChannel(ctx.db, newId(), s.outsider.id, 'read').catch((e) => e);
    const hidden = await requireChannel(ctx.db, s.channelId, s.outsider.id, 'read').catch((e) => e);
    expect(missing).toMatchObject({ status: 404 });
    expect(hidden).toMatchObject({ status: 404, code: missing.code, message: missing.message });
    const pending = await s.join('member', 'pending');
    await expect(requireChannel(ctx.db, s.channelId, pending.id, 'post')).rejects.toMatchObject({ status: 404, message: missing.message });
  });

  it('canReadPost', async () => {
    const author = await ctx.createUser(uname());
    const anyone = await ctx.createUser(uname());
    expect(await canReadPost(ctx.db, post(null, author.id) as never, anyone.id)).toBe(true);
    const pub = await setup('public');
    expect(await canReadPost(ctx.db, post(pub.c.id, author.id) as never, pub.outsider.id)).toBe(true);
    for (const v of ['private', 'invite'] as const) {
      const s = await setup(v);
      const p = post(s.c.id, author.id) as never;
      expect(await canReadPost(ctx.db, p, s.outsider.id)).toBe(false);
      expect(await canReadPost(ctx.db, p, (await s.join('member', 'pending')).id)).toBe(false);
      expect(await canReadPost(ctx.db, p, (await s.join('member', 'banned')).id)).toBe(false);
      expect(await canReadPost(ctx.db, p, (await s.join('member', 'active')).id)).toBe(true);
    }
  });

  it('requireCommunityRead with pending and banned members', async () => {
    const priv = await setup('private');
    const inv = await setup('invite');
    for (const status of ['pending', 'banned'] as const) {
      const pu = await priv.join('member', status);
      const pa = await getCommunityAccess(ctx.db, priv.c.id, pu.id);
      expect(() => requireCommunityRead(pa)).toThrow(expect.objectContaining({ status: 403, code: 'MEMBERS_ONLY' }));
      const iu = await inv.join('member', status);
      const ia = await getCommunityAccess(ctx.db, inv.c.id, iu.id);
      expect(() => requireCommunityRead(ia)).toThrow(expect.objectContaining({ status: 404 }));
    }
  });

  it('getCommunityAccessBySlug', async () => {
    const s = await setup('public');
    const m = await s.join('member', 'active');
    expect(await getCommunityAccessBySlug(ctx.db, 'no-such-slug', m.id)).toBeNull();
    const bySlug = await getCommunityAccessBySlug(ctx.db, s.c.slug, m.id);
    expect(bySlug).toEqual(await getCommunityAccess(ctx.db, s.c.id, m.id));
    expect(bySlug?.canPost).toBe(true);
  });
});
