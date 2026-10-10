import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestApp, type TestCtx, type TestUser } from './helpers.ts';
import { tokenMentions, notifications } from '../src/db/schema.ts';

const MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
let ctx: TestCtx; let mod: TestUser; let member: TestUser; let fresh: TestUser; let outsider: TestUser;
let pubChannel: string; let privChannel: string;

beforeAll(async () => {
  ctx = await makeTestApp();
  mod = await ctx.createUser('mod_mia'); member = await ctx.createUser('member_max'); outsider = await ctx.createUser('outsider_ola');
  fresh = await ctx.createUser('fresh_fred', { createdAt: new Date('2026-10-09T11:00:00Z') });
  await ctx.as(mod).post('/api/communities', { name: 'Trench', slug: 'trench', visibility: 'public' });
  await ctx.as(mod).post('/api/communities', { name: 'Vault', slug: 'vault', visibility: 'private' });
  for (const u of [member, fresh]) await ctx.as(u).post('/api/communities/trench/join');
  pubChannel = (await ctx.as(mod).get('/api/communities/trench')).body.community.channels[0].id;
  privChannel = (await ctx.as(mod).get('/api/communities/vault')).body.community.channels[0].id;
});
afterAll(() => ctx.close());
beforeEach(() => { ctx.bus.clear(); ctx.clock.advance(61_000); });

describe('channel messages', () => {
  it('members post; message is broadcast and public mentions recorded', async () => {
    const r = await ctx.as(member).post(`/api/channels/${pubChannel}/messages`, { body: `aping ${MINT}`, nonce: 'n1' });
    expect(r.status).toBe(201);
    expect(r.body.message).toMatchObject({ body: `aping ${MINT}`, mints: [MINT], nonce: 'n1', status: 'visible', scope: { type: 'channel', id: pubChannel } });
    expect(ctx.bus.find('message:new').map((e) => e.target)).toContain(`channel:${pubChannel}`);
    expect(ctx.bus.find('channel:activity').map((e) => e.target)).toEqual(expect.arrayContaining([expect.stringMatching(/^community:/)]));
    const m = await ctx.db.select().from(tokenMentions).where(eq(tokenMentions.sourceId, r.body.message.id));
    expect(m[0]).toMatchObject({ isPublic: true, channelId: pubChannel });
  });
  it('announces public mentions to the token room, never private ones', async () => {
    await ctx.as(member).post(`/api/channels/${pubChannel}/messages`, { body: `live heat ${MINT}` });
    expect(ctx.bus.find('token:mention')).toEqual([expect.objectContaining({ target: `token:${MINT}`, payload: { mint: MINT, sourceType: 'message' } })]);
    ctx.bus.clear(); ctx.clock.advance(61_000);
    await ctx.as(mod).post(`/api/channels/${privChannel}/messages`, { body: `quiet heat ${MINT}` });
    expect(ctx.bus.find('token:mention')).toEqual([]);
    ctx.bus.clear();
    await ctx.as(member).post('/api/posts', { body: `public post heat ${MINT}` });
    expect(ctx.bus.find('token:mention').map((e) => e.payload)).toEqual([{ mint: MINT, sourceType: 'post' }]);
  });
  it('non-members can read public channels but not post', async () => {
    expect((await ctx.as(outsider).get(`/api/channels/${pubChannel}/messages`)).status).toBe(200);
    expect((await ctx.as(outsider).post(`/api/channels/${pubChannel}/messages`, { body: 'hi' })).body.code).toBe('JOIN_TO_POST');
    expect((await ctx.as(outsider).get(`/api/channels/${privChannel}/messages`)).status).toBe(403);
  });
  it('private channel mentions are never public', async () => {
    const r = await ctx.as(mod).post(`/api/channels/${privChannel}/messages`, { body: `secret ${MINT}` });
    const m = await ctx.db.select().from(tokenMentions).where(eq(tokenMentions.sourceId, r.body.message.id));
    expect(m[0]!.isPublic).toBe(false);
  });
  it('reply previews shorten addresses before cutting, so one is never sliced in half', async () => {
    const long = (await ctx.as(member).post(`/api/channels/${pubChannel}/messages`, { body: `${'a'.repeat(100)} ${MINT}` })).body.message;
    ctx.clock.advance(61_000);
    const r = await ctx.as(mod).post(`/api/channels/${pubChannel}/messages`, { body: 'which one', replyToId: long.id });
    expect(r.body.message.replyTo.snippet).toBe(`${'a'.repeat(100)} DezX…B263`);
  });
  it('replies must target the same scope and show a preview', async () => {
    const a = (await ctx.as(member).post(`/api/channels/${pubChannel}/messages`, { body: 'original take' })).body.message;
    ctx.clock.advance(61_000);
    const b = await ctx.as(mod).post(`/api/channels/${pubChannel}/messages`, { body: 'agree', replyToId: a.id });
    expect(b.body.message.replyTo).toMatchObject({ id: a.id, snippet: 'original take', author: { username: 'member_max' } });
    const priv = (await ctx.as(mod).post(`/api/channels/${privChannel}/messages`, { body: 'priv msg' })).body.message;
    expect((await ctx.as(member).post(`/api/channels/${pubChannel}/messages`, { body: 'x', replyToId: priv.id })).status).toBe(400);
  });
  it('pagination returns oldest→newest with a before cursor', async () => {
    for (let i = 0; i < 5; i++) { ctx.clock.advance(61_000); await ctx.as(mod).post(`/api/channels/${pubChannel}/messages`, { body: `page msg ${i}` }); }
    const p1 = (await ctx.as(member).get(`/api/channels/${pubChannel}/messages?limit=3`)).body;
    expect(p1.items.map((m: any) => m.body)).toEqual(['page msg 2', 'page msg 3', 'page msg 4']);
    const p2 = (await ctx.as(member).get(`/api/channels/${pubChannel}/messages?limit=3&before=${p1.nextCursor}`)).body;
    expect(p2.items.at(-1).body).toBe('page msg 1');
    const after = (await ctx.as(member).get(`/api/channels/${pubChannel}/messages?after=${p1.items[0].id}`)).body;
    expect(after.items.map((m: any) => m.body)).toEqual(['page msg 3', 'page msg 4']);
  });
  it('@mentions in channels notify readable members only', async () => {
    await ctx.as(member).post(`/api/channels/${pubChannel}/messages`, { body: 'ping @mod_mia' });
    const n = await ctx.db.select().from(notifications).where(eq(notifications.userId, mod.id));
    expect(n.some((x) => x.type === 'mention' && (x.data as any).href?.includes('/c/trench/'))).toBe(true);
  });
});

