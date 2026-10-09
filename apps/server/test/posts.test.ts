import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestApp, type TestCtx, type TestUser } from './helpers.ts';
import { communities, communityMembers, tokenMentions, notifications, subscriptions, follows } from '../src/db/schema.ts';
import { and } from 'drizzle-orm';
import { setCommunityMentionVisibility } from '../src/services/mentions.ts';
import { newId } from '../src/lib/ids.ts';

const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
let ctx: TestCtx; let alice: TestUser; let bob: TestUser; let carol: TestUser;

async function community(visibility: 'public' | 'private' | 'invite', ownerId: string, members: string[] = []) {
  const id = newId();
  await ctx.db.insert(communities).values({ id, slug: `s${id.slice(-6).toLowerCase()}`, name: 'C', visibility, ownerId, createdAt: new Date() });
  await ctx.db.insert(communityMembers).values([ownerId, ...members].map((userId, i) => ({ communityId: id, userId, role: i === 0 ? 'owner' as const : 'member' as const, status: 'active' as const, joinedAt: new Date() })));
  return id;
}

beforeAll(async () => {
  ctx = await makeTestApp();
  alice = await ctx.createUser('alice'); bob = await ctx.createUser('bob'); carol = await ctx.createUser('carol');
});
afterAll(() => ctx.close());
beforeEach(() => ctx.bus.clear());

