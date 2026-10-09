import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, type TestCtx, type TestUser } from './helpers.ts';
import { eq } from 'drizzle-orm';
import { communities, communityMembers, tokens } from '../src/db/schema.ts';

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

describe('discover people exclusions and activity', () => {
  it('excludes blocker, blocked and muted users even when they are active; keeps unrelated active users', async () => {
    const blocked = await ctx.createUser('disc_blocked'); const muted = await ctx.createUser('disc_muted'); const other = await ctx.createUser('disc_other');
    for (const u of [blocker, blocked, muted, other]) { ctx.clock.advance(61_000); await ctx.as(u).post('/api/posts', { body: `hello from ${u.id}` }); }
    await ctx.as(me).put('/api/users/disc_blocked/block');
    await ctx.as(me).put('/api/users/disc_muted/mute');
    const names = (await ctx.as(me).get('/api/discover')).body.people.map((p: any) => p.user.username);
    expect(names).toContain('disc_other');
    for (const n of ['disc_blocker', 'disc_blocked', 'disc_muted', 'disc_me']) expect(names).not.toContain(n);
  });

  it('only visible messages in public communities count as activity', async () => {
    const owner = await ctx.createUser('disc_owner');
    const heldU = await ctx.createUser('disc_held'); const delU = await ctx.createUser('disc_deleted');
    const privU = await ctx.createUser('disc_priv'); const pubU = await ctx.createUser('disc_pub');
    await ctx.as(owner).post('/api/communities', { name: 'Act Pub', slug: 'actpub', visibility: 'public' });
    await ctx.as(owner).post('/api/communities', { name: 'Act Priv', slug: 'actpriv', visibility: 'private' });
    const pubCh = (await ctx.as(owner).get('/api/communities/actpub')).body.community.channels[0].id;
    const privCh = (await ctx.as(owner).get('/api/communities/actpriv')).body.community.channels[0].id;
    await ctx.as(heldU).post('/api/communities/actpub/join');
    await ctx.as(delU).post('/api/communities/actpub/join');
    await ctx.as(pubU).post('/api/communities/actpub/join');
    const privId = (await ctx.db.select().from(communities).where(eq(communities.slug, 'actpriv')))[0]!.id;
    await ctx.db.insert(communityMembers).values({ communityId: privId, userId: privU.id, role: 'member', status: 'active', joinedAt: new Date() });
    await ctx.as(owner).patch(`/api/channels/${pubCh}`, { holdNewMemberPosts: true });
    ctx.clock.advance(61_000);
    const held = await ctx.as(heldU).post(`/api/channels/${pubCh}/messages`, { body: 'held one' });
    expect(held.body.message.status).toBe('held');
    await ctx.as(owner).patch(`/api/channels/${pubCh}`, { holdNewMemberPosts: false });
    ctx.clock.advance(61_000);
    const del = (await ctx.as(delU).post(`/api/channels/${pubCh}/messages`, { body: 'to delete' })).body.message;
    expect((await ctx.as(delU).del(`/api/messages/${del.id}`)).status).toBe(204);
    ctx.clock.advance(61_000);
    const pm = await ctx.as(privU).post(`/api/channels/${privCh}/messages`, { body: 'private chatter' });
    expect(pm.status).toBe(201);
    ctx.clock.advance(61_000);
    expect((await ctx.as(pubU).post(`/api/channels/${pubCh}/messages`, { body: 'public chatter' })).status).toBe(201);
    const names = (await ctx.as(me).get('/api/discover')).body.people.map((p: any) => p.user.username);
    expect(names).toContain('disc_pub');
    for (const n of ['disc_held', 'disc_deleted', 'disc_priv']) expect(names).not.toContain(n);
  });

  it('community pool is ranked by active members before the pre-limit', async () => {
    const owner = await ctx.createUser('disc_bulk');
    const ids: string[] = [];
    for (let i = 0; i < 55; i++) {
      const r = await ctx.as(owner).post('/api/communities', { name: `Bulk ${i}`, slug: `bulk-${i}`, visibility: 'public' });
      expect(r.status).toBe(201);
      ids.push((await ctx.db.select().from(communities).where(eq(communities.slug, `bulk-${i}`)))[0]!.id);
    }
    // The last-created communities get the most members.
    const extra: any[] = [];
    for (let k = 0; k < 3; k++) {
      const big = ids[52 + k]!;
      for (let j = 0; j < 8 + k; j++) {
        const u = await ctx.createUser(`disc_bm_${k}_${j}`);
        extra.push({ communityId: big, userId: u.id, role: 'member', status: 'active', joinedAt: new Date() });
      }
    }
    await ctx.db.insert(communityMembers).values(extra);
    const slugs = (await ctx.as(me).get('/api/discover')).body.communities.map((c: any) => c.slug);
    expect(slugs.slice(0, 3)).toEqual(['bulk-54', 'bulk-53', 'bulk-52']);
    expect(slugs.length).toBeLessThanOrEqual(8);
  });
});
