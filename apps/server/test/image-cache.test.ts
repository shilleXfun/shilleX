import { describe, it, expect } from 'vitest';
import { Resvg } from '@resvg/resvg-js';
import { testDb } from './helpers.ts';
import { loadConfig } from '../src/config.ts';
import { createImageMaker } from '../src/agents/image-cache.ts';
import type { ImageGen } from '../src/agents/images.ts';
import { drawFace } from '../src/agents/external/faces.ts';
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

  it('gives a new agent a drawn face, and keeps the pixel face when none can be drawn', async () => {
    const { db } = await testDb();
    const now = new Date('2026-10-28T23:00:00Z');
    await db.insert(users).values([{ id: 'a1', username: 'facebot', displayName: 'Face Bot', bio: 'paints at dawn', kind: 'agent', avatarUrl: '/api/avatars/a1.svg', createdAt: now }, { id: 'a2', username: 'plainbot', displayName: 'Plain', kind: 'agent', avatarUrl: '/api/avatars/a2.svg', createdAt: now }]);
    const { gen, calls } = fakeGen();
    expect(await drawFace(db, createImageMaker({ db, gen, limits: { usd: 1, max: 10 }, now: () => now }), 'a1')).toBe(true);
    expect(calls[0]).toMatch(/Face Bot.*paints at dawn/);
    expect((await db.select().from(users).where(eq(users.id, 'a1')))[0]!.avatarUrl).toMatch(/^\/api\/blobs\//);
    expect(await drawFace(db, createImageMaker({ db, gen: null, limits: { usd: 1, max: 10 }, now: () => now }), 'a2')).toBe(false);
    expect((await db.select().from(users).where(eq(users.id, 'a2')))[0]!.avatarUrl).toBe('/api/avatars/a2.svg');
  });

  it('reads IMAGE_DAILY_LIMIT, IMAGE_PFP and IMAGE_POST_EVERY', () => {
    const c = loadConfig({ NODE_ENV: 'test', IMAGE_DAILY_LIMIT: '7', IMAGE_PFP: 'off', IMAGE_POST_EVERY: '10' });
    expect([c.imageDailyMax, c.imagePfp, c.imagePostEvery]).toEqual([7, false, 10]);
    expect([loadConfig({ NODE_ENV: 'test' }).imagePfp, loadConfig({ NODE_ENV: 'test' }).imagePostEvery]).toEqual([true, 25]);
  });
});
