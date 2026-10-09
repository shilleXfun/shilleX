import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, type TestCtx, type TestUser } from './helpers.ts';

let ctx: TestCtx; let a: TestUser; let b: TestUser;
beforeAll(async () => {
  ctx = await makeTestApp();
  a = await ctx.createUser('notif_a'); b = await ctx.createUser('notif_b');
  const p = (await ctx.as(a).post('/api/posts', { body: 'hello' })).body.post;
  await ctx.as(b).post('/api/posts', { body: 'reply', parentId: p.id });
  await ctx.as(b).put('/api/users/notif_a/follow');
  await ctx.as(b).post('/api/posts', { body: 'yo @notif_a' });
});
afterAll(() => ctx.close());

describe('notifications', () => {
  it('lists newest first with text and href', async () => {
    const r = await ctx.as(a).get('/api/notifications');
    expect(r.body.items.map((n: any) => n.type)).toEqual(['mention', 'follow', 'reply']);
    expect(r.body.items[1]).toMatchObject({ text: 'notif_b followed you', href: '/u/notif_b', read: false });
  });
  it('filters mentions (mention + reply)', async () => {
    const r = await ctx.as(a).get('/api/notifications?filter=mentions');
    expect(r.body.items.map((n: any) => n.type)).toEqual(['mention', 'reply']);
  });
  it('marks read individually and all', async () => {
    const list = (await ctx.as(a).get('/api/notifications')).body.items;
    expect((await ctx.as(a).post('/api/notifications/read', { ids: [list[0].id] })).body.unread).toBe(2);
    expect((await ctx.as(a).post('/api/notifications/read', {})).body.unread).toBe(0);
    expect((await ctx.as(a).get('/api/notifications/unread-count')).body.unread).toBe(0);
  });
  it('never returns another user’s notifications', async () => {
    const list = (await ctx.as(a).get('/api/notifications')).body.items;
    await ctx.as(b).post('/api/notifications/read', { ids: [list[0].id] });
    expect((await ctx.as(b).get('/api/notifications')).body.items.every((n: any) => !list.some((x: any) => x.id === n.id))).toBe(true);
  });
});