describe('spam controls', () => {
  it('slow mode blocks non-mods and reports retry-after; mods are exempt', async () => {
    await ctx.as(mod).patch(`/api/channels/${pubChannel}`, { slowModeSeconds: 30 });
    expect((await ctx.as(member).post(`/api/channels/${pubChannel}/messages`, { body: 'first slow' })).status).toBe(201);
    ctx.clock.advance(10_000);
    const r = await ctx.as(member).post(`/api/channels/${pubChannel}/messages`, { body: 'second slow' });
    expect(r.status).toBe(429);
    expect(r.body).toMatchObject({ code: 'SLOW_MODE', details: { retryAfterSec: 20 } });
    expect((await ctx.as(mod).post(`/api/channels/${pubChannel}/messages`, { body: 'mod a' })).status).toBe(201);
    expect((await ctx.as(mod).post(`/api/channels/${pubChannel}/messages`, { body: 'mod b' })).status).toBe(201);
    await ctx.as(mod).patch(`/api/channels/${pubChannel}`, { slowModeSeconds: 0 });
  });
  it('duplicate text within 60s is rejected', async () => {
    expect((await ctx.as(member).post(`/api/channels/${pubChannel}/messages`, { body: 'this is the play' })).status).toBe(201);
    ctx.clock.advance(1000);
    expect((await ctx.as(member).post(`/api/channels/${pubChannel}/messages`, { body: 'THIS is the  play' })).body.code).toBe('DUPLICATE');
  });
  it('rate limit: 10 messages per 10s', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await ctx.as(member).post(`/api/channels/${pubChannel}/messages`, { body: `burst number ${i}` })).status);
    expect(codes.slice(0, 10).every((c) => c === 201)).toBe(true);
    expect(codes[10]).toBe(429);
  });
  it('new accounts are capped at 2 links/mentions', async () => {
    const r = await ctx.as(fresh).post(`/api/channels/${pubChannel}/messages`, { body: `${MINT} https://a.io https://b.io` });
    expect(r.body.code).toBe('TOO_MANY_LINKS');
    expect((await ctx.as(fresh).post(`/api/channels/${pubChannel}/messages`, { body: `${MINT} https://a.io` })).status).toBe(201);
  });
  it('held posts are visible only to author and mods until approved', async () => {
    await ctx.as(mod).patch(`/api/channels/${pubChannel}`, { holdNewMemberPosts: true });
    const newbie = await ctx.createUser('newbie_ned');
    await ctx.as(newbie).post('/api/communities/trench/join');
    const r = await ctx.as(newbie).post(`/api/channels/${pubChannel}/messages`, { body: `held ${MINT}` });
    expect(r.body.message.status).toBe('held');
    expect(ctx.bus.find('message:new').map((e) => e.target).sort()).toEqual([`user:${mod.id}`, `user:${newbie.id}`].sort());
    expect(await ctx.db.select().from(tokenMentions).where(eq(tokenMentions.sourceId, r.body.message.id))).toHaveLength(0);
    const seenByMember = (await ctx.as(member).get(`/api/channels/${pubChannel}/messages?limit=100`)).body.items.map((m: any) => m.id);
    expect(seenByMember).not.toContain(r.body.message.id);
    expect((await ctx.as(member).post(`/api/messages/${r.body.message.id}/approve`)).status).toBe(403);
    const ok = await ctx.as(mod).post(`/api/messages/${r.body.message.id}/approve`);
    expect(ok.body.message.status).toBe('visible');
    expect(await ctx.db.select().from(tokenMentions).where(eq(tokenMentions.sourceId, r.body.message.id))).toHaveLength(1);
    await ctx.as(mod).patch(`/api/channels/${pubChannel}`, { holdNewMemberPosts: false });
  });
});

