import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, type TestCtx, type TestUser } from './helpers.ts';
import { tokens } from '../src/db/schema.ts';

const MINT_A = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const MINT_B = 'So11111111111111111111111111111111111111112';
const MINT_P = '5zpyutJu9ee6jFymDGoK7F6S5Kczqtc9FomP3ueKuyA9';
const MINT_SECRET = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

let ctx: TestCtx; let me: TestUser; let loud: TestUser; let quiet: TestUser; let blocker: TestUser;
beforeAll(async () => {
  ctx = await makeTestApp();
  me = await ctx.createUser('disc_me'); loud = await ctx.createUser('disc_loud'); quiet = await ctx.createUser('disc_quiet'); blocker = await ctx.createUser('disc_blocker');
  await ctx.db.insert(tokens).values([
    { mint: MINT_A, source: 'demo', status: 'resolved', symbol: 'AAA' },
    { mint: MINT_B, source: 'demo', status: 'resolved', symbol: 'BBB' },
    { mint: MINT_P, source: 'demo', status: 'resolved', symbol: 'PRO', promoted: true },
    { mint: MINT_SECRET, source: 'demo', status: 'resolved', symbol: 'SEC' },
  ]);
  await ctx.as(blocker).put('/api/users/disc_me/block');
  await ctx.as(loud).post('/api/communities', { name: 'Loud', slug: 'loud', visibility: 'public' });
  await ctx.as(loud).post('/api/communities', { name: 'Hidden', slug: 'hidden', visibility: 'private' });
  const ch = (await ctx.as(loud).get('/api/communities/loud')).body.community.channels[0].id;
  const hidden = (await ctx.as(loud).get('/api/communities/hidden')).body.community.channels[0].id;
  // MINT_A: many mentions, first mentioned earlier. MINT_B: one mention, newer.
  for (let i = 0; i < 5; i++) { ctx.clock.advance(61_000); await ctx.as(loud).post(`/api/channels/${ch}/messages`, { body: `${MINT_A} call ${i}` }); }
  ctx.clock.advance(61_000); await ctx.as(quiet).post('/api/posts', { body: `new one ${MINT_B}` });
  ctx.clock.advance(61_000); await ctx.as(quiet).post('/api/posts', { body: `promo ${MINT_P}` });
  ctx.clock.advance(61_000); await ctx.as(loud).post(`/api/channels/${hidden}/messages`, { body: `secret ${MINT_SECRET}` });
  for (let i = 0; i < 3; i++) { ctx.clock.advance(61_000); await ctx.as(loud).post(`/api/channels/${hidden}/messages`, { body: `busy private ${i}` }); }
});
afterAll(() => ctx.close());

describe('discover', () => {
  it('new coins are ordered by first public mention, not mention count; private mints never appear', async () => {
    const d = (await ctx.as(me).get('/api/discover')).body;
    expect(d.newCoins.map((c: any) => c.token.symbol)).toEqual(['BBB', 'AAA']);
    expect(d.newCoins.find((c: any) => c.token.symbol === 'AAA').mentions24h).toBe(5);
    expect(JSON.stringify(d)).not.toContain(MINT_SECRET);
  });
  it('promoted tokens are only in the labeled promoted list', async () => {
    const d = (await ctx.as(me).get('/api/discover')).body;
    expect(d.promoted.map((c: any) => c.token.symbol)).toEqual(['PRO']);
    expect(d.promoted[0].promoted).toBe(true);
    expect(d.newCoins.some((c: any) => c.token.symbol === 'PRO')).toBe(false);
  });
  it('live rooms only include public communities', async () => {
    const d = (await ctx.as(me).get('/api/discover')).body;
    expect(d.liveRooms.map((r: any) => r.community.slug)).toEqual(['loud']);
    expect(d.liveRooms[0].messagesLast15m).toBe(5);
  });
  it('people exclude self, blocked-either-way and followed users', async () => {
    await ctx.as(me).put('/api/users/disc_quiet/follow');
    const people = (await ctx.as(me).get('/api/discover')).body.people.map((p: any) => p.user.username);
    expect(people).toContain('disc_loud');
    expect(people).not.toContain('disc_me');
    expect(people).not.toContain('disc_quiet');
    expect(people).not.toContain('disc_blocker');
  });
  it('sidebar is the compact version and reports simulator state', async () => {
    const s = (await ctx.as(me).get('/api/sidebar')).body;
    expect(s.newCoins.length).toBeLessThanOrEqual(5);
    expect(s.promoted.token.symbol).toBe('PRO');
    expect(s.demoSimulator).toBe(false);
  });
});
