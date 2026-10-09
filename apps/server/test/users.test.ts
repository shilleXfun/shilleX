import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, type TestCtx, type TestUser } from './helpers.ts';

const ADDR = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
let ctx: TestCtx; let a: TestUser; let b: TestUser;
beforeAll(async () => { ctx = await makeTestApp(); a = await ctx.createUser('anon_ape'); b = await ctx.createUser('based_bob'); });
afterAll(() => ctx.close());

describe('profiles and follows', () => {
  it('returns a profile with counts and flags', async () => {
    const r = await ctx.as(a).get('/api/users/BASED_BOB');
    expect(r.status).toBe(200);
    expect(r.body.profile).toMatchObject({ username: 'based_bob', followers: 0, isSelf: false, isFollowing: false, wallet: null });
    expect((await ctx.as(a).get('/api/users/nobody_here')).status).toBe(404);
  });
  it('follow / unfollow updates counts and notifies', async () => {
    const f = await ctx.as(a).put('/api/users/based_bob/follow');
    expect(f.body).toEqual({ following: true, followers: 1 });
    expect(ctx.bus.find('notification:new').some((e) => e.target === `user:${b.id}`)).toBe(true);
    expect((await ctx.as(b).get('/api/users/anon_ape')).body.profile.followsYou).toBe(true);
    expect((await ctx.as(a).del('/api/users/based_bob/follow')).body).toEqual({ following: false, followers: 0 });
    expect((await ctx.as(a).put('/api/users/anon_ape/follow')).status).toBe(400);
  });
  it('lists posts and replies tabs', async () => {
    const p = (await ctx.as(b).post('/api/posts', { body: 'top' })).body.post;
    await ctx.as(b).post('/api/posts', { body: 'a reply', parentId: p.id });
    expect((await ctx.as(a).get('/api/users/based_bob/posts?tab=posts')).body.items.map((x: any) => x.body)).toEqual(['top']);
    expect((await ctx.as(a).get('/api/users/based_bob/posts?tab=replies')).body.items.map((x: any) => x.body)).toEqual(['a reply']);
  });
  it('searches users', async () => {
    const r = await ctx.as(a).get('/api/users?q=bob');
    expect(r.body.users.map((u: any) => u.username)).toEqual(['based_bob']);
  });
  it('matches underscores literally and does not treat % or _ as wildcards', async () => {
    expect((await ctx.as(a).get('/api/users?q=based_bob')).body.users.map((u: any) => u.username)).toEqual(['based_bob']);
    expect((await ctx.as(a).get('/api/users?q=' + encodeURIComponent('%'))).body.users).toEqual([]);
    const us = (await ctx.as(a).get('/api/users?q=_')).body.users;
    for (const u of us) expect(`${u.username}${u.displayName}`).toContain('_');
    expect(us.map((u: any) => u.username)).toEqual(['based_bob']);
  });
});

describe('settings', () => {
  it('updates profile with validated links', async () => {
    const ok = await ctx.as(a).patch('/api/me/profile', { displayName: 'Anon Ape', bio: 'trenches', links: [{ label: 'X', url: 'https://x.com/anon' }] });
    expect(ok.status).toBe(200);
    expect(ok.body.profile.bio).toBe('trenches');
    const bad = await ctx.as(a).patch('/api/me/profile', { links: [{ label: 'x', url: 'javascript:alert(1)' }] });
    expect(bad.status).toBe(400);
  });
  it('wallet is hidden unless explicitly displayed', async () => {
    await ctx.as(a).put('/api/me/wallet', { address: ADDR, displayWallet: false, displayHoldings: false });
    expect((await ctx.as(b).get('/api/users/anon_ape')).body.profile.wallet).toBeNull();
    await ctx.as(a).put('/api/me/wallet', { address: ADDR, displayWallet: true, displayHoldings: true });
    expect((await ctx.as(b).get('/api/users/anon_ape')).body.profile.wallet).toEqual({ address: ADDR, showHoldings: true, verified: false });
    expect((await ctx.as(a).put('/api/me/wallet', { address: 'not-an-address', displayWallet: true, displayHoldings: false })).status).toBe(400);
    await ctx.as(a).del('/api/me/wallet');
    expect((await ctx.as(b).get('/api/users/anon_ape')).body.profile.wallet).toBeNull();
  });
  it('notification prefs disable delivery', async () => {
    const s = await ctx.as(b).put('/api/me/notification-prefs', { prefs: [{ type: 'follow', enabled: false }] });
    expect(s.body.notificationPrefs.find((p: any) => p.type === 'follow').enabled).toBe(false);
    ctx.bus.clear();
    await ctx.as(a).put('/api/users/based_bob/follow');
    expect(ctx.bus.find('notification:new')).toHaveLength(0);
  });
});
