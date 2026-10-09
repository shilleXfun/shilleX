import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestApp, type TestCtx, type TestUser } from './helpers.ts';
import { notifications, follows } from '../src/db/schema.ts';

let ctx: TestCtx; let blocker: TestUser; let blocked: TestUser; let post: any;
beforeAll(async () => {
  ctx = await makeTestApp();
  blocker = await ctx.createUser('blocker'); blocked = await ctx.createUser('blocked_guy');
  await ctx.as(blocked).put('/api/users/blocker/follow');
  post = (await ctx.as(blocker).post('/api/posts', { body: 'mine' })).body.post;
  expect((await ctx.as(blocker).put('/api/users/blocked_guy/block')).status).toBe(204);
});
afterAll(() => ctx.close());

describe('blocks across interaction paths', () => {
  it('removes follows both ways', async () => {
    expect(await ctx.db.select().from(follows).where(eq(follows.followerId, blocked.id))).toHaveLength(0);
  });
  it('blocked user cannot reply, quote, repost, react or follow', async () => {
    const reply = await ctx.as(blocked).post('/api/posts', { body: 'x', parentId: post.id });
    expect(reply.status).toBe(403);
    expect((await ctx.as(blocked).post('/api/posts', { body: 'x', quoteOfId: post.id })).status).toBe(403);
    expect((await ctx.as(blocked).post(`/api/posts/${post.id}/repost`)).status).toBe(403);
    expect((await ctx.as(blocked).put(`/api/posts/${post.id}/reactions/${encodeURIComponent('🔥')}`)).status).toBe(403);
    expect((await ctx.as(blocked).put('/api/users/blocker/follow')).status).toBe(403);
  });
  it('mentions from the blocked user do not notify', async () => {
    await ctx.as(blocked).post('/api/posts', { body: 'hey @blocker' });
    const n = await ctx.db.select().from(notifications).where(eq(notifications.userId, blocker.id));
    expect(n.filter((x) => x.actorId === blocked.id && x.type === 'mention')).toHaveLength(0);
  });
  it('neither sees the other in feeds, profiles posts or user search', async () => {
    const d1 = await ctx.as(blocked).get('/api/feed?tab=discover');
    expect(d1.body.items.some((p: any) => p.author.username === 'blocker')).toBe(false);
    const d2 = await ctx.as(blocker).get('/api/feed?tab=discover');
    expect(d2.body.items.some((p: any) => p.author.username === 'blocked_guy')).toBe(false);
    expect((await ctx.as(blocked).get('/api/users/blocker/posts')).status).toBe(403);
    expect((await ctx.as(blocked).get('/api/users?q=blocker')).body.users).toEqual([]);
  });
  it('unblock restores interaction', async () => {
    await ctx.as(blocker).del('/api/users/blocked_guy/block');
    expect((await ctx.as(blocked).post('/api/posts', { body: 'ok', parentId: post.id })).status).toBe(201);
  });
});
