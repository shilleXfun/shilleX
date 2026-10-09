import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io as ioc, type Socket } from 'socket.io-client';
import { makeTestApp, type TestCtx, type TestUser } from './helpers.ts';
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
