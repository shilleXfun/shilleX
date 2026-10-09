import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestApp, type TestCtx, type TestUser } from './helpers.ts';
import { tokenMentions } from '../src/db/schema.ts';

const MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
let ctx: TestCtx; let a: TestUser; let b: TestUser; let c: TestUser; let d: TestUser;
beforeAll(async () => {
  ctx = await makeTestApp();
  a = await ctx.createUser('dm_a'); b = await ctx.createUser('dm_b'); c = await ctx.createUser('dm_c'); d = await ctx.createUser('dm_d');
});
afterAll(() => ctx.close());
beforeEach(() => { ctx.bus.clear(); ctx.clock.advance(61_000); });

describe('conversations', () => {
  let dmId: string; let groupId: string;
  it('creates a DM once (idempotent) and notifies', async () => {
    const r1 = await ctx.as(a).post('/api/conversations', { kind: 'dm', username: 'dm_b' });
    expect(r1.status).toBe(201);
    dmId = r1.body.conversation.id;
    const r2 = await ctx.as(b).post('/api/conversations', { kind: 'dm', username: 'dm_a' });
    expect(r2.status).toBe(200);
    expect(r2.body.conversation.id).toBe(dmId);
  });
  it('messages go to every member’s user room; private mentions are never public', async () => {
    const r = await ctx.as(a).post(`/api/conversations/${dmId}/messages`, { body: `check ${MINT}`, attachments: [{ type: 'token', mint: MINT }] });
    expect(r.status).toBe(201);
    expect(r.body.message.attachments).toEqual([{ type: 'token', mint: MINT }]);
    expect(ctx.bus.find('message:new').map((e) => e.target).sort()).toEqual([`user:${a.id}`, `user:${b.id}`].sort());
    const m = await ctx.db.select().from(tokenMentions).where(eq(tokenMentions.sourceId, r.body.message.id));
    expect(m.every((x) => x.isPublic === false)).toBe(true);
  });
  it('non-members get 404, never 403', async () => {
    expect((await ctx.as(c).get(`/api/conversations/${dmId}/messages`)).status).toBe(404);
    expect((await ctx.as(c).post(`/api/conversations/${dmId}/messages`, { body: 'hi' })).status).toBe(404);
  });
  it('groups: create, list with unread, rename, add, leave (with eviction)', async () => {
    const g = await ctx.as(a).post('/api/conversations', { kind: 'group', name: 'Degen desk', usernames: ['dm_b', 'dm_c'] });
    groupId = g.body.conversation.id;
    expect(g.body.conversation.members).toHaveLength(3);
    await ctx.as(b).post(`/api/conversations/${groupId}/messages`, { body: 'gm desk' });
    const list = (await ctx.as(c).get('/api/conversations')).body.conversations;
    expect(list.find((x: any) => x.id === groupId)).toMatchObject({ unread: 1, lastMessage: { body: 'gm desk' } });
    expect((await ctx.as(a).patch(`/api/conversations/${groupId}`, { name: 'Desk 2' })).body.conversation.name).toBe('Desk 2');
    expect((await ctx.as(a).post(`/api/conversations/${groupId}/members`, { usernames: ['dm_d'] })).body.conversation.members).toHaveLength(4);
    expect((await ctx.as(c).del(`/api/conversations/${groupId}/members/me`)).status).toBe(204);
    expect(ctx.bus.evictions).toContainEqual({ userId: c.id, room: `conversation:${groupId}` });
    expect((await ctx.as(c).get(`/api/conversations/${groupId}/messages`)).status).toBe(404);
  });
  it('blocks prevent DMs both ways', async () => {
    await ctx.as(d).put('/api/users/dm_a/block');
    expect((await ctx.as(a).post('/api/conversations', { kind: 'dm', username: 'dm_d' })).body.code).toBe('BLOCKED');
    const existing = await ctx.as(a).post('/api/conversations', { kind: 'dm', username: 'dm_b' });
    expect(existing.status).toBe(200);
    await ctx.as(b).put('/api/users/dm_a/block');
    expect((await ctx.as(a).post(`/api/conversations/${dmId}/messages`, { body: 'still there?' })).body.code).toBe('BLOCKED');
  });
  it('group size is capped at 20', async () => {
    const many = await Promise.all(Array.from({ length: 20 }, (_, i) => ctx.createUser(`bulk_${i}`)));
    const r = await ctx.as(c).post('/api/conversations', { kind: 'group', name: 'Too big', usernames: many.map((u) => u.username) });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('GROUP_TOO_LARGE');
  });
  it('search only covers conversations you are in', async () => {
    await ctx.as(c).post('/api/conversations', { kind: 'dm', username: 'dm_d' });
    const hits = (await ctx.as(c).get('/api/search/messages?q=check')).body.hits;
    expect(hits).toEqual([]);
    const hitsA = (await ctx.as(a).get('/api/search/messages?q=check')).body.hits;
    expect(hitsA[0].message.body).toContain('check');
  });
  it('search treats % and _ as literal text', async () => {
    ctx.clock.advance(61_000);
    await ctx.as(a).post(`/api/conversations/${groupId}/messages`, { body: 'sniped moon_shot early' });
    ctx.clock.advance(61_000);
    await ctx.as(a).post(`/api/conversations/${groupId}/messages`, { body: 'sniped moonXshot decoy' });
    const hits = (await ctx.as(a).get(`/api/search/messages?q=${encodeURIComponent('moon_shot')}`)).body.hits;
    expect(hits.map((h: any) => h.message.body)).toEqual(['sniped moon_shot early']);
    expect((await ctx.as(a).get(`/api/search/messages?q=${encodeURIComponent('%%')}`)).body.hits).toEqual([]);
  });
});