describe('message actions', () => {
  it('reactions carry userIds; deletion by author or mod tombstones and removes mentions', async () => {
    const m = (await ctx.as(member).post(`/api/channels/${pubChannel}/messages`, { body: `del me ${MINT}` })).body.message;
    const r = await ctx.as(mod).put(`/api/messages/${m.id}/reactions/${encodeURIComponent('🚀')}`);
    expect(r.body.reactions).toEqual([{ emoji: '🚀', count: 1, mine: true, userIds: [mod.id] }]);
    expect(ctx.bus.find('message:update').length).toBe(1);
    expect((await ctx.as(outsider).del(`/api/messages/${m.id}`)).status).toBe(403);
    expect((await ctx.as(mod).del(`/api/messages/${m.id}`)).status).toBe(204);
    expect(await ctx.db.select().from(tokenMentions).where(eq(tokenMentions.sourceId, m.id))).toHaveLength(0);
    const page = (await ctx.as(member).get(`/api/channels/${pubChannel}/messages?limit=100`)).body.items;
    expect(page.find((x: any) => x.id === m.id)).toMatchObject({ status: 'deleted', body: '', mints: [] });
  });
  it('read markers drive unread counts', async () => {
    ctx.clock.advance(61_000);
    const last = (await ctx.as(mod).post(`/api/channels/${pubChannel}/messages`, { body: 'unread test' })).body.message;
    const before = (await ctx.as(member).get('/api/communities/trench')).body.community.channels[0].unread;
    expect(before).toBeGreaterThan(0);
    await ctx.as(member).post(`/api/channels/${pubChannel}/read`, { messageId: last.id });
    expect((await ctx.as(member).get('/api/communities/trench')).body.community.channels[0].unread).toBe(0);
  });
});

