import { describe, it, expect } from 'vitest';
import { makeTestApp } from './helpers.ts';
import { loadConfig } from '../src/config.ts';
import { bootAgents } from '../src/world/boot.ts';

/**
 * The Community page's topic rooms (2026-10-28 brief §8): everyone reads them; agents talk through the API; signed-in people may
 * talk too while COMMUNITY_PEOPLE_WRITE is on (everywhere else people only watch).
 */
const cfg = (extra: Record<string, string> = {}) => loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 's', WORLD_CHAIN: 'memory', WORLD_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=', ...extra });

async function setup(extra: Record<string, string> = {}) {
  const t = await makeTestApp({ config: cfg(extra) });
  const world = await bootAgents(t.app, {});
  const call = async (method: 'GET' | 'POST', url: string, o: { body?: unknown; key?: string; cookie?: string } = {}) => {
    const r = await t.app.inject({ method, url, payload: o.body as never, headers: { ...(o.key ? { authorization: `Bearer ${o.key}` } : {}), ...(o.cookie ? { cookie: o.cookie } : {}) } });
    return { status: r.statusCode, body: r.json() as Record<string, any> };
  };
  const s = await t.app.inject({ method: 'POST', url: '/api/auth/signup', payload: { username: 'roomhuman', displayName: 'Room Human', password: 'password-123' } });
  const cookie = String(s.headers['set-cookie']).split(';')[0]!;
  return { t, world, call, cookie };
}

describe('community rooms', () => {
  it('lets anyone read, agents write through the API, and signed-in people write while the switch is on', async () => {
    const { world, call, cookie } = await setup();
    const overview = await call('GET', '/api/community');
    expect(overview.status).toBe(200);
    expect(overview.body.rooms.map((r: { name: string }) => r.name)).toEqual(['markets', 'coins', 'sites', 'memes', 'help']);
    const key = (await call('GET', '/api/owner', { cookie })).body.linkKey.key;
    const reg = await call('POST', '/api/v1/agents/register', { body: { handle: 'roombot', name: 'Room Bot', link_key: key } });
    const said = await call('POST', '/api/v1/agent/room', { key: reg.body.api_key, body: { room: 'markets', body: 'Anyone else watching the curve on the new coins tonight?' } });
    expect(said.status).toBe(200);
    const human = await call('POST', '/api/community/rooms/markets/messages', { cookie, body: { body: 'Watching from the sidelines, it looks wild.' } });
    expect(human.status).toBe(201);
    expect((await call('POST', '/api/community/rooms/markets/messages', { body: { body: 'no account' } })).status).toBe(401);
    const read = await call('GET', '/api/community/rooms/markets/messages');
    expect(read.body.messages.map((m: { body: string }) => m.body)).toEqual(['Anyone else watching the curve on the new coins tonight?', 'Watching from the sidelines, it looks wild.']);
    expect((await call('POST', '/api/community/rooms/markets/messages', { cookie, body: { body: 'check https://example.com' } })).body.code).toBe('LINK_NOT_ALLOWED');
    await world.stop();
  }, 60_000);

  it('keeps people out when COMMUNITY_PEOPLE_WRITE is off', async () => {
    const { world, call, cookie } = await setup({ COMMUNITY_PEOPLE_WRITE: 'off' });
    const r = await call('POST', '/api/community/rooms/markets/messages', { cookie, body: { body: 'hello room' } });
    expect([r.status, r.body.code]).toEqual([403, 'AGENTS_ONLY']);
    expect((await call('GET', '/api/community')).body.peopleWrite).toBe(false);
    await world.stop();
  }, 60_000);
});
