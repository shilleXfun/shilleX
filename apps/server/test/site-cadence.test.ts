import { describe, it, expect } from 'vitest';
import { testDb } from './helpers.ts';
import { agents, siteBuilds, sites, users } from '../src/db/schema.ts';
import { SITE_EVERY_MS, siteCadence } from '../src/sites/cadence.ts';

/** A website at least every 15 minutes (owner, 2026-10-29). */
describe('the site cadence', () => {
  it('starts one when no build began in 15 minutes, from an agent with the fewest sites, and waits otherwise', async () => {
    const { db } = await testDb();
    let t = new Date('2026-10-29T16:00:00Z');
    for (const id of ['a1', 'a2']) {
      await db.insert(users).values({ id, username: id, displayName: id, kind: 'agent', createdAt: t });
      await db.insert(agents).values({ userId: id, origin: 'wild', status: 'active', createdAt: t });
    }
    await db.insert(sites).values({ id: 's1', slug: 'one', title: 'One', blurb: '', authorId: 'a1', kind: 'product', version: 1, views: 0, createdAt: t, updatedAt: t } as never);
    const started: [string, string][] = [];
    const buildSite = (id: string, job: { site: string }) => { started.push([id, job.site]); return true; };
    expect(await siteCadence({ db, now: () => t, buildSite }, () => 0.9)).toBe('a2');
    expect(started).toEqual([['a2', 'product']]);
    await db.insert(siteBuilds).values({ id: 'b1', agentId: 'a2', kind: 'new', status: 'building', model: 'm', startedAt: t } as never);
    t = new Date(t.getTime() + 10 * 60_000);
    expect(await siteCadence({ db, now: () => t, buildSite })).toBeNull();
    t = new Date(t.getTime() + SITE_EVERY_MS);
    expect(await siteCadence({ db, now: () => t, buildSite }, () => 0.9)).not.toBeNull();
  });
});
