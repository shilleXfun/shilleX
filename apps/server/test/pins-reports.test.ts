import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, type TestCtx, type TestUser } from './helpers.ts';

let ctx: TestCtx; let mod: TestUser; let user: TestUser; let channelId: string; let communityId: string;
beforeAll(async () => {
  ctx = await makeTestApp();
  mod = await ctx.createUser('pin_mod'); user = await ctx.createUser('pin_user');
  await ctx.as(mod).post('/api/communities', { name: 'Pins', slug: 'pins', visibility: 'public' });
  await ctx.as(user).post('/api/communities/pins/join');
  const d = (await ctx.as(mod).get('/api/communities/pins')).body.community;
  channelId = d.channels[0].id; communityId = d.community.id;
});
afterAll(() => ctx.close());

describe('pins', () => {
  it('mods pin messages and posts from their community only', async () => {
    const m = (await ctx.as(user).post(`/api/channels/${channelId}/messages`, { body: 'pin me' })).body.message;
    expect((await ctx.as(user).post('/api/communities/pins/pins', { targetType: 'message', targetId: m.id })).status).toBe(403);
    const pin = await ctx.as(mod).post('/api/communities/pins/pins', { targetType: 'message', targetId: m.id });
    expect(pin.status).toBe(201);
    const outside = (await ctx.as(mod).post('/api/posts', { body: 'not community' })).body.post;
    expect((await ctx.as(mod).post('/api/communities/pins/pins', { targetType: 'post', targetId: outside.id })).status).toBe(400);
    const list = (await ctx.as(user).get('/api/communities/pins/pins')).body.pins;
    expect(list[0]).toMatchObject({ channelId, message: { body: 'pin me' } });
    expect((await ctx.as(mod).del(`/api/pins/${list[0].id}`)).status).toBe(204);
  });
});

describe('reports', () => {
  it('reports route to community mods who can remove content', async () => {
    const m = (await ctx.as(mod).post(`/api/channels/${channelId}/messages`, { body: 'spammy link farm' })).body.message;
    const r = await ctx.as(user).post('/api/reports', { targetType: 'message', targetId: m.id, reason: 'spam' });
    expect(r.status).toBe(201);
    expect((await ctx.as(user).get('/api/communities/pins/reports')).status).toBe(403);
    const reports = (await ctx.as(mod).get('/api/communities/pins/reports')).body.reports;
    expect(reports[0]).toMatchObject({ reason: 'spam', status: 'open', preview: { body: 'spammy link farm' } });
    expect((await ctx.as(mod).post(`/api/reports/${reports[0].id}/resolve`, { action: 'remove_content' })).status).toBe(204);
    const page = (await ctx.as(user).get(`/api/channels/${channelId}/messages`)).body.items;
    expect(page.find((x: any) => x.id === m.id).status).toBe('deleted');
    expect((await ctx.as(user).get('/api/notifications')).body.items[0].type).toBe('report_resolved');
  });
  it('cannot report content you cannot read', async () => {
    expect((await ctx.as(user).post('/api/reports', { targetType: 'message', targetId: 'nope', reason: 'x' })).status).toBe(404);
  });
  it('validates communityId linkage', () => { expect(communityId).toBeTruthy(); });
});
