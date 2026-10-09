import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, type TestCtx, type TestUser } from './helpers.ts';
import { tokens } from '../src/db/schema.ts';

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
