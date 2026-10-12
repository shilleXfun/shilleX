import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io as ioc, type Socket } from 'socket.io-client';
import { makeTestApp, type TestCtx, type TestUser } from './helpers.ts';
import { eq } from 'drizzle-orm';
import { sessions } from '../src/db/schema.ts';
import { SocketBus, attachRealtime } from '../src/realtime/socket.ts';

let ctx: TestCtx; let url: string; let mod: TestUser; let member: TestUser; let outsider: TestUser; let channelId: string;
const sockets: Socket[] = [];
function connect(u: TestUser | null): Promise<Socket> {
  const s = ioc(url, { transports: ['websocket'], extraHeaders: u ? { cookie: u.cookie } : {}, reconnection: false, forceNew: true });
  sockets.push(s);
  return new Promise((res, rej) => { s.on('connect', () => res(s)); s.on('connect_error', rej); });
}
const sub = (s: Socket, scope: string, id: string) => new Promise<any>((res) => s.emit('subscribe', { scope, id }, res));
const next = (s: Socket, ev: string, ms = 2000) => new Promise<any>((res, rej) => { const t = setTimeout(() => rej(new Error(`timeout ${ev}`)), ms); s.once(ev, (p: any) => { clearTimeout(t); res(p); }); });
const none = (s: Socket, ev: string, ms = 400) => new Promise<void>((res, rej) => { const h = () => rej(new Error(`unexpected ${ev}`)); s.once(ev, h); setTimeout(() => { s.off(ev, h); res(); }, ms); });

beforeAll(async () => {
  const bus = new SocketBus();
  ctx = await makeTestApp({ bus });
  attachRealtime(ctx.app, bus);
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = ctx.app.server.address() as { port: number };
  url = `http://127.0.0.1:${addr.port}`;
  mod = await ctx.createUser('rt_mod'); member = await ctx.createUser('rt_member'); outsider = await ctx.createUser('rt_out');
  await ctx.as(mod).post('/api/communities', { name: 'RT Pub', slug: 'rtc', visibility: 'public' });
  await ctx.as(mod).post('/api/communities', { name: 'RT Priv', slug: 'rtpriv', visibility: 'private' });
  await ctx.as(member).post('/api/communities/rtc/join');
  channelId = (await ctx.as(mod).get('/api/communities/rtc')).body.community.channels[0].id;
});
afterAll(async () => { sockets.forEach((s) => s.close()); await ctx.close(); });

describe('realtime', () => {
  it('refuses unauthenticated sockets', async () => {
    await expect(connect(null)).rejects.toThrow(/UNAUTHORIZED/);
  });
  it('authorizes subscriptions', async () => {
    const s = await connect(outsider);
    expect(await sub(s, 'channel', channelId)).toEqual({ ok: true }); // public channel is readable
    const privCh = (await ctx.as(mod).get('/api/communities/rtpriv')).body.community.channels[0].id;
    expect(await sub(s, 'channel', privCh)).toEqual({ ok: false, code: 'MEMBERS_ONLY' });
    expect(await sub(s, 'conversation', 'nope')).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(await sub(s, 'token', 'bad')).toEqual({ ok: false, code: 'INVALID_ADDRESS' });
  });
  it('delivers channel messages and typing to subscribers', async () => {
    const a = await connect(member); const b = await connect(mod);
    await sub(a, 'channel', channelId); await sub(b, 'channel', channelId);
    const got = next(a, 'message:new');
    await ctx.as(mod).post(`/api/channels/${channelId}/messages`, { body: 'live!' });
    expect((await got).message.body).toBe('live!');
    const typing = next(a, 'typing');
    b.emit('typing', { scope: 'channel', id: channelId });
    expect((await typing).user.username).toBe('rt_mod');
  });
  it('delivers DMs to user rooms without subscription', async () => {
    const s = await connect(member);
    const conv = (await ctx.as(mod).post('/api/conversations', { kind: 'dm', username: 'rt_member' })).body.conversation;
    const got = next(s, 'message:new');
    ctx.clock.advance(61_000);
    await ctx.as(mod).post(`/api/conversations/${conv.id}/messages`, { body: 'psst' });
    expect((await got).message.body).toBe('psst');
  });
  it('eviction: a banned member stops receiving channel events immediately (Review Focus #4)', async () => {
    const victim = await ctx.createUser('rt_victim');
    await ctx.as(victim).post('/api/communities/rtc/join');
    const s = await connect(victim);
    expect(await sub(s, 'channel', channelId)).toEqual({ ok: true });
    await ctx.as(mod).post(`/api/communities/rtc/members/${victim.id}/ban`);
    ctx.clock.advance(61_000);
    const silent = none(s, 'message:new');
    await ctx.as(mod).post(`/api/channels/${channelId}/messages`, { body: 'after ban' });
    await silent;
  });
  it('presence updates reach community rooms', async () => {
    const watcher = await connect(mod);
    await sub(watcher, 'community', (await ctx.as(mod).get('/api/communities/rtc')).body.community.community.id);
    const p = next(watcher, 'presence');
    const late = await ctx.createUser('rt_late');
    await ctx.as(late).post('/api/communities/rtc/join');
    await connect(late);
    expect(await p).toEqual({ userId: late.id, online: true });
  });
});

