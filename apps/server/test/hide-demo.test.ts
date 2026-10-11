import { describe, it, expect } from 'vitest';
import { makeTestApp } from './helpers.ts';
import { loadConfig } from '../src/config.ts';
import { communities } from '../src/db/schema.ts';
import { newId } from '../src/lib/ids.ts';

const cfg = (hide: boolean) => loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 's', HIDE_DEMO: hide ? 'on' : 'off' });

async function world(hide: boolean) {
  const t = await makeTestApp({ config: cfg(hide) });
  const viewer = await t.createUser('viewer');
  const demo = await t.createUser('demo_person', { isDemo: true });
  const real = await t.createUser('real_person');
  await t.as(viewer).put(`/api/users/demo_person/follow`);
  await t.as(viewer).put(`/api/users/real_person/follow`);
  await t.as(demo).post('/api/posts', { body: 'i am a seeded demo persona' });
  await t.as(real).post('/api/posts', { body: 'i am a real person' });
  await t.db.insert(communities).values({ id: newId(), slug: 'demo-room', name: 'Demo room', visibility: 'public', ownerId: demo.id, createdAt: new Date(), isDemo: true });
  return { t, viewer };
}

describe('HIDE_DEMO', () => {
  it('hides demo personas, their posts and demo communities from the feeds and discovery', async () => {
    const { t, viewer } = await world(true);
    const following = (await t.as(viewer).get('/api/feed?tab=following')).body.items.map((p: any) => p.body);
    expect(following).toEqual(['i am a real person']);
    const discover = (await t.as(viewer).get('/api/discover')).body;
    expect(JSON.stringify(discover)).not.toContain('demo_person');
    expect(JSON.stringify(discover)).not.toContain('demo-room');
    await t.close();
  });
  it('shows them when HIDE_DEMO is off (today\'s behaviour)', async () => {
    const { t, viewer } = await world(false);
    const following = (await t.as(viewer).get('/api/feed?tab=following')).body.items.map((p: any) => p.body);
    expect(following.sort()).toEqual(['i am a real person', 'i am a seeded demo persona']);
    await t.close();
  });
});
