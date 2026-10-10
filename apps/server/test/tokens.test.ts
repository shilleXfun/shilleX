import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { makeTestApp, type TestCtx, type TestUser } from './helpers.ts';
import { tokens, tokenMentions } from '../src/db/schema.ts';
import { TokenResolver } from '../src/tokens/resolver.ts';

const MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
let ctx: TestCtx; let a: TestUser; let b: TestUser;
beforeAll(async () => {
  ctx = await makeTestApp();
  a = await ctx.createUser('tok_a'); b = await ctx.createUser('tok_b');
  await ctx.db.insert(tokens).values({ mint: MINT, source: 'demo', status: 'resolved', name: 'Demo Bonk', symbol: 'DBONK', liquidityUsd: 1000, pairAddress: null });
  ctx.tokens.views.set(MINT, { mint: MINT, status: 'resolved', source: 'demo', name: 'Demo Bonk', symbol: 'DBONK', imageUrl: null, decimals: null, liquidityUsd: 1000, marketCapUsd: null, fdvUsd: null, pairAddress: null, dexId: null, pairCreatedAt: null, promoted: false, fetchedAt: null, error: null });
  await ctx.as(a).post('/api/communities', { name: 'Tok Pub', slug: 'tokpub', visibility: 'public' });
  const ch = (await ctx.as(a).get('/api/communities/tokpub')).body.community.channels[0].id;
  await ctx.as(a).post('/api/posts', { body: `post about ${MINT}` });
  await ctx.as(a).post(`/api/channels/${ch}/messages`, { body: `chat about ${MINT}` });
});
afterAll(() => ctx.close());

describe('token routes', () => {
  it('returns token, links (disabled for demo) and stats', async () => {
    const r = await ctx.as(b).get(`/api/tokens/${MINT}`);
    expect(r.body.token.symbol).toBe('DBONK');
    expect(r.body.links.every((l: any) => l.url === null && l.unavailableReason === 'Fictional demo token — not on-chain')).toBe(true);
    expect(r.body.stats).toMatchObject({ mentions24h: 2, posts24h: 1, chat24h: 1, subscribed: false });
  });
  it('buckets public mentions by rolling hour, oldest first, ignoring private and older ones', async () => {
    const SOL = 'So11111111111111111111111111111111111111112';
    const now = ctx.clock.now().getTime(), h = 3_600_000;
    const row = (id: string, ago: number, isPublic = true) => ({ id, mint: SOL, sourceType: 'post' as const, sourceId: id, authorId: a.id, isPublic, createdAt: new Date(now - ago) });
    await ctx.db.insert(tokenMentions).values([row('h1', 10 * 60_000), row('h2', 20 * 60_000), row('h3', 5.5 * h), row('h4', 25 * h), row('h5', 30 * 60_000, false)]);
    const { hourly, mentions24h } = (await ctx.as(b).get(`/api/tokens/${SOL}`)).body.stats;
    expect(hourly).toHaveLength(24);
    expect(hourly[23]).toBe(2);
    expect(hourly[18]).toBe(1);
    expect(hourly.reduce((x: number, y: number) => x + y, 0)).toBe(mentions24h);
  });
  it('rejects invalid addresses', async () => {
    expect((await ctx.as(b).get('/api/tokens/not-a-mint')).body.code).toBe('INVALID_ADDRESS');
    expect((await ctx.as(b).post('/api/tokens/resolve', { mints: Array(26).fill(MINT) })).status).toBe(400);
  });
  it('lists public posts and public chat mentioning the exact mint', async () => {
    const posts = (await ctx.as(b).get(`/api/tokens/${MINT}/posts`)).body.items;
    expect(posts.map((p: any) => p.body)).toEqual([`post about ${MINT}`]);
    const chat = (await ctx.as(b).get(`/api/tokens/${MINT}/chat`)).body.items;
    expect(chat[0]).toMatchObject({ message: { body: `chat about ${MINT}` }, community: { slug: 'tokpub' }, channel: { name: 'general' } });
  });
  it('subscription toggles and drives throttled notifications', async () => {
    expect((await ctx.as(b).put(`/api/tokens/${MINT}/subscription`)).body).toEqual({ subscribed: true });
    ctx.bus.clear();
    await ctx.as(a).post('/api/posts', { body: `again ${MINT}` });
    await ctx.as(a).post('/api/posts', { body: `and again ${MINT}` });
    const n = (await ctx.as(b).get('/api/notifications?filter=calls')).body.items.filter((x: any) => x.type === 'token_discussion');
    expect(n).toHaveLength(1);
    expect(n[0].text).toBe('New public discussion of $DBONK');
    expect((await ctx.as(b).del(`/api/tokens/${MINT}/subscription`)).body).toEqual({ subscribed: false });
  });
});

const M2 = '5zpyutJu9ee6jFymDGoK7F6S5Kczqtc9FomP3ueKuyA9';