describe('creating posts', () => {
  it('creates a post, records a public mention, enqueues resolution', async () => {
    const r = await ctx.as(alice).post('/api/posts', { body: `new runner ${BONK}` });
    expect(r.status).toBe(201);
    expect(r.body.post).toMatchObject({ kind: 'post', body: `new runner ${BONK}`, mints: [BONK], author: { username: 'alice' } });
    expect(r.body.tokens[BONK].status).toBe('pending');
    const m = await ctx.db.select().from(tokenMentions).where(eq(tokenMentions.sourceId, r.body.post.id));
    expect(m).toHaveLength(1);
    expect(m[0]!.isPublic).toBe(true);
    expect(ctx.tokens.enqueued).toContain(BONK);
    expect(r.body.post.viewer).toMatchObject({ subscribed: true, canAddCallUpdate: true });
  });

  describe('body boundaries (Review Focus #3)', () => {
    it('rejects whitespace-only bodies', async () => {
      const r = await ctx.as(alice).post('/api/posts', { body: '   \n ' });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('EMPTY_BODY');
    });
    it('counts code points, not UTF-16 units', async () => {
      expect((await ctx.as(alice).post('/api/posts', { body: '🔥'.repeat(1000) })).status).toBe(201);
      const r = await ctx.as(alice).post('/api/posts', { body: 'a'.repeat(1001) });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('BODY_TOO_LONG');
    });
  });

  it('replies thread under the root and notify the parent author', async () => {
    const root = (await ctx.as(alice).post('/api/posts', { body: 'root' })).body.post;
    const reply = (await ctx.as(bob).post('/api/posts', { body: 'reply', parentId: root.id })).body.post;
    expect(reply).toMatchObject({ kind: 'reply', parentId: root.id, rootId: root.id, replyTo: { author: { username: 'alice' } } });
    const nested = (await ctx.as(carol).post('/api/posts', { body: 'nested', parentId: reply.id })).body.post;
    expect(nested.rootId).toBe(root.id);
    const thread = (await ctx.as(alice).get(`/api/posts/${root.id}`)).body;
    expect(thread.post.counts.replies).toBe(1);
    expect(thread.replies.map((p: any) => p.id)).toEqual([reply.id]);
    const notes = await ctx.db.select().from(notifications).where(eq(notifications.userId, alice.id));
    expect(notes.map((n) => n.type)).toContain('reply'); // bob's direct reply + carol's via subscription
    expect(ctx.bus.find('notification:new').some((e) => e.target === `user:${alice.id}`)).toBe(true);
  });

  it('notifies @mentioned users', async () => {
    await ctx.as(alice).post('/api/posts', { body: 'gm @carol' });
    const notes = await ctx.db.select().from(notifications).where(eq(notifications.userId, carol.id));
    expect(notes.some((n) => n.type === 'mention')).toBe(true);
  });

  it('quotes public posts but never private-community posts', async () => {
    const pub = (await ctx.as(bob).post('/api/posts', { body: 'quotable' })).body.post;
    const q = await ctx.as(alice).post('/api/posts', { body: 'this', quoteOfId: pub.id });
    expect(q.status).toBe(201);
    expect(q.body.post).toMatchObject({ kind: 'quote', quoted: { id: pub.id } });
    const priv = await community('private', bob.id, [alice.id]);
    const secret = (await ctx.as(bob).post('/api/posts', { body: 'secret', communityId: priv })).body.post;
    const bad = await ctx.as(alice).post('/api/posts', { body: 'leak', quoteOfId: secret.id });
    expect(bad.status).toBe(403);
    expect(bad.body.code).toBe('NOT_QUOTABLE');
  });

  it('community posts require membership and private ones are not public mentions', async () => {
    const priv = await community('private', bob.id);
    expect((await ctx.as(alice).post('/api/posts', { body: 'hi', communityId: priv })).status).toBe(403);
    const ok = await ctx.as(bob).post('/api/posts', { body: `alpha ${BONK}`, communityId: priv });
    const m = await ctx.db.select().from(tokenMentions).where(eq(tokenMentions.sourceId, ok.body.post.id));
    expect(m[0]!.isPublic).toBe(false);
    expect((await ctx.as(carol).get(`/api/posts/${ok.body.post.id}`)).status).toBe(404);
  });

  it('reposts, reactions and bookmarks toggle', async () => {
    const p = (await ctx.as(bob).post('/api/posts', { body: 'boost me' })).body.post;
    expect((await ctx.as(alice).post(`/api/posts/${p.id}/repost`)).status).toBe(201);
    expect((await ctx.as(alice).post(`/api/posts/${p.id}/repost`)).status).toBe(200); // idempotent
    let t = (await ctx.as(alice).get(`/api/posts/${p.id}`)).body;
    expect(t.post.counts.reposts).toBe(1);
    expect(t.post.viewer.reposted).toBe(true);
    await ctx.as(alice).del(`/api/posts/${p.id}/repost`);
    const fire = encodeURIComponent('🔥');
    const r1 = await ctx.as(alice).put(`/api/posts/${p.id}/reactions/${fire}`);
    expect(r1.body.reactions).toEqual([{ emoji: '🔥', count: 1, mine: true }]);
    expect((await ctx.as(alice).put(`/api/posts/${p.id}/reactions/${encodeURIComponent('💩')}`)).status).toBe(400);
    await ctx.as(alice).put(`/api/posts/${p.id}/bookmark`);
    const bms = (await ctx.as(alice).get('/api/bookmarks')).body;
    expect(bms.items.map((x: any) => x.id)).toContain(p.id);
    t = (await ctx.as(alice).get(`/api/posts/${p.id}`)).body;
    expect(t.post.counts.reposts).toBe(0);
    expect(t.post.viewer.bookmarked).toBe(true);
  });

  it('only the author can delete; deletion removes mentions and tombstones the post', async () => {
    const p = (await ctx.as(alice).post('/api/posts', { body: `bye ${BONK}` })).body.post;
    expect((await ctx.as(bob).del(`/api/posts/${p.id}`)).status).toBe(403);
    expect((await ctx.as(alice).del(`/api/posts/${p.id}`)).status).toBe(204);
    expect(await ctx.db.select().from(tokenMentions).where(eq(tokenMentions.sourceId, p.id))).toHaveLength(0);
    const t = (await ctx.as(alice).get(`/api/posts/${p.id}`)).body;
    expect(t.post).toMatchObject({ deleted: true, body: '', mints: [] });
  });

  it('attaches owned uploads only', async () => {
    const bad = await ctx.as(alice).post('/api/posts', { body: 'pic', uploadIds: ['nope'] });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('BAD_UPLOAD');
  });
});

