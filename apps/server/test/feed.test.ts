import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, type TestCtx, type TestUser } from './helpers.ts';
import { follows, mutes } from '../src/db/schema.ts';

let ctx: TestCtx; let me: TestUser; let friend: TestUser; let stranger: TestUser; let loud: TestUser; let muted: TestUser; let quiet: TestUser;

beforeAll(async () => {
  ctx = await makeTestApp();
  me = await ctx.createUser('me'); friend = await ctx.createUser('friend'); stranger = await ctx.createUser('stranger');
  loud = await ctx.createUser('loud'); muted = await ctx.createUser('muted'); quiet = await ctx.createUser('quiet');
  await ctx.db.insert(follows).values([{ followerId: me.id, followeeId: friend.id, createdAt: new Date() }, { followerId: me.id, followeeId: muted.id, createdAt: new Date() }]);
  await ctx.db.insert(mutes).values([{ userId: me.id, targetId: muted.id, createdAt: new Date() }, { userId: me.id, targetId: quiet.id, createdAt: new Date() }]);
  await ctx.as(quiet).post('/api/posts', { body: 'quiet post' });
  await ctx.as(friend).post('/api/posts', { body: 'friend post' });
  await ctx.as(me).post('/api/posts', { body: 'my post' });
  await ctx.as(muted).post('/api/posts', { body: 'muted post' });
  const s = (await ctx.as(stranger).post('/api/posts', { body: 'stranger post' })).body.post;
  await ctx.as(friend).post(`/api/posts/${s.id}/repost`);
  for (let i = 0; i < 6; i++) await ctx.as(loud).post('/api/posts', { body: `loud ${i}` });
  await ctx.as(friend).post('/api/posts', { body: 'reply', parentId: s.id });
});
afterAll(() => ctx.close());

describe('GET /api/feed', () => {
  it('following: followees + self, reposts included, replies and muted excluded, newest first', async () => {
    const r = await ctx.as(me).get('/api/feed?tab=following');
    expect(r.status).toBe(200);
    const bodies = r.body.items.map((p: any) => (p.kind === 'repost' ? `RP:${p.reposted.body}` : p.body));
    expect(bodies).toEqual(['RP:stranger post', 'my post', 'friend post']);
  });

  it('following: cursor pagination', async () => {
    const first = await ctx.as(me).get('/api/feed?tab=following&limit=2');
    expect(first.body.items).toHaveLength(2);
    const second = await ctx.as(me).get(`/api/feed?tab=following&limit=2&cursor=${first.body.nextCursor}`);
    expect(second.body.items.map((p: any) => p.body)).toEqual(['friend post']);
    expect(second.body.nextCursor).toBeNull();
  });

  it('discover: excludes self, followed and muted; caps 2 posts per author per page', async () => {
    const r = await ctx.as(me).get('/api/feed?tab=discover&limit=10');
    const authors = r.body.items.map((p: any) => p.author.username);
    expect(authors).not.toContain('me');
    expect(authors).not.toContain('friend');
    expect(authors).not.toContain('muted');
    expect(authors).not.toContain('quiet'); // muted but not followed
    expect(authors).toContain('stranger');
    expect(authors.filter((a: string) => a === 'loud').length).toBeLessThanOrEqual(2);
    expect(r.body.items.every((p: any) => p.kind === 'post' || p.kind === 'quote')).toBe(true);
  });

  it('rejects unknown tabs', async () => {
    expect((await ctx.as(me).get('/api/feed?tab=nope')).status).toBe(400);
  });
});
