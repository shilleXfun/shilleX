import { describe, it, expect, afterEach } from 'vitest';
import { makeTestApp } from './helpers.ts';
import { FakeXApi, XApiError, xConfig, xPost } from './x-helpers.ts';
import { loadConfig } from '../src/config.ts';
import { xHighlights, xPosts, xSources } from '../src/db/schema.ts';
import { newId } from '../src/lib/ids.ts';
import { startXFeed, type XFeed } from '../src/x/feed.ts';
import { registerXRoutes } from '../src/x/routes.ts';
import { bootAgents } from '../src/world/boot.ts';
import type { Moment, Moments } from '../src/agents/types.ts';

let feed: XFeed | null = null;
afterEach(async () => { await feed?.stop(); feed = null; });
const queue = () => { const got: Moment[] = []; const m = { enqueue: (x: Moment) => { got.push(x); return true; }, size: () => got.length, drain: async () => {}, halted: () => null, stop: async () => {} } as Moments; return { m, got }; };

describe('startXFeed (x-feed §3, §4, §6)', () => {
  it('a tick polls, queues the digest when due, drafts and posts highlights; off means nothing is read', async () => {
    const t = await makeTestApp();
    try {
      const api = new FakeXApi();
      await t.db.insert(xSources).values({ id: newId(), kind: 'account', value: 'lamp', xUserId: 'u1', createdAt: t.clock.now() });
      api.timelines.set('u1', [xPost('101', 'hello')]);
      const { m, got } = queue();
      feed = startXFeed({ db: t.db, now: t.clock.now, config: xConfig({ feed: false }), api, publicUrl: 'https://s.example', moments: () => m }, 3_600_000);
      await feed.tick();
      expect(api.calls).toEqual([]);
      await feed.stop();
      feed = startXFeed({ db: t.db, now: t.clock.now, config: xConfig({ highlights: 'auto' }), api, publicUrl: 'https://s.example', moments: () => m }, 3_600_000);
      await feed.tick();
      expect(await t.db.select().from(xPosts)).toHaveLength(1);
      expect(got).toEqual([expect.objectContaining({ kind: 'x_digest', agentId: '', data: { key: 'x' } })]);
      expect(feed.status()).toMatchObject({ reading: 'on', highlights: 'auto', posting: 'on', lastError: null });
    } finally { await t.close(); }
  });
  it('a 401 halts reading until Resume', async () => {
    const t = await makeTestApp();
    try {
      const api = new FakeXApi();
      await t.db.insert(xSources).values({ id: newId(), kind: 'account', value: 'lamp', xUserId: 'u1', createdAt: t.clock.now() });
      api.failNext = new XApiError(401, 'Unauthorized');
      feed = startXFeed({ db: t.db, now: t.clock.now, config: xConfig(), api, publicUrl: 'https://s.example', moments: () => null }, 3_600_000);
      await feed.tick();
      expect(feed.status()).toMatchObject({ reading: 'halted', readHalted: expect.stringMatching(/401/) });
      t.clock.advance(20 * 60_000);
      await feed.tick();
      expect(api.calls.filter((c) => c.method === 'userPosts')).toHaveLength(1);
      feed.resume();
      expect(feed.status().reading).toBe('on');
    } finally { await t.close(); }
  });
});

describe('the X admin routes', () => {
  async function setup() {
    const t = await makeTestApp();
    const api = new FakeXApi();
    api.users.set('lamp', { id: '99', username: 'Lamp' });
    feed = startXFeed({ db: t.db, now: t.clock.now, config: xConfig(), api, publicUrl: 'https://s.example', moments: () => null }, 3_600_000);
    await registerXRoutes(t.app, { feed, api, config: xConfig() });
    const admin = await t.createUser('admin');
    return { t, api, admin };
  }
  it('are for admins only', async () => {
    const { t } = await setup();
    try {
      expect((await t.as(null).get('/api/admin/x')).status).toBe(401);
      expect((await t.as(await t.createUser('someone')).get('/api/admin/x')).status).toBe(403);
    } finally { await t.close(); }
  });
  it('list, add, pause and remove sources, and approve or skip drafts', async () => {
    const { t, admin } = await setup();
    try {
      const add = await t.as(admin).post('/api/admin/x/sources', { kind: 'account', value: '@lamp' });
      expect(add.status).toBe(201);
      expect(add.body.source).toMatchObject({ kind: 'account', value: 'Lamp', enabled: true });
      expect((await t.as(admin).post('/api/admin/x/sources', { kind: 'account', value: 'ghost' })).status).toBe(404);
      expect((await t.as(admin).post('/api/admin/x/sources', { kind: 'account', value: 'Lamp' })).status).toBe(409);
      expect((await t.as(admin).patch(`/api/admin/x/sources/${add.body.source.id}`, { enabled: false })).status).toBe(204);
      const id = newId();
      await t.db.insert(xHighlights).values({ id, key: 'k', kind: 'graduation', body: 'ORBIT (devnet coin) graduated.', status: 'draft', createdAt: t.clock.now() });
      expect((await t.as(admin).post(`/api/admin/x/highlights/${id}/approve`)).status).toBe(204);
      const view = (await t.as(admin).get('/api/admin/x')).body;
      expect(view.sources).toEqual([expect.objectContaining({ value: 'Lamp', enabled: false })]);
      expect(view.highlights).toEqual([expect.objectContaining({ id, status: 'approved', body: 'ORBIT (devnet coin) graduated.' })]);
      expect(view.status).toMatchObject({ reading: 'on' });
      expect(view.spendToday).toMatchObject({ userReads: 1 });
      expect((await t.as(admin).post(`/api/admin/x/highlights/${id}/skip`)).status).toBe(204);
      expect((await t.as(admin).post(`/api/admin/x/highlights/${id}/approve`)).status).toBe(409); // only a draft can be approved
      expect((await t.as(admin).del(`/api/admin/x/sources/${add.body.source.id}`)).status).toBe(204);
      expect((await t.as(admin).get('/api/admin/x')).body.sources).toEqual([]);
    } finally { await t.close(); }
  });
});

describe('wiring', () => {
  it('the agent world boots the X feed and its routes', async () => {
    const t = await makeTestApp({ config: loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 's', WORLD_CHAIN: 'memory', WORLD_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=' }) });
    const world = await bootAgents(t.app, {});
    try {
      const admin = await t.createUser('admin');
      const r = await t.as(admin).get('/api/admin/x');
      expect(r.status).toBe(200);
      expect(r.body.status).toMatchObject({ reading: 'off', highlights: 'off', posting: 'not configured' });
    } finally { await world.stop(); await t.close(); }
  });
  it('the CSP lets X’s embed script and frame load, and nothing else new', async () => {
    const t = await makeTestApp();
    try {
      const csp = String((await t.app.inject({ method: 'GET', url: '/api/health' })).headers['content-security-policy']);
      expect(csp).toContain("script-src 'self' https://platform.twitter.com");
      expect(csp).toContain('frame-src https://platform.twitter.com https://syndication.twitter.com');
      expect(csp).toContain("frame-ancestors 'none'");
    } finally { await t.close(); }
  });
});
