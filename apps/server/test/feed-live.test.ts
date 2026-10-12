import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, type TestCtx, type TestUser } from './helpers.ts';
import { blocks, communities, communityMembers, follows, mutes } from '../src/db/schema.ts';
import { newId } from '../src/lib/ids.ts';

let ctx: TestCtx; let me: TestUser; let friend: TestUser; let stranger: TestUser; let muted: TestUser; let blocker: TestUser; let blockedByMe: TestUser; let demo: TestUser;

/** Each post a second after the last, so "newest first" is visible in createdAt too. */
const say = async (u: TestUser, body: string, extra: Record<string, unknown> = {}) => {
  ctx.clock.advance(1000);
  const r = await ctx.as(u).post('/api/posts', { body, ...extra });
  expect(r.status).toBe(201);
  return r.body.post.id as string;
};
const live = async (u: TestUser, q = '') => (await ctx.as(u).get(`/api/feed?tab=live${q}`)).body;
const bodiesOf = (items: { body: string }[]) => items.map((p) => p.body);

beforeAll(async () => {
  ctx = await makeTestApp();
  me = await ctx.createUser('me'); friend = await ctx.createUser('friend'); stranger = await ctx.createUser('stranger');
  muted = await ctx.createUser('muted'); blocker = await ctx.createUser('blocker'); blockedByMe = await ctx.createUser('blocked');
  demo = await ctx.createUser('demo_persona', { isDemo: true });
  const at = new Date();
  await ctx.db.insert(follows).values({ followerId: me.id, followeeId: friend.id, createdAt: at });
  await ctx.db.insert(mutes).values({ userId: me.id, targetId: muted.id, createdAt: at });
  await ctx.db.insert(blocks).values([{ userId: blocker.id, targetId: me.id, createdAt: at }, { userId: me.id, targetId: blockedByMe.id, createdAt: at }]);
  const c = newId();
  await ctx.db.insert(communities).values({ id: c, slug: 'liveroom', name: 'Room', visibility: 'public', ownerId: stranger.id, createdAt: at });
  await ctx.db.insert(communityMembers).values({ communityId: c, userId: stranger.id, role: 'owner', status: 'active', joinedAt: at });

  const first = await say(stranger, 'a stranger speaks');
  await say(friend, 'a friend speaks');
  await say(me, 'I speak');
  await say(muted, 'muted words');
  await say(blocker, 'words from someone who blocked me');
  await say(blockedByMe, 'words from someone I blocked');
  await say(friend, 'quoting the stranger', { quoteOfId: first });
  await say(stranger, 'a reply', { parentId: first });
  expect((await ctx.as(friend).post(`/api/posts/${first}/repost`)).status).toBeLessThan(300);
  await say(stranger, 'inside the room', { communityId: c });
  const gone = await say(stranger, 'deleted soon');
  expect((await ctx.as(stranger).del(`/api/posts/${gone}`)).status).toBe(204);
  await say(demo, 'a seeded line');
});
afterAll(() => ctx.close());

describe('GET /api/feed?tab=live', () => {
  it('lists every public post and quote newest first, the viewer’s own and followees’ included', async () => {
    const page = await live(me);
    expect(bodiesOf(page.items)).toEqual(['a seeded line', 'quoting the stranger', 'I speak', 'a friend speaks', 'a stranger speaks']);
    const times = page.items.map((p: { createdAt: string }) => p.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
    expect(page.nextCursor).toBeNull();
  });

  it('leaves out plain reposts, replies, community posts and deleted posts', async () => {
    const items = (await live(me)).items as { kind: string; community: unknown; deleted: boolean }[];
    expect(items.every((p) => (p.kind === 'post' || p.kind === 'quote') && !p.community && !p.deleted)).toBe(true);
  });

  it('respects the viewer’s mutes and blocks either way, and only the viewer’s', async () => {
    const mine = bodiesOf((await live(me)).items);
    for (const hidden of ['muted words', 'words from someone who blocked me', 'words from someone I blocked']) expect(mine).not.toContain(hidden);
    // Someone else's view is not shaped by my mutes and blocks.
    expect(bodiesOf((await live(stranger)).items)).toEqual(expect.arrayContaining(['muted words', 'words from someone who blocked me', 'words from someone I blocked']));
  });

  it('hides demo personas while HIDE_DEMO is on', async () => {
    ctx.deps.config.hideDemo = true;
    try { expect(bodiesOf((await live(me)).items)).not.toContain('a seeded line'); }
    finally { ctx.deps.config.hideDemo = false; }
  });

  it('pages by a keyset cursor: pages never overlap, even when new posts land between them', async () => {
    const all = (await live(stranger)).items.map((p: { id: string }) => p.id) as string[];
    const seen: string[] = [];
    let cursor: string | null = null;
    let fresh = 0;
    do {
      const page = await live(stranger, `&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      seen.push(...page.items.map((p: { id: string }) => p.id));
      cursor = page.nextCursor;
      // A new post arrives while the reader scrolls; with an offset it would push a seen post onto the next page.
      await say(friend, `arrived while scrolling ${fresh++}`);
    } while (cursor);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toEqual(all);
  });
});
