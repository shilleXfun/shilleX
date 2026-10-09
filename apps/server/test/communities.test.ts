import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestApp, type TestCtx, type TestUser } from './helpers.ts';
import { tokenMentions, notifications } from '../src/db/schema.ts';

const MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
let ctx: TestCtx; let owner: TestUser; let joiner: TestUser; let outsider: TestUser;
beforeAll(async () => {
  ctx = await makeTestApp();
  owner = await ctx.createUser('owner'); joiner = await ctx.createUser('joiner'); outsider = await ctx.createUser('outsider');
  for (const [slug, visibility] of [['pub', 'public'], ['priv', 'private'], ['inv', 'invite']] as const) {
    const r = await ctx.as(owner).post('/api/communities', { name: `C ${slug}`, slug, description: `${slug} desc`, visibility });
    expect(r.status).toBe(201);
  }
});
afterAll(() => ctx.close());

describe('communities', () => {
  it('creator is owner with a #general channel', async () => {
    const d = (await ctx.as(owner).get('/api/communities/pub')).body.community;
    expect(d.community).toMatchObject({ slug: 'pub', myRole: 'owner', memberCount: 1 });
    expect(d.channels.map((c: any) => c.name)).toEqual(['general']);
    expect(d.isMod).toBe(true);
  });
  it('rejects duplicate and malformed slugs', async () => {
    expect((await ctx.as(owner).post('/api/communities', { name: 'Dup', slug: 'pub', visibility: 'public' })).status).toBe(409);
    expect((await ctx.as(owner).post('/api/communities', { name: 'Bad', slug: 'Bad Slug!', visibility: 'public' })).status).toBe(400);
  });
  it('discover lists public and private but never invite-only', async () => {
    const slugs = (await ctx.as(outsider).get('/api/communities?filter=discover')).body.communities.map((c: any) => c.slug);
    expect(slugs).toEqual(expect.arrayContaining(['pub', 'priv']));
    expect(slugs).not.toContain('inv');
  });
  it('discover search treats LIKE wildcards literally', async () => {
    const o = await ctx.createUser('searcher');
    expect((await ctx.as(o).post('/api/communities', { name: 'snake_case club', slug: 'snake-club', visibility: 'public' })).status).toBe(201);
    expect((await ctx.as(o).post('/api/communities', { name: 'snakeXcase club', slug: 'snakex-club', visibility: 'public' })).status).toBe(201);
    const names = (await ctx.as(outsider).get('/api/communities?filter=discover&q=snake_case')).body.communities.map((c: any) => c.name);
    expect(names).toEqual(['snake_case club']);
    const pct = (await ctx.as(outsider).get(`/api/communities?filter=discover&q=${encodeURIComponent('%')}`)).body.communities;
    expect(pct).toEqual([]);
  });
  it('private detail hides content from non-members; invite-only 404s', async () => {
    const d = (await ctx.as(outsider).get('/api/communities/priv')).body.community;
    expect(d).toMatchObject({ canRead: false, channels: [], owner: null, moderators: [] });
    expect((await ctx.as(outsider).get('/api/communities/inv')).status).toBe(404);
    expect((await ctx.as(outsider).get('/api/communities/priv/threads')).status).toBe(403);
  });
  it('public join is immediate', async () => {
    expect((await ctx.as(joiner).post('/api/communities/pub/join')).body).toEqual({ status: 'active' });
    expect((await ctx.as(joiner).get('/api/communities?filter=joined')).body.communities.map((c: any) => c.slug)).toEqual(['pub']);
  });
  it('private join creates a request that a mod approves', async () => {
    expect((await ctx.as(joiner).post('/api/communities/priv/join')).body).toEqual({ status: 'pending' });
    const n = await ctx.db.select().from(notifications).where(eq(notifications.userId, owner.id));
    expect(n.some((x) => x.type === 'join_request')).toBe(true);
    const reqs = (await ctx.as(owner).get('/api/communities/priv/requests')).body.members;
    expect(reqs.map((m: any) => m.user.username)).toEqual(['joiner']);
    expect((await ctx.as(joiner).get('/api/communities/priv/requests')).status).toBe(403);
    expect((await ctx.as(owner).post(`/api/communities/priv/requests/${joiner.id}/approve`)).status).toBe(204);
    expect((await ctx.as(joiner).get('/api/communities/priv')).body.community.canRead).toBe(true);
  });
  it('invite-only requires an invite; invites expire and run out', async () => {
    expect((await ctx.as(joiner).post('/api/communities/inv/join')).body.code).toBe('INVITE_REQUIRED');
    const inv = (await ctx.as(owner).post('/api/communities/inv/invites', { maxUses: 1, expiresInHours: 1 })).body.invite;
    expect(inv.url).toMatch(new RegExp(`/invite/${inv.code}$`));
    expect((await ctx.as(joiner).get(`/api/invites/${inv.code}`)).body).toMatchObject({ valid: true, community: { slug: 'inv' } });
    expect((await ctx.as(joiner).post(`/api/invites/${inv.code}/accept`)).status).toBe(200);
    expect((await ctx.as(outsider).post(`/api/invites/${inv.code}/accept`)).body.code).toBe('INVITE_EXPIRED');
    const inv2 = (await ctx.as(owner).post('/api/communities/inv/invites', { expiresInHours: 1 })).body.invite;
    ctx.clock.advance(2 * 3600_000);
    expect((await ctx.as(outsider).post(`/api/invites/${inv2.code}/accept`)).status).toBe(410);
  });
  it('owner cannot leave; members can', async () => {
    expect((await ctx.as(owner).del('/api/communities/pub/membership')).body.code).toBe('OWNER_CANNOT_LEAVE');
    const o2 = await ctx.createUser('leaver');
    await ctx.as(o2).post('/api/communities/pub/join');
    expect((await ctx.as(o2).del('/api/communities/pub/membership')).status).toBe(204);
  });
  it('ban evicts sockets and blocks rejoin', async () => {
    const victim = await ctx.createUser('victim');
    await ctx.as(victim).post('/api/communities/pub/join');
    ctx.bus.clear();
    expect((await ctx.as(owner).post(`/api/communities/pub/members/${victim.id}/ban`)).status).toBe(204);
    expect(ctx.bus.evictions.map((e) => e.room)).toEqual(expect.arrayContaining([expect.stringMatching(/^community:/), expect.stringMatching(/^channel:/)]));
    expect((await ctx.as(victim).post('/api/communities/pub/join')).body.code).toBe('BANNED');
    expect((await ctx.as(joiner).post(`/api/communities/pub/members/${owner.id}/ban`)).status).toBe(403);
  });
  it('channel settings are mod-only and slow mode must be an allowed value', async () => {
    const ch = (await ctx.as(owner).get('/api/communities/pub')).body.community.channels[0];
    expect((await ctx.as(joiner).patch(`/api/channels/${ch.id}`, { slowModeSeconds: 30 })).status).toBe(403);
    expect((await ctx.as(owner).patch(`/api/channels/${ch.id}`, { slowModeSeconds: 7 })).status).toBe(400);
    expect((await ctx.as(owner).patch(`/api/channels/${ch.id}`, { slowModeSeconds: 30 })).body.channel.slowModeSeconds).toBe(30);
    const c2 = await ctx.as(owner).post('/api/communities/pub/channels', { name: 'alpha-calls', topic: 'calls only' });
    expect(c2.body.channel).toMatchObject({ name: 'alpha-calls', topic: 'calls only' });
  });
  it('changing visibility to private flips existing mentions to non-public', async () => {
    const p = (await ctx.as(owner).post('/api/posts', { body: `thread ${MINT}`, communityId: (await ctx.as(owner).get('/api/communities/pub')).body.community.community.id })).body.post;
    expect((await ctx.db.select().from(tokenMentions).where(eq(tokenMentions.sourceId, p.id)))[0]!.isPublic).toBe(true);
    expect((await ctx.as(owner).patch('/api/communities/pub', { visibility: 'private' })).status).toBe(200);
    expect((await ctx.db.select().from(tokenMentions).where(eq(tokenMentions.sourceId, p.id)))[0]!.isPublic).toBe(false);
    await ctx.as(owner).patch('/api/communities/pub', { visibility: 'public' });
  });
  it('threads list community posts; user communities hide non-public for others', async () => {
    const t = await ctx.as(joiner).get('/api/communities/pub/threads');
    expect(t.body.items.length).toBeGreaterThan(0);
    const mine = (await ctx.as(joiner).get('/api/users/joiner/communities')).body.communities.map((c: any) => c.slug);
    expect(mine).toEqual(expect.arrayContaining(['pub', 'priv', 'inv']));
    const theirs = (await ctx.as(outsider).get('/api/users/joiner/communities')).body.communities.map((c: any) => c.slug);
    expect(theirs).toEqual(['pub']);
  });
});
