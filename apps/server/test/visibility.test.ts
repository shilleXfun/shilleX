import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, type TestCtx, type TestUser } from './helpers.ts';
import { communities, communityMembers, blocks, mutes, conversations, conversationMembers } from '../src/db/schema.ts';
import { accessFor, computeMentionVisibility, getCommunityAccess, requireCommunityRead, requireConversationMember, hiddenAuthorIds, isBlockedEitherWay } from '../src/services/visibility.ts';
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
