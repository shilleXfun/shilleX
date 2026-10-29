import { describe, it, expect } from 'vitest';
import { Resvg } from '@resvg/resvg-js';
import { testDb } from './helpers.ts';
import { loadConfig } from '../src/config.ts';
import { createImageMaker } from '../src/agents/image-cache.ts';
import type { ImageGen } from '../src/agents/images.ts';
import { pixelFacesForAll } from '../src/world/seed.ts';
import { users } from '../src/db/schema.ts';
import { eq } from 'drizzle-orm';

/** Images (2026-10-28 brief §5): every paid image is cached by its prompt; past the day's limit nothing is drawn and nothing breaks. */
const png = Buffer.from(new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#f28c38"/></svg>').render().asPng());
function fakeGen() {
  const calls: string[] = [];
  const gen: ImageGen = { async generate(prompt) { calls.push(prompt); return { png, usd: 0.011 }; } };
  return { gen, calls };
}

describe('the image maker', () => {
  it('pays for a prompt once and serves the same image after', async () => {
    const { db } = await testDb();
    const { gen, calls } = fakeGen();
    const m = createImageMaker({ db, gen, limits: { usd: 1, max: 10 }, now: () => new Date('2026-10-28T23:00:00Z') });
    const a = await m.make('a pixel fox in a hoodie', { kind: 'pfp' });
    const b = await m.make('a pixel fox in a hoodie', { kind: 'pfp' });
    expect(a?.url).toMatch(/^\/api\/blobs\//);
    expect(b?.url).toBe(a?.url);
    expect(calls).toHaveLength(1);
  });

  it('answers null at the daily limit, without throwing', async () => {
    const { db } = await testDb();
    const { gen, calls } = fakeGen();
    const m = createImageMaker({ db, gen, limits: { usd: 1, max: 1 }, now: () => new Date('2026-10-28T23:00:00Z') });
    expect(await m.make('first', { kind: 'post' })).not.toBeNull();
    expect(await m.make('second', { kind: 'post' })).toBeNull();
    expect(calls).toEqual(['first']);
  });

  it('answers null with no image key', async () => {
    const { db } = await testDb();
    expect(await createImageMaker({ db, gen: null, limits: { usd: 1, max: 10 }, now: () => new Date() }).make('x', { kind: 'pfp' })).toBeNull();
  });

  it('puts every agent back on its pixel face', async () => {
    const { db } = await testDb();
    const now = new Date('2026-10-28T23:00:00Z');
    await db.insert(users).values([
      { id: 'a1', username: 'facebot', displayName: 'Face Bot', kind: 'agent', avatarUrl: '/api/blobs/drawnface1', createdAt: now },
      { id: 'a2', username: 'plainbot', displayName: 'Plain', kind: 'agent', avatarUrl: '/api/agents/avatars/a2.svg', createdAt: now },
      { id: 'h1', username: 'person', displayName: 'Person', kind: 'human', avatarUrl: '/api/blobs/mine', createdAt: now },
    ]);
    expect(await pixelFacesForAll(db)).toBe(1);
    const faces = new Map((await db.select().from(users)).map((u) => [u.id, u.avatarUrl]));
    expect([faces.get('a1'), faces.get('a2'), faces.get('h1')]).toEqual(['/api/agents/avatars/a1.svg', '/api/agents/avatars/a2.svg', '/api/blobs/mine']);
    expect(await pixelFacesForAll(db)).toBe(0);
  });

  it('reads IMAGE_DAILY_LIMIT and IMAGE_POST_EVERY', () => {
    const c = loadConfig({ NODE_ENV: 'test', IMAGE_DAILY_LIMIT: '7', IMAGE_POST_EVERY: '10' });
    expect([c.imageDailyMax, c.imagePostEvery]).toEqual([7, 10]);
    expect(loadConfig({ NODE_ENV: 'test' }).imagePostEvery).toBe(25);
  });
});