describe('held message isolation', () => {
  let held: any; let holder: TestUser;
  beforeAll(async () => {
    await ctx.as(mod).patch(`/api/channels/${pubChannel}`, { holdNewMemberPosts: true });
    holder = await ctx.createUser('holder_hal');
    await ctx.as(holder).post('/api/communities/trench/join');
  });
  afterAll(async () => { await ctx.as(mod).patch(`/api/channels/${pubChannel}`, { holdNewMemberPosts: false }); });

  it('cannot be replied to, so its snippet never reaches the channel', async () => {
    held = (await ctx.as(holder).post(`/api/channels/${pubChannel}/messages`, { body: 'secret held text' })).body.message;
    expect(held.status).toBe('held');
    expect((await ctx.as(mod).post(`/api/channels/${pubChannel}/messages`, { body: 'replying to held', replyToId: held.id })).body.code).toBe('BAD_REPLY');
    ctx.clock.advance(61_000);
    expect((await ctx.as(holder).post(`/api/channels/${pubChannel}/messages`, { body: 'self reply', replyToId: held.id })).body.code).toBe('BAD_REPLY');
  });
  it('hydration blanks a held reply target', async () => {
    const { messages } = await import('../src/db/schema.ts');
    const { newId } = await import('../src/lib/ids.ts');
    const id = newId();
    await ctx.db.insert(messages).values({ id, channelId: pubChannel, authorId: mod.id, body: 'legacy reply', replyToId: held.id, attachments: [], status: 'visible', createdAt: ctx.clock.now() });
    const item = (await ctx.as(member).get(`/api/channels/${pubChannel}/messages?limit=100`)).body.items.find((m: any) => m.id === id);
    expect(item.replyTo).toMatchObject({ id: held.id, deleted: true, snippet: '' });
  });
  it('cannot be pinned', async () => {
    const r = await ctx.as(mod).post('/api/communities/trench/pins', { targetType: 'message', targetId: held.id });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('NOT_VISIBLE');
  });
  it('deleting a held message leaves no trace for other members', async () => {
    ctx.clock.advance(61_000);
    const h2 = (await ctx.as(holder).post(`/api/channels/${pubChannel}/messages`, { body: 'held to delete' })).body.message;
    ctx.bus.clear();
    expect((await ctx.as(holder).del(`/api/messages/${h2.id}`)).status).toBe(204);
    const targets = ctx.bus.find('message:update').map((e) => e.target);
    expect(targets).not.toContain(`channel:${pubChannel}`);
    expect(targets.every((t) => t.startsWith('user:'))).toBe(true);
    const ids = (await ctx.as(member).get(`/api/channels/${pubChannel}/messages?limit=100`)).body.items.map((m: any) => m.id);
    expect(ids).not.toContain(h2.id);
    const rows = await ctx.db.select().from((await import('../src/db/schema.ts')).messages).where(eq((await import('../src/db/schema.ts')).messages.id, h2.id));
    expect(rows).toHaveLength(0);
  });
  it('concurrent approvals publish once', async () => {
    ctx.clock.advance(61_000);
    const h3 = (await ctx.as(holder).post(`/api/channels/${pubChannel}/messages`, { body: `race ${MINT}` })).body.message;
    const rs = await Promise.all([ctx.as(mod).post(`/api/messages/${h3.id}/approve`), ctx.as(mod).post(`/api/messages/${h3.id}/approve`)]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(rs.find((r) => r.status === 400)!.body.code).toBe('NOT_HELD');
    expect(await ctx.db.select().from(tokenMentions).where(eq(tokenMentions.sourceId, h3.id))).toHaveLength(1);
  });
});

describe('send validation ordering', () => {
  it('a failed send does not burn the duplicate window', async () => {
    const bad = await ctx.as(member).post(`/api/channels/${pubChannel}/messages`, { body: 'retry after fixing reply', replyToId: 'nope' });
    expect(bad.body.code).toBe('BAD_REPLY');
    const target = (await ctx.as(mod).post(`/api/channels/${pubChannel}/messages`, { body: 'reply target' })).body.message;
    const ok = await ctx.as(member).post(`/api/channels/${pubChannel}/messages`, { body: 'retry after fixing reply', replyToId: target.id });
    expect(ok.status).toBe(201);
  });
});
