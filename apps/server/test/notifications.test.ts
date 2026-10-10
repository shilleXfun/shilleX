import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { excerptOf, notify } from '../src/services/notify.ts';
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
  it('never returns or modifies another user’s notifications', async () => {
    const list = (await ctx.as(a).get('/api/notifications')).body.items;
    // Make A's items unread again by creating a fresh one, then let B try to mark it read.
    await ctx.as(b).post('/api/posts', { body: 'again @notif_a' });
    const fresh = (await ctx.as(a).get('/api/notifications')).body.items[0];
    expect(fresh.read).toBe(false);
    const unreadBefore = (await ctx.as(a).get('/api/notifications/unread-count')).body.unread;
    const r = await ctx.as(b).post('/api/notifications/read', { ids: [fresh.id] });
    expect(r.body.unread).toBe((await ctx.as(b).get('/api/notifications/unread-count')).body.unread);
    expect((await ctx.as(b).get('/api/notifications')).body.items.every((n: any) => !list.some((x: any) => x.id === n.id) && n.id !== fresh.id)).toBe(true);
    expect((await ctx.as(a).get('/api/notifications/unread-count')).body.unread).toBe(unreadBefore);
    expect((await ctx.as(a).get('/api/notifications')).body.items[0]).toMatchObject({ id: fresh.id, read: false });
  });
  it('calls filter includes token_discussion', async () => {
    await notify(ctx.deps, { userId: a.id, type: 'token_discussion', actorId: b.id, targetType: 'token', targetId: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', data: { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', label: 'TKN' } });
    const r = await ctx.as(a).get('/api/notifications?filter=calls');
    expect(r.body.items.map((n: any) => n.type)).toContain('token_discussion');
  });
  it('paginates with limit and nextCursor', async () => {
    const all = (await ctx.as(a).get('/api/notifications')).body.items;
    expect(all.length).toBeGreaterThan(3);
    const p1 = (await ctx.as(a).get('/api/notifications?limit=2')).body;
    expect(p1.items.map((n: any) => n.id)).toEqual(all.slice(0, 2).map((n: any) => n.id));
    expect(p1.nextCursor).toBe(all[1].id);
    const p2 = (await ctx.as(a).get(`/api/notifications?limit=2&cursor=${p1.nextCursor}`)).body;
    expect(p2.items.map((n: any) => n.id)).toEqual(all.slice(2, 4).map((n: any) => n.id));
    const last = (await ctx.as(a).get(`/api/notifications?limit=${all.length}`)).body;
    expect(last.nextCursor).toBeNull();
  });
});

describe('notification excerpts', () => {
  const MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
  it('formats one line: addresses shortened, whitespace collapsed, long text cut on a character', () => {
    expect(excerptOf(`look at\n\n  ${MINT}  now`)).toBe('look at DezX…B263 now');
    expect(excerptOf('   ')).toBeNull();
    const long = excerptOf(`${'a'.repeat(138)}🪖🪖🪖`)!;
    expect([...long]).toHaveLength(140);
    expect(long.endsWith('🪖…')).toBe(true);
  });
  it('carries the reply or mention text; follows have none', async () => {
    const items = (await ctx.as(a).get('/api/notifications?limit=100')).body.items;
    const byType = (t: string) => items.find((n: any) => n.type === t);
    expect(byType('reply').excerpt).toBe('reply');
    expect(items.filter((n: any) => n.type === 'mention').map((n: any) => n.excerpt)).toContain('yo @notif_a');
    expect(byType('follow').excerpt).toBeNull();
  });
  it('drops the excerpt once the post is deleted', async () => {
    const p = (await ctx.as(b).post('/api/posts', { body: 'gone soon @notif_a' })).body.post;
    expect((await ctx.as(a).get('/api/notifications')).body.items[0].excerpt).toBe('gone soon @notif_a');
    expect((await ctx.as(b).del(`/api/posts/${p.id}`)).status).toBe(204);
    expect((await ctx.as(a).get('/api/notifications')).body.items[0].excerpt).toBeNull();
  });
  it('hides a private channel mention once the viewer leaves the community', async () => {
    await ctx.as(b).post('/api/communities', { name: 'Hideout', slug: 'hideout', visibility: 'private' });
    await ctx.as(a).post('/api/communities/hideout/join');
    expect((await ctx.as(b).post(`/api/communities/hideout/requests/${a.id}/approve`)).status).toBe(204);
    const channel = (await ctx.as(b).get('/api/communities/hideout')).body.community.channels[0].id;
    expect((await ctx.as(b).post(`/api/channels/${channel}/messages`, { body: 'psst @notif_a' })).status).toBe(201);
    const mention = () => ctx.as(a).get('/api/notifications').then((r) => r.body.items.find((n: any) => n.target.type === 'message'));
    expect((await mention()).excerpt).toBe('psst @notif_a');
    expect((await ctx.as(a).del('/api/communities/hideout/membership')).status).toBe(204);
    expect((await mention()).excerpt).toBeNull();
  });
});
