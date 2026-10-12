import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { makeTestApp, type TestCtx, type TestUser } from './helpers.ts';
import { blocks, communities, communityMembers, follows, mutes } from '../src/db/schema.ts';
import { SocketBus } from '../src/realtime/socket.ts';
import { newId } from '../src/lib/ids.ts';

let ctx: TestCtx; let author: TestUser; let fan: TestUser; let muter: TestUser; let blocker: TestUser; let blockedByAuthor: TestUser; let stranger: TestUser;
const live = () => ctx.bus.find('post:live');

beforeAll(async () => {
  ctx = await makeTestApp();
  author = await ctx.createUser('author'); fan = await ctx.createUser('fan'); muter = await ctx.createUser('muter');
  blocker = await ctx.createUser('blocker'); blockedByAuthor = await ctx.createUser('blocked'); stranger = await ctx.createUser('stranger');
  const at = new Date();
  await ctx.db.insert(follows).values({ followerId: fan.id, followeeId: author.id, createdAt: at });
  await ctx.db.insert(mutes).values({ userId: muter.id, targetId: author.id, createdAt: at });
  await ctx.db.insert(blocks).values([{ userId: blocker.id, targetId: author.id, createdAt: at }, { userId: author.id, targetId: blockedByAuthor.id, createdAt: at }]);
});
afterAll(() => ctx.close());
beforeEach(() => ctx.bus.clear());

describe('post:live', () => {
  it('announces a public post and a quote to the live room, leaving out the author, followers, muters and blocks either way', async () => {
    const p = await ctx.as(author).post('/api/posts', { body: 'gm swarm' });
    expect(live()).toEqual([{ target: 'agents:live', event: 'post:live', payload: { postId: p.body.post.id, authorId: author.id }, except: expect.any(Array) }]);
    const except = live()[0]!.except!;
    expect(new Set(except)).toEqual(new Set([author.id, fan.id, muter.id, blocker.id, blockedByAuthor.id]));
    expect(except).not.toContain(stranger.id);
    // Followers still get post:new, as before.
    expect(ctx.bus.find('post:new').map((e) => e.target)).toEqual([`user:${fan.id}`]);
    ctx.bus.clear();
    const q = await ctx.as(author).post('/api/posts', { body: 'this', quoteOfId: p.body.post.id });
    expect(live().map((e) => e.payload)).toEqual([{ postId: q.body.post.id, authorId: author.id }]);
  });

  it('never announces a reply, a repost or a community post', async () => {
    const p = await ctx.as(stranger).post('/api/posts', { body: 'root' });
    ctx.bus.clear();
    expect((await ctx.as(author).post('/api/posts', { body: 'a reply', parentId: p.body.post.id })).status).toBe(201);
    expect((await ctx.as(author).post(`/api/posts/${p.body.post.id}/repost`)).status).toBeLessThan(300);
    const c = newId();
    await ctx.db.insert(communities).values({ id: c, slug: `live${c.slice(-6).toLowerCase()}`, name: 'C', visibility: 'public', ownerId: author.id, createdAt: new Date() });
    await ctx.db.insert(communityMembers).values({ communityId: c, userId: author.id, role: 'owner', status: 'active', joinedAt: new Date() });
    expect((await ctx.as(author).post('/api/posts', { body: 'in the room', communityId: c })).status).toBe(201);
    expect(live()).toEqual([]);
  });

  it('keeps demo personas off Live while HIDE_DEMO is on, as /feed/public does', async () => {
    const demo = await ctx.createUser('demo_persona', { isDemo: true });
    ctx.deps.config.hideDemo = true;
    try {
      await ctx.as(demo).post('/api/posts', { body: 'seeded line' });
      expect(live()).toEqual([]);
    } finally { ctx.deps.config.hideDemo = false; }
    await ctx.as(demo).post('/api/posts', { body: 'seeded line again' });
    expect(live()).toHaveLength(1);
  });
});

describe('SocketBus.toRoomExcept', () => {
  it('skips the listed users’ sockets and still mirrors the live room to visitors on /live', () => {
    const sent: string[] = [];
    const ns = (name: string) => ({ to: (room: string) => ({
      emit: (event: string) => { sent.push(`${name} ${room} ${event}`); },
      except: (rooms: string[]) => ({ emit: (event: string) => { sent.push(`${name} ${room} -${rooms.join(',')} ${event}`); } }),
    }) });
    const io = { ...ns('/'), of: (n: string) => ns(n) };
    const bus = new SocketBus();
    bus.attach(io as never);
    bus.toRoomExcept('agents:live', ['u1', 'u2'], 'post:live', {});
    bus.toRoomExcept('community:x', ['u1'], 'post:live', {});
    expect(sent).toEqual(['/ agents:live -user:u1,user:u2 post:live', '/live agents:live post:live', '/ community:x -user:u1 post:live']);
  });
});
