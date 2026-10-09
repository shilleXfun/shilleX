import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, type TestCtx, type TestUser } from './helpers.ts';
import { tokens } from '../src/db/schema.ts';
import { demoMint } from '../src/seed/rng.ts';

const mints = {
  dm: demoMint('priv-dm'), group: demoMint('priv-group'), privPost: demoMint('priv-post'), privChat: demoMint('priv-chat'),
  inviteChat: demoMint('invite-chat'), held: demoMint('held'), flipped: demoMint('flipped'), deleted: demoMint('deleted'), pub: demoMint('public'),
};
let ctx: TestCtx; let insider: TestUser; let friend: TestUser; let outsider: TestUser; let watcher: TestUser;
let privChannel: string; let privCommunityId: string;

beforeAll(async () => {
  ctx = await makeTestApp();
  insider = await ctx.createUser('insider'); friend = await ctx.createUser('friend_p'); outsider = await ctx.createUser('outsider_p'); watcher = await ctx.createUser('watcher_p');
  await ctx.db.insert(tokens).values(Object.entries(mints).map(([k, mint]) => ({ mint, source: 'demo' as const, status: 'resolved' as const, symbol: k.toUpperCase().slice(0, 6) })));
  for (const m of Object.values(mints)) await ctx.as(watcher).put(`/api/tokens/${m}/subscription`);

  const dm = (await ctx.as(insider).post('/api/conversations', { kind: 'dm', username: 'friend_p' })).body.conversation;
  await ctx.as(insider).post(`/api/conversations/${dm.id}/messages`, { body: `dm ${mints.dm}` });
  const g = (await ctx.as(insider).post('/api/conversations', { kind: 'group', name: 'g', usernames: ['friend_p'] })).body.conversation;
  ctx.clock.advance(61_000);
  await ctx.as(insider).post(`/api/conversations/${g.id}/messages`, { body: `group ${mints.group}`, attachments: [{ type: 'token', mint: mints.group }] });

  await ctx.as(insider).post('/api/communities', { name: 'Priv', slug: 'p-priv', visibility: 'private' });
  await ctx.as(insider).post('/api/communities', { name: 'Inv', slug: 'p-inv', visibility: 'invite' });
  await ctx.as(insider).post('/api/communities', { name: 'Flip', slug: 'p-flip', visibility: 'public' });
  await ctx.as(insider).post('/api/communities', { name: 'Held', slug: 'p-held', visibility: 'public' });
  const priv = (await ctx.as(insider).get('/api/communities/p-priv')).body.community;
  privChannel = priv.channels[0].id; privCommunityId = priv.community.id;
  ctx.clock.advance(61_000);
  await ctx.as(insider).post('/api/posts', { body: `priv post ${mints.privPost}`, communityId: privCommunityId });
  ctx.clock.advance(61_000);
  await ctx.as(insider).post(`/api/channels/${privChannel}/messages`, { body: `priv chat ${mints.privChat} @outsider_p` });
  const inv = (await ctx.as(insider).get('/api/communities/p-inv')).body.community.channels[0].id;
  ctx.clock.advance(61_000);
  await ctx.as(insider).post(`/api/channels/${inv}/messages`, { body: `invite chat ${mints.inviteChat}` });

  const flip = (await ctx.as(insider).get('/api/communities/p-flip')).body.community.channels[0].id;
  ctx.clock.advance(61_000);
  await ctx.as(insider).post(`/api/channels/${flip}/messages`, { body: `flip ${mints.flipped}` });
  await ctx.as(insider).patch('/api/communities/p-flip', { visibility: 'private' });

  const heldCh = (await ctx.as(insider).get('/api/communities/p-held')).body.community.channels[0].id;
  await ctx.as(insider).patch(`/api/channels/${heldCh}`, { holdNewMemberPosts: true });
  await ctx.as(friend).post('/api/communities/p-held/join');
  ctx.clock.advance(61_000);
  await ctx.as(friend).post(`/api/channels/${heldCh}/messages`, { body: `held ${mints.held}` });

  ctx.clock.advance(61_000);
  const del = (await ctx.as(insider).post('/api/posts', { body: `soon deleted ${mints.deleted}` })).body.post;
  await ctx.as(insider).del(`/api/posts/${del.id}`);
  ctx.clock.advance(61_000);
  await ctx.as(insider).post('/api/posts', { body: `public ${mints.pub}` });
});
afterAll(() => ctx.close());

const privateMints = () => Object.entries(mints).filter(([k]) => k !== 'pub').map(([, m]) => m);

describe('private content never reaches public surfaces', () => {
  it('token stats, posts and chat tabs show nothing for private-only mints', async () => {
    for (const m of privateMints()) {
      const t = (await ctx.as(outsider).get(`/api/tokens/${m}`)).body;
      expect(t.stats.mentions24h, m).toBe(0);
      expect((await ctx.as(outsider).get(`/api/tokens/${m}/posts`)).body.items, m).toEqual([]);
      expect((await ctx.as(outsider).get(`/api/tokens/${m}/chat`)).body.items, m).toEqual([]);
      // even insiders see nothing in the *public* discussion surfaces
      expect((await ctx.as(insider).get(`/api/tokens/${m}/chat`)).body.items, m).toEqual([]);
    }
    expect((await ctx.as(outsider).get(`/api/tokens/${mints.pub}`)).body.stats.mentions24h).toBe(1);
  });
  it('discovery and sidebar never include private-only mints', async () => {
    const d = JSON.stringify((await ctx.as(outsider).get('/api/discover')).body) + JSON.stringify((await ctx.as(outsider).get('/api/sidebar')).body);
    for (const m of privateMints()) expect(d.includes(m), m).toBe(false);
    expect(d.includes(mints.pub)).toBe(true);
  });
  it('token subscribers are not notified about private mentions', async () => {
    const n = (await ctx.as(watcher).get('/api/notifications?filter=calls')).body.items;
    // `deleted` and `flipped` were public at the moment they were posted, so notifying then was correct.
    expect(new Set(n.map((x: any) => x.target.id))).toEqual(new Set([mints.pub, mints.deleted, mints.flipped]));
  });
  it('outsiders cannot read private conversations, channels, threads, members or pins', async () => {
    const convs = (await ctx.as(insider).get('/api/conversations')).body.conversations;
    for (const c of convs) expect((await ctx.as(outsider).get(`/api/conversations/${c.id}/messages`)).status).toBe(404);
    expect((await ctx.as(outsider).get(`/api/channels/${privChannel}/messages`)).status).toBe(403);
    for (const path of ['threads', 'members', 'pins']) expect((await ctx.as(outsider).get(`/api/communities/p-priv/${path}`)).status).toBe(403);
    expect((await ctx.as(outsider).get('/api/communities/p-inv')).status).toBe(404);
    expect((await ctx.as(outsider).get('/api/search/messages?q=dm')).body.hits).toEqual([]);
  });
  it('mentioning an outsider inside a private channel does not notify them', async () => {
    const n = (await ctx.as(outsider).get('/api/notifications')).body.items;
    expect(n.filter((x: any) => x.type === 'mention')).toEqual([]);
  });
  it('outsiders’ view of a member’s communities hides private and invite-only ones', async () => {
    const list = (await ctx.as(outsider).get('/api/users/insider/communities')).body.communities.map((c: any) => c.slug);
    expect(list).toEqual(['p-held']);
  });
});