describe('realtime: visibility downgrade', () => {
  it('outsiders who subscribed while public stop receiving messages; members still do', async () => {
    await ctx.as(mod).post('/api/communities', { name: 'RT Down', slug: 'rtdown', visibility: 'public' });
    const dMember = await ctx.createUser('rt_dmember');
    await ctx.as(dMember).post('/api/communities/rtdown/join');
    const chId = (await ctx.as(mod).get('/api/communities/rtdown')).body.community.channels[0].id;
    const out = await connect(outsider); const mem = await connect(dMember);
    expect(await sub(out, 'channel', chId)).toEqual({ ok: true });
    expect(await sub(mem, 'channel', chId)).toEqual({ ok: true });
    expect((await ctx.as(mod).patch('/api/communities/rtdown', { visibility: 'private' })).status).toBe(200);
    ctx.clock.advance(61_000);
    const silent = none(out, 'message:new');
    const got = next(mem, 'message:new');
    await ctx.as(mod).post(`/api/channels/${chId}/messages`, { body: 'members only now' });
    expect((await got).message.body).toBe('members only now');
    await silent;
  });
});

describe('realtime: hardening', () => {
  it('survives malformed payloads and still serves valid subscribes', async () => {
    const s = await connect(outsider);
    const raw = s as any;
    raw.emit('unsubscribe'); raw.emit('unsubscribe', null); raw.emit('unsubscribe', 42); raw.emit('unsubscribe', { scope: {}, id: [] });
    raw.emit('subscribe'); raw.emit('subscribe', null); raw.emit('subscribe', { scope: 'x', id: 1 });
    raw.emit('typing'); raw.emit('typing', 7);
    expect(await new Promise<any>((res) => raw.emit('subscribe', null, res))).toEqual({ ok: false, code: 'BAD_REQUEST' });
    expect(await new Promise<any>((res) => raw.emit('subscribe', { scope: 'channel', id: 'x'.repeat(65) }, res))).toEqual({ ok: false, code: 'BAD_REQUEST' });
    expect(await sub(s, 'channel', channelId)).toEqual({ ok: true });
    const s2 = await connect(outsider);
    expect(await sub(s2, 'channel', channelId)).toEqual({ ok: true });
  });
  it('puts every socket in the public agents:live room, with no subscription needed', async () => {
    const a = await connect(member); const b = await connect(outsider);
    const pulse = { kind: 'buy', agentId: 'a1', mint: 'M1', sol: 0.02, at: '2026-10-11T12:00:00.000Z' };
    const got = Promise.all([next(a, 'agents:pulse'), next(b, 'agents:pulse')]);
    // The room is joined right after connect, so keep sending until both sockets have heard it.
    const timer = setInterval(() => ctx.deps.bus.toRoom('agents:live', 'agents:pulse', pulse), 25);
    try { expect(await got).toEqual([pulse, pulse]); } finally { clearInterval(timer); }
  });
  it('acks a subscribe emitted immediately on connect', async () => {
    for (let i = 0; i < 5; i++) {
      const s = ioc(url, { transports: ['websocket'], extraHeaders: { cookie: outsider.cookie }, reconnection: false, forceNew: true });
      sockets.push(s);
      const ack = await new Promise<any>((res, rej) => { s.on('connect', () => s.emit('subscribe', { scope: 'channel', id: channelId }, res)); s.on('connect_error', rej); setTimeout(() => rej(new Error('no ack')), 2000); });
      expect(ack).toEqual({ ok: true });
    }
  });
  it('caps rooms per socket', async () => {
    const s = await connect(outsider);
    const bs58 = (await import('bs58')).default;
    const results: any[] = [];
    for (let i = 0; i < 205; i++) {
      const b = Buffer.alloc(32); b.writeUInt32BE(i + 1, 0); b.writeUInt8(7, 31);
      results.push(await sub(s, 'token', bs58.encode(b)));
    }
    expect(results.filter((r) => r.ok).length).toBe(200);
    expect(results.at(-1)).toEqual({ ok: false, code: 'TOO_MANY_ROOMS' });
  });
  it('logout disconnects the socket and stops delivery', async () => {
    const u = await ctx.createUser('rt_logout');
    await ctx.as(u).post('/api/communities/rtc/join');
    const s = await connect(u);
    expect(await sub(s, 'channel', channelId)).toEqual({ ok: true });
    const gone = new Promise<void>((res) => s.once('disconnect', () => res()));
    expect((await ctx.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: u.cookie } })).statusCode).toBe(204);
    await gone;
    expect(s.connected).toBe(false);
  });
  it('a socket whose session was deleted gets UNAUTHORIZED on next subscribe', async () => {
    const u = await ctx.createUser('rt_nosess');
    const s = await connect(u);
    await ctx.db.delete(sessions).where(eq(sessions.userId, u.id));
    const gone = new Promise<void>((res) => s.once('disconnect', () => res()));
    expect(await sub(s, 'channel', channelId)).toEqual({ ok: false, code: 'UNAUTHORIZED' });
    await gone;
  });
  it('presence reaches fellow members but not public-room outsiders or blockers', async () => {
    const rc = await ctx.as(mod).get('/api/communities/rtc');
    const cid = rc.body.community.community.id;
    const fellow = await ctx.createUser('rt_fellow'); const out = await ctx.createUser('rt_outsider2');
    await ctx.as(fellow).post('/api/communities/rtc/join');
    const sf = await connect(fellow); const so = await connect(out);
    await sub(so, 'community', cid);
    const newbie = await ctx.createUser('rt_newbie');
    await ctx.as(newbie).post('/api/communities/rtc/join');
    const gotF = next(sf, 'presence'); const silent = none(so, 'presence', 600);
    await connect(newbie);
    expect(await gotF).toEqual({ userId: newbie.id, online: true });
    await silent;

    // conversation peer who blocked the user
    const a = await ctx.createUser('rt_pa'); const b = await ctx.createUser('rt_pb');
    await ctx.as(a).post('/api/conversations', { kind: 'dm', username: 'rt_pb' });
    expect((await ctx.as(b).put('/api/users/rt_pa/block')).status).toBeLessThan(300);
    const sb = await connect(b);
    const silentB = none(sb, 'presence', 600);
    await connect(a);
    await silentB;
  });
});