describe('notification gating', () => {
  const notesFor = async (userId: string, targetId: string) =>
    (await ctx.db.select().from(notifications).where(eq(notifications.userId, userId))).filter((n) => n.targetId === targetId);

  it('notifies a subscriber who is not the parent author, flagged onSubscribed', async () => {
    const [o, sub, rep] = [await ctx.createUser('own1'), await ctx.createUser('sub1'), await ctx.createUser('rep1')];
    const root = (await ctx.as(o).post('/api/posts', { body: 'root' })).body.post;
    expect((await ctx.as(sub).put(`/api/posts/${root.id}/subscription`)).status).toBe(204);
    const reply = (await ctx.as(rep).post('/api/posts', { body: 'hello', parentId: root.id })).body.post;
    const notes = await notesFor(sub.id, reply.id);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ type: 'reply', data: { onSubscribed: '1' } });
  });

  it('does not notify subscribers who cannot read the post, or a parent author removed from the community', async () => {
    const [owner, member, outsider, ex] = [await ctx.createUser('own2'), await ctx.createUser('mem2'), await ctx.createUser('out2'), await ctx.createUser('ex2')];
    const priv = await community('private', owner.id, [member.id, ex.id]);
    const root = (await ctx.as(member).post('/api/posts', { body: 'in private', communityId: priv })).body.post;
    const exRoot = (await ctx.as(ex).post('/api/posts', { body: 'ex post', communityId: priv })).body.post;
    await ctx.db.insert(subscriptions).values({ userId: outsider.id, targetType: 'post', targetId: root.id, createdAt: new Date() });
    await ctx.db.delete(communityMembers).where(and(eq(communityMembers.communityId, priv), eq(communityMembers.userId, ex.id)));
    const reply = (await ctx.as(owner).post('/api/posts', { body: 'reply', parentId: root.id })).body.post;
    expect(await notesFor(outsider.id, reply.id)).toHaveLength(0);
    expect(await notesFor(member.id, reply.id)).toHaveLength(1);
    const reply2 = (await ctx.as(owner).post('/api/posts', { body: 'reply', parentId: exRoot.id })).body.post;
    expect(await notesFor(ex.id, reply2.id)).toHaveLength(0);
  });

  it('does not notify an @mentioned user who is not a member of a private community', async () => {
    const [owner, outsider] = [await ctx.createUser('own3'), await ctx.createUser('out3')];
    const priv = await community('private', owner.id);
    const p = (await ctx.as(owner).post('/api/posts', { body: 'psst @out3', communityId: priv })).body.post;
    expect(await notesFor(outsider.id, p.id)).toHaveLength(0);
  });

  it('rejects more than 4 images', async () => {
    const r = await ctx.as(alice).post('/api/posts', { body: 'pics', uploadIds: ['a', 'b', 'c', 'd', 'e'] });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('TOO_MANY_IMAGES');
  });
});

describe('posts the viewer can no longer read (metadata leak)', () => {
  it('shows a stripped tombstone for quoted posts whose community turned private', async () => {
    const [owner, quoter, viewer] = [await ctx.createUser('own4'), await ctx.createUser('quo4'), await ctx.createUser('view4')];
    const pubId = await community('public', owner.id);
    const orig = (await ctx.as(owner).post('/api/posts', { body: `secret alpha ${BONK}`, communityId: pubId })).body.post;
    await ctx.as(carol).put(`/api/posts/${orig.id}/reactions/${encodeURIComponent('🔥')}`);
    const quote = (await ctx.as(quoter).post('/api/posts', { body: 'look', quoteOfId: orig.id })).body.post;
    const repost = (await ctx.as(quoter).post(`/api/posts/${orig.id}/repost`)).body.post;
    await ctx.db.insert(follows).values({ followerId: viewer.id, followeeId: quoter.id, createdAt: new Date() });
    await ctx.db.update(communities).set({ visibility: 'private' }).where(eq(communities.id, pubId));
    await setCommunityMentionVisibility(ctx.db, pubId, false);

    const slug = (await ctx.db.select().from(communities).where(eq(communities.id, pubId)))[0]!.slug;
    const check = (v: any) => {
      expect(v).toMatchObject({
        id: orig.id, deleted: true, body: '', media: [], mints: [], callUpdates: [], community: null, replyTo: null,
        parentId: null, rootId: null, quoted: null, reposted: null, reactions: [],
        counts: { replies: 0, reposts: 0, quotes: 0 }, author: { id: '', username: 'unavailable' },
        viewer: { bookmarked: false, reposted: false, subscribed: false, canAddCallUpdate: false },
      });
    };
    const thread = (await ctx.as(viewer).get(`/api/posts/${quote.id}`)).body;
    expect(thread.post.kind).toBe('quote');
    check(thread.post.quoted);
    const feed = (await ctx.as(viewer).get('/api/feed?tab=following')).body;
    const fq = feed.items.find((p: any) => p.id === quote.id);
    check(fq.quoted);
    const raw = JSON.stringify([thread, feed]);
    for (const leak of [owner.id, 'own4', slug, 'secret alpha']) expect(raw).not.toContain(leak);
    // a reposted unreadable post is dropped from the feed rather than shown
    expect(feed.items.find((p: any) => p.id === repost.id)).toBeUndefined();
  });
});
