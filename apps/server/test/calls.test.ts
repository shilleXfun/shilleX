import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { communities, communityMembers, notifications } from '../src/db/schema.ts';
import { newId } from '../src/lib/ids.ts';
import { makeTestApp, type TestCtx, type TestUser } from './helpers.ts';

const MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
let ctx: TestCtx; let caller: TestUser; let fan: TestUser; let call: any; let plain: any;
beforeAll(async () => {
  ctx = await makeTestApp();
  caller = await ctx.createUser('caller'); fan = await ctx.createUser('fan');
  call = (await ctx.as(caller).post('/api/posts', { body: `watching ${MINT}` })).body.post;
  plain = (await ctx.as(caller).post('/api/posts', { body: 'no token here' })).body.post;
  await ctx.as(fan).put(`/api/posts/${call.id}/subscription`);
});
afterAll(() => ctx.close());

describe('call updates', () => {
  it('author adds self-reported updates that stay attached in order', async () => {
    ctx.bus.clear();
    const a = await ctx.as(caller).post(`/api/posts/${call.id}/call-updates`, { status: 'bought', note: 'small bag' });
    expect(a.status).toBe(201);
    expect(a.body.update).toMatchObject({ status: 'bought', note: 'small bag', selfReported: true });
    await ctx.as(caller).post(`/api/posts/${call.id}/call-updates`, { status: 'taking_profit' });
    const t = (await ctx.as(fan).get(`/api/posts/${call.id}`)).body;
    expect(t.post.callUpdates.map((u: any) => u.status)).toEqual(['bought', 'taking_profit']);
    expect(ctx.bus.find('call:update').filter((e) => e.target === `user:${fan.id}`)).toHaveLength(2);
    const n = (await ctx.as(fan).get('/api/notifications?filter=calls')).body.items;
    expect(n[0].text).toMatch(/Taking profit \(self-reported\)/);
  });
  it('rejects non-authors, posts without tokens, and bad statuses', async () => {
    expect((await ctx.as(fan).post(`/api/posts/${call.id}/call-updates`, { status: 'out' })).body.code).toBe('NOT_AUTHOR');
    expect((await ctx.as(caller).post(`/api/posts/${plain.id}/call-updates`, { status: 'out' })).body.code).toBe('NO_TOKEN');
    expect((await ctx.as(caller).post(`/api/posts/${call.id}/call-updates`, { status: 'moon' })).status).toBe(400);
    expect((await ctx.as(caller).post(`/api/posts/${call.id}/call-updates`, { status: 'out', note: 'x'.repeat(281) })).status).toBe(400);
  });

  it('author gets the socket event in their own room but no notification', async () => {
    ctx.bus.clear();
    const before = (await ctx.as(caller).get('/api/notifications?filter=calls')).body.items.length;
    await ctx.as(caller).post(`/api/posts/${call.id}/call-updates`, { status: 'watching' });
    expect(ctx.bus.find('call:update').filter((e) => e.target === `user:${caller.id}`)).toHaveLength(1);
    expect((await ctx.as(caller).get('/api/notifications?filter=calls')).body.items).toHaveLength(before);
  });
  it('rejects replies and reposts but accepts quotes that mention a token', async () => {
    const reply = (await ctx.as(caller).post('/api/posts', { body: `re ${MINT}`, parentId: plain.id })).body.post;
    const repost = (await ctx.as(fan).post(`/api/posts/${call.id}/repost`)).body.post;
    const quote = (await ctx.as(caller).post('/api/posts', { body: `quoting ${MINT}`, quoteOfId: plain.id })).body.post;
    expect((await ctx.as(caller).post(`/api/posts/${reply.id}/call-updates`, { status: 'out' })).body.code).toBe('NO_TOKEN');
    expect((await ctx.as(fan).post(`/api/posts/${repost.id}/call-updates`, { status: 'out' })).body.code).toBe('NO_TOKEN');
    expect((await ctx.as(caller).post(`/api/posts/${quote.id}/call-updates`, { status: 'bought' })).status).toBe(201);
  });
  it('rejects updates on a deleted post', async () => {
    const p = (await ctx.as(caller).post('/api/posts', { body: `gone ${MINT}` })).body.post;
    await ctx.as(caller).del(`/api/posts/${p.id}`);
    const r = await ctx.as(caller).post(`/api/posts/${p.id}/call-updates`, { status: 'out' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('POST_DELETED');
  });
  it('does not leak updates to subscribers who lost access, blocked, or muted the author', async () => {
    const removed = await ctx.createUser('removed_sub'); const blocker = await ctx.createUser('blocker_sub');
    const muter = await ctx.createUser('muter_sub'); const stays = await ctx.createUser('stays_sub');
    const cid = newId();
    await ctx.db.insert(communities).values({ id: cid, slug: 'secret-call', name: 'Secret', visibility: 'private', ownerId: caller.id, createdAt: new Date(), });
    for (const u of [caller, removed, stays]) {
      await ctx.db.insert(communityMembers).values({ communityId: cid, userId: u.id, role: u.id === caller.id ? 'owner' : 'member', status: 'active', joinedAt: new Date() });
    }
    const cp = (await ctx.as(caller).post('/api/posts', { body: `private ${MINT}`, communityId: cid })).body.post;
    expect(cp).toBeTruthy();
    for (const u of [removed, stays]) expect((await ctx.as(u).put(`/api/posts/${cp.id}/subscription`)).status).toBeLessThan(300);
    for (const u of [blocker, muter]) await ctx.as(u).put(`/api/posts/${call.id}/subscription`);
    await ctx.as(blocker).put(`/api/users/${caller.username}/block`);
    await ctx.as(muter).put(`/api/users/${caller.username}/mute`);
    await ctx.db.delete(communityMembers).where(and(eq(communityMembers.communityId, cid), eq(communityMembers.userId, removed.id)));

    ctx.bus.clear();
    expect((await ctx.as(caller).post(`/api/posts/${cp.id}/call-updates`, { status: 'bought', note: 'secret' })).status).toBe(201);
    await ctx.as(caller).post(`/api/posts/${call.id}/call-updates`, { status: 'out' });
    const to = (u: TestUser) => ctx.bus.find('call:update').filter((e) => e.target === `user:${u.id}`);
    expect(to(removed)).toHaveLength(0);
    expect(to(blocker)).toHaveLength(0);
    expect(to(muter)).toHaveLength(0);
    expect(to(stays)).toHaveLength(1);
    for (const u of [removed, blocker, muter]) {
      expect(await ctx.db.select().from(notifications).where(and(eq(notifications.userId, u.id), eq(notifications.type, 'call_update')))).toHaveLength(0);
    }
  });
});
