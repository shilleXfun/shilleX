import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
});
