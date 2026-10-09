import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, type TestCtx, type TestUser } from './helpers.ts';
import { tokens, tokenMentions } from '../src/db/schema.ts';
import { demoMint } from '../src/seed/rng.ts';

const mints = {
  dm: demoMint('priv-dm'), group: demoMint('priv-group'), privPost: demoMint('priv-post'), privChat: demoMint('priv-chat'),
  inviteChat: demoMint('invite-chat'), held: demoMint('held'), flipped: demoMint('flipped'), deleted: demoMint('deleted'), pub: demoMint('public'),
};
let ctx: TestCtx; let insider: TestUser; let friend: TestUser; let outsider: TestUser; let watcher: TestUser; let member: TestUser;
let privChannel: string; let privCommunityId: string; let heldCh: string; let heldMessageId: string; let pubPostId: string;

/** Setup requests must succeed, otherwise later "nothing leaked" assertions could pass vacuously. */
async function ok(p: Promise<{ status: number; body: any }>, what: string) {
  const r = await p;
  if (r.status < 200 || r.status > 299) throw new Error(`setup failed (${what}): ${r.status} ${JSON.stringify(r.body)}`);
  return r;
}

beforeAll(async () => {
  ctx = await makeTestApp();
  insider = await ctx.createUser('insider'); friend = await ctx.createUser('friend_p'); outsider = await ctx.createUser('outsider_p'); watcher = await ctx.createUser('watcher_p');
  member = await ctx.createUser('member_p');
  await ctx.db.insert(tokens).values(Object.entries(mints).map(([k, mint]) => ({ mint, source: 'demo' as const, status: 'resolved' as const, symbol: k.toUpperCase().slice(0, 6) })));
  for (const m of Object.values(mints)) await ok(ctx.as(watcher).put(`/api/tokens/${m}/subscription`), 'subscribe');

  const dm = (await ok(ctx.as(insider).post('/api/conversations', { kind: 'dm', username: 'friend_p' }), 'dm')).body.conversation;
  await ok(ctx.as(insider).post(`/api/conversations/${dm.id}/messages`, { body: `dm ${mints.dm}` }), 'dm msg');
  const g = (await ok(ctx.as(insider).post('/api/conversations', { kind: 'group', name: 'g', usernames: ['friend_p'] }), 'group')).body.conversation;
  ctx.clock.advance(61_000);
  await ok(ctx.as(insider).post(`/api/conversations/${g.id}/messages`, { body: `group ${mints.group}`, attachments: [{ type: 'token', mint: mints.group }] }), 'group msg');
  // a conversation the outsider IS in, so search checks exercise real filtering rather than an empty membership set
  const od = (await ok(ctx.as(outsider).post('/api/conversations', { kind: 'dm', username: 'watcher_p' }), 'outsider dm')).body.conversation;
  await ok(ctx.as(outsider).post(`/api/conversations/${od.id}/messages`, { body: 'unrelated chatter' }), 'outsider dm msg');

  await ok(ctx.as(insider).post('/api/communities', { name: 'Priv', slug: 'p-priv', visibility: 'private' }), 'priv');
  await ok(ctx.as(insider).post('/api/communities', { name: 'Inv', slug: 'p-inv', visibility: 'invite' }), 'inv');
  await ok(ctx.as(insider).post('/api/communities', { name: 'Flip', slug: 'p-flip', visibility: 'public' }), 'flip');
  await ok(ctx.as(insider).post('/api/communities', { name: 'Held', slug: 'p-held', visibility: 'public' }), 'held');
  const priv = (await ok(ctx.as(insider).get('/api/communities/p-priv'), 'get priv')).body.community;
  privChannel = priv.channels[0].id; privCommunityId = priv.community.id;
  ctx.clock.advance(61_000);
  await ok(ctx.as(insider).post('/api/posts', { body: `priv post ${mints.privPost}`, communityId: privCommunityId }), 'priv post');
  ctx.clock.advance(61_000);
  await ok(ctx.as(insider).post(`/api/channels/${privChannel}/messages`, { body: `priv chat ${mints.privChat} @outsider_p` }), 'priv chat');
  const inv = (await ok(ctx.as(insider).get('/api/communities/p-inv'), 'get inv')).body.community.channels[0].id;
  ctx.clock.advance(61_000);
  await ok(ctx.as(insider).post(`/api/channels/${inv}/messages`, { body: `invite chat ${mints.inviteChat}` }), 'invite chat');

  const flip = (await ok(ctx.as(insider).get('/api/communities/p-flip'), 'get flip')).body.community.channels[0].id;
  ctx.clock.advance(61_000);
  await ok(ctx.as(insider).post(`/api/channels/${flip}/messages`, { body: `flip ${mints.flipped}` }), 'flip msg');
  await ok(ctx.as(insider).patch('/api/communities/p-flip', { visibility: 'private' }), 'flip private');

  heldCh = (await ok(ctx.as(insider).get('/api/communities/p-held'), 'get held')).body.community.channels[0].id;
  await ok(ctx.as(insider).patch(`/api/channels/${heldCh}`, { holdNewMemberPosts: true }), 'hold flag');
  await ok(ctx.as(friend).post('/api/communities/p-held/join'), 'friend join');
  await ok(ctx.as(member).post('/api/communities/p-held/join'), 'member join');
  ctx.clock.advance(61_000);
  const held = await ok(ctx.as(friend).post(`/api/channels/${heldCh}/messages`, { body: `held ${mints.held}` }), 'held msg');
  expect(held.body.message.status).toBe('held');
  heldMessageId = held.body.message.id;

  ctx.clock.advance(61_000);
  const del = (await ok(ctx.as(insider).post('/api/posts', { body: `soon deleted ${mints.deleted}` }), 'deleted post')).body.post;
  await ok(ctx.as(insider).del(`/api/posts/${del.id}`), 'delete post');
  ctx.clock.advance(61_000);
  await ok(ctx.as(insider).post('/api/posts', { body: `public ${mints.pub}` }), 'public post');
  ctx.clock.advance(61_000);
  pubPostId = (await ok(ctx.as(insider).post('/api/posts', { body: 'hello @outsider_p' }), 'public mention post')).body.post.id;

  // the mention ledger itself: non-public sources recorded as non-public; held/deleted not recorded at all
  const rows = await ctx.db.select().from(tokenMentions);
  const forMint = (m: string) => rows.filter((r) => r.mint === m);
  for (const k of ['dm', 'group', 'privPost', 'privChat', 'inviteChat', 'flipped'] as const) {
    expect(forMint(mints[k]).length, k).toBeGreaterThan(0);
    expect(forMint(mints[k]).every((r) => r.isPublic === false), k).toBe(true);
  }
  expect(forMint(mints.held), 'held').toEqual([]);
  expect(forMint(mints.deleted), 'deleted').toEqual([]);
  expect(forMint(mints.pub).map((r) => r.isPublic)).toEqual([true]);
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
    expect(convs).toHaveLength(2);
    for (const c of convs) expect((await ctx.as(outsider).get(`/api/conversations/${c.id}/messages`)).status).toBe(404);
    expect((await ctx.as(outsider).get(`/api/channels/${privChannel}/messages`)).status).toBe(403);
    for (const path of ['threads', 'members', 'pins']) expect((await ctx.as(outsider).get(`/api/communities/p-priv/${path}`)).status).toBe(403);
    expect((await ctx.as(outsider).get('/api/communities/p-inv')).status).toBe(404);
  });
  it('message search only returns messages from conversations the searcher is in', async () => {
    // positive controls: search works for members, including for the outsider's own conversation
    expect((await ctx.as(insider).get('/api/search/messages?q=dm')).body.hits.length).toBeGreaterThanOrEqual(1);
    expect((await ctx.as(outsider).get('/api/search/messages?q=unrelated')).body.hits.length).toBeGreaterThanOrEqual(1);
    for (const q of ['dm', 'group', 'priv', 'invite']) expect((await ctx.as(outsider).get(`/api/search/messages?q=${q}`)).body.hits, q).toEqual([]);
  });
  it('mentioning an outsider inside a private channel does not notify them', async () => {
    const n = (await ctx.as(outsider).get('/api/notifications')).body.items;
    const mentions = n.filter((x: any) => x.type === 'mention');
    // positive control: the public post mention notifies; the private channel mention does not
    expect(mentions).toHaveLength(1);
    expect(mentions[0].target.id).toBe(pubPostId);
  });
  it('outsiders’ view of a member’s communities hides private and invite-only ones', async () => {
    const list = (await ctx.as(outsider).get('/api/users/insider/communities')).body.communities.map((c: any) => c.slug);
    expect(list).toEqual(['p-held']);
  });
});

