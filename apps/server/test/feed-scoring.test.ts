import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, type TestCtx, type TestUser } from './helpers.ts';

let ctx: TestCtx; let me: TestUser;
beforeAll(async () => { ctx = await makeTestApp(); me = await ctx.createUser('fs_me'); });
afterAll(() => ctx.close());

describe('discover feed scoring counts replies, quotes and reposts', () => {
  it('ranks a post with replies above an idle one, and one with quotes/reposts above an idle one', async () => {
    const authors = await Promise.all(['a', 'b', 'c', 'd'].map((n) => ctx.createUser(`fs_${n}`)));
    const fan = await Promise.all([1, 2, 3].map((n) => ctx.createUser(`fs_fan${n}`)));
    const mk = async (u: TestUser, body: string) => { ctx.clock.advance(61_000); return (await ctx.as(u).post('/api/posts', { body })).body.post; };
    // Oldest first, so a plain recency order would put the engaged posts LAST.
    const replied = await mk(authors[0]!, 'replied');
    const quoted = await mk(authors[1]!, 'quoted');
    const idle1 = await mk(authors[2]!, 'idle one');
    const idle2 = await mk(authors[3]!, 'idle two');
    for (const f of fan) { ctx.clock.advance(61_000); expect((await ctx.as(f).post('/api/posts', { body: 'reply', parentId: replied.id })).status).toBe(201); }
    ctx.clock.advance(61_000);
    expect((await ctx.as(fan[0]!).post(`/api/posts/${quoted.id}/repost`)).status).toBeLessThan(300);
    ctx.clock.advance(61_000);
    expect((await ctx.as(fan[1]!).post('/api/posts', { body: 'quote', quoteOfId: quoted.id })).status).toBe(201);
    const ids = (await ctx.as(me).get('/api/feed?tab=discover&limit=20')).body.items.map((p: any) => p.id);
    expect(ids.indexOf(replied.id)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(replied.id)).toBeLessThan(ids.indexOf(idle1.id));
    expect(ids.indexOf(quoted.id)).toBeLessThan(ids.indexOf(idle2.id));
  });
});
