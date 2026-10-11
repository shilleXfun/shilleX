import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestApp } from './helpers.ts';
import { blobUpload, blobUrl, storeBlob } from '../src/agents/images.ts';
import { mediaBlobs, posts } from '../src/db/schema.ts';

// A valid 1×1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
let t: Awaited<ReturnType<typeof makeTestApp>>;
beforeAll(async () => { t = await makeTestApp(); });
afterAll(() => t.close());

describe('media blobs', () => {
  it('stores a PNG once per content hash and reports its size', async () => {
    const a = await storeBlob(t.db, PNG, 'image/png', t.clock.now());
    const b = await storeBlob(t.db, PNG, 'image/png', t.clock.now());
    expect(a).toEqual(b);
    expect(a).toMatchObject({ url: `/api/blobs/${a.id}`, width: 1, height: 1 });
    expect(blobUrl(a.id)).toBe(a.url);
    expect(await t.db.select().from(mediaBlobs)).toHaveLength(1);
  });
  it('refuses bytes that are not an image, or a mime that does not match', async () => {
    await expect(storeBlob(t.db, Buffer.from('<svg/>'), 'image/png', t.clock.now())).rejects.toThrow('NOT_AN_IMAGE');
    await expect(storeBlob(t.db, PNG, 'image/jpeg', t.clock.now())).rejects.toThrow('NOT_AN_IMAGE');
  });
  it('refuses blobs over 2 MB', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]);
    await expect(storeBlob(t.db, big, 'image/png', t.clock.now())).rejects.toThrow('TOO_LARGE');
  });
  it('serves a blob with immutable caching, nosniff and its mime; 404 otherwise', async () => {
    const { id } = await storeBlob(t.db, PNG, 'image/png', t.clock.now());
    const r = await t.app.inject({ method: 'GET', url: `/api/blobs/${id}` });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('image/png');
    expect(r.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.rawPayload.equals(PNG)).toBe(true);
    expect((await t.app.inject({ method: 'GET', url: '/api/blobs/nope' })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: '/api/blobs/..%2Fetc' })).statusCode).toBe(404);
  });
  it('lets the owner attach a blob to a post through the normal posts route', async () => {
    const u = await t.createUser('painter');
    const blob = await storeBlob(t.db, PNG, 'image/png', t.clock.now());
    const uploadId = await blobUpload(t.db, u.id, blob, 'image/png', t.clock.now());
    const r = await t.as(u).post('/api/posts', { body: 'look', uploadIds: [uploadId], alts: ['a dot'] });
    expect(r.status).toBe(201);
    const [p] = await t.db.select().from(posts).where(eq(posts.authorId, u.id));
    expect(p!.media).toEqual([{ url: blob.url, width: 1, height: 1, alt: 'a dot' }]);
  });
});
