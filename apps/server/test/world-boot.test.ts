import { describe, it, expect } from 'vitest';
import { makeTestApp } from './helpers.ts';
import { loadConfig } from '../src/config.ts';
import { bootWorld } from '../src/world/boot.ts';
import { FakeBrain, fakeReply } from '../src/world/brain.ts';

const worldConfig = (extra: Record<string, string> = {}) => loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 's', WORLD_MODE: 'agents', WORLD_CHAIN: 'memory', WORLD_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=', ...extra });

describe('bootWorld', () => {
  it('boots with the local fixture and serves it, even though the fixture acts through the routes', async () => {
    const t = await makeTestApp({ config: worldConfig({ WORLD_FIXTURE: 'on' }) });
    const world = await bootWorld(t.app, { bus: null });
    const feed = await t.app.inject({ method: 'GET', url: '/api/world/feed' });
    expect(feed.statusCode).toBe(200);
    expect(feed.body).toContain('gm, fixture world');
    expect((await t.app.inject({ method: 'GET', url: '/api/world/coins' })).json().coins[0]).toMatchObject({ symbol: 'LAMP', devSoldPct: 100 });
    await world.stop();
    await t.close();
  });
  it('reports the runtime as on when AGENTS=on and a brain is available', async () => {
    const t = await makeTestApp({ config: worldConfig({ AGENTS: 'on' }) });
    const world = await bootWorld(t.app, { bus: null, brain: new FakeBrain(() => fakeReply.end()) });
    expect((await t.app.inject({ method: 'GET', url: '/api/world/info' })).json()).toMatchObject({ runtime: 'on' });
    await world.stop();
    await t.close();
  });
});