// Runs last on purpose: approval changes the state the tests above rely on.
describe('held messages stay hidden until approved', () => {
  const list = async (u: TestUser) => (await ctx.as(u).get(`/api/channels/${heldCh}/messages`)).body;
  it('only the author and moderators can see a held message', async () => {
    expect(JSON.stringify(await list(outsider)).includes(heldMessageId)).toBe(false);
    expect(JSON.stringify(await list(member)).includes(heldMessageId)).toBe(false);
    for (const u of [friend, insider]) {
      const item = (await list(u)).items.find((m: any) => m.id === heldMessageId);
      expect(item?.status, u.username).toBe('held');
    }
  });
  it('approval publishes it: visible to members, one public mention, subscribers notified', async () => {
    await ok(ctx.as(insider).post(`/api/messages/${heldMessageId}/approve`), 'approve');
    const item = (await list(member)).items.find((m: any) => m.id === heldMessageId);
    expect(item?.status).toBe('visible');
    expect((await ctx.as(outsider).get(`/api/tokens/${mints.held}`)).body.stats.mentions24h).toBe(1);
    const rows = (await ctx.db.select().from(tokenMentions)).filter((r) => r.mint === mints.held);
    expect(rows.map((r) => r.isPublic)).toEqual([true]);
    const n = (await ctx.as(watcher).get('/api/notifications?filter=calls')).body.items;
    expect(n.some((x: any) => x.type === 'token_discussion' && x.target.id === mints.held)).toBe(true);
  });
});