describe('token privacy', () => {
  let c2: TestCtx; let au: TestUser; let sub: TestUser; let other: TestUser;
  const say = async (u: TestUser, url: string, payload: object) => {
    c2.clock.advance(61_000);
    const r = await c2.as(u).post(url, payload);
    expect(r.status).toBe(201);
    return r;
  };
  beforeAll(async () => {
    c2 = await makeTestApp();
    au = await c2.createUser('pv_a'); sub = await c2.createUser('pv_sub'); other = await c2.createUser('pv_c');
    for (const [slug, v] of [['pvpub', 'public'], ['pvpriv', 'private'], ['pvinv', 'invite']] as const) {
      expect((await c2.as(au).post('/api/communities', { name: slug, slug, visibility: v })).status).toBe(201);
    }
    expect((await c2.as(sub).put(`/api/tokens/${M2}/subscription`)).body.subscribed).toBe(true);
    const community = async (slug: string) => (await c2.as(au).get(`/api/communities/${slug}`)).body.community;
    const priv = await community('pvpriv'); const inv = await community('pvinv');
    const dm = (await c2.as(au).post('/api/conversations', { kind: 'dm', username: 'pv_sub' })).body.conversation.id;
    const grp = (await c2.as(au).post('/api/conversations', { kind: 'group', name: 'pv', usernames: ['pv_sub', 'pv_c'] })).body.conversation.id;
    await say(au, `/api/conversations/${dm}/messages`, { body: `dm ${M2}` });
    await say(au, `/api/conversations/${grp}/messages`, { body: 'token card', attachments: [{ type: 'token', mint: M2 }] });
    await say(au, '/api/posts', { body: `private community post ${M2}`, communityId: priv.community.id });
    await say(au, `/api/channels/${priv.channels[0].id}/messages`, { body: `private chan ${M2}` });
    await say(au, `/api/channels/${inv.channels[0].id}/messages`, { body: `invite chan ${M2}` });
  });
  afterAll(() => c2.close());

  const notes = async () => (await c2.as(sub).get('/api/notifications?filter=calls')).body.items.filter((x: any) => x.type === 'token_discussion');

  it('non-public mentions notify nobody and are not counted or listed', async () => {
    const rows = await c2.db.select().from(tokenMentions);
    expect(rows).toHaveLength(5); // dm, group card, private-community post, private channel, invite channel were all recorded...
    expect(rows.every((r) => r.isPublic === false)).toBe(true); // ...but none as public
    expect(await notes()).toHaveLength(0);
    expect((await c2.as(other).get(`/api/tokens/${M2}`)).body.stats).toMatchObject({ mentions24h: 0, posts24h: 0, chat24h: 0 });
    expect((await c2.as(sub).get(`/api/tokens/${M2}/posts`)).body.items).toEqual([]);
    expect((await c2.as(sub).get(`/api/tokens/${M2}/chat`)).body.items).toEqual([]);
  });
  it('one public post is counted, listed, and notifies the subscriber', async () => {
    await say(au, '/api/posts', { body: `public take ${M2}` });
    expect((await c2.as(other).get(`/api/tokens/${M2}`)).body.stats).toMatchObject({ mentions24h: 1, posts24h: 1, chat24h: 0 });
    expect((await c2.as(sub).get(`/api/tokens/${M2}/posts`)).body.items.map((p: any) => p.body)).toEqual([`public take ${M2}`]);
    expect((await c2.as(sub).get(`/api/tokens/${M2}/chat`)).body.items).toEqual([]);
    expect(await notes()).toHaveLength(1);
  });
});

describe('token route limits', () => {
  it('GET /tokens/:mint is limited to 60 per minute per user', async () => {
    const c = await makeTestApp();
    const u = await c.createUser('rl_a');
    for (let i = 0; i < 60; i++) expect((await c.as(u).get(`/api/tokens/${MINT}`)).status).toBe(200);
    const r = await c.as(u).get(`/api/tokens/${MINT}`);
    expect(r.status).toBe(429);
    expect(r.body).toMatchObject({ code: 'RATE_LIMITED', message: expect.any(String) });
    const other = await c.createUser('rl_b');
    expect((await c.as(other).get(`/api/tokens/${MINT}`)).status).toBe(200);
    await c.close();
  }, 60_000);
});

describe('post-commit failures and live lookup off', () => {
  it('a failing subscriber notification does not fail the post', async () => {
    const c = await makeTestApp();
    const u = await c.createUser('pc_a'); const s = await c.createUser('pc_b');
    await c.as(s).put(`/api/tokens/${MINT}/subscription`);
    await c.db.execute(sql`drop table notifications cascade`);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await c.as(u).post('/api/posts', { body: `still saved ${MINT}` });
    expect(r.status).toBe(201);
    expect((await c.as(u).get(`/api/posts/${r.body.post.id}`)).status).toBe(200);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    await c.close();
  });
  it('with live lookup off, thread responses report an honest error for unknown mints', async () => {
    const c = await makeTestApp();
    c.deps.tokens = new TokenResolver({ db: c.db, bus: c.bus, rpcUrl: 'https://rpc.test', live: false, fetchImpl: (() => { throw new Error('no network'); }) as unknown as typeof fetch });
    const u = await c.createUser('lo_a');
    const r = await c.as(u).post('/api/posts', { body: `unknown ${M2}` });
    expect(r.status).toBe(201);
    const t = await c.as(u).get(`/api/posts/${r.body.post.id}`);
    expect(t.body.tokens[M2]).toMatchObject({ status: 'error', error: 'Live lookup disabled' });
    await c.close();
  });
});
