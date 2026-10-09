import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTestApp, type TestCtx, type TestUser } from './helpers.ts';
import { loadConfig } from '../src/config.ts';

function multipart(filename: string, mime: string, data: Buffer) {
  const boundary = '----shillextest';
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { payload: Buffer.concat([head, data, tail]), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
function png(w: number, h: number) {
  const b = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'ascii'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}

let ctx: TestCtx; let u: TestUser; let dir: string;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'shillex-up-'));
  const config = { ...loadConfig({ NODE_ENV: 'test' }), uploadsDir: dir };
  ctx = await makeTestApp({ config });
  u = await ctx.createUser('uploader');
});
afterAll(() => ctx.close());

describe('uploads', () => {
  it('accepts a png and stores it', async () => {
    const m = multipart('a.png', 'image/png', png(10, 20));
    const r = await ctx.app.inject({ method: 'POST', url: '/api/uploads', payload: m.payload, headers: { ...m.headers, cookie: u.cookie } });
    expect(r.statusCode).toBe(201);
    const up = r.json().upload;
    expect(up).toMatchObject({ width: 10, height: 20, mime: 'image/png' });
    expect(up.url).toMatch(/^\/uploads\/[0-9A-Z]+\.png$/);
    expect(existsSync(join(dir, up.url.split('/').pop()))).toBe(true);
  });
  it('accepts a file just under 5 MB (above the global 1 MB body limit)', async () => {
    const m = multipart('near.png', 'image/png', Buffer.concat([png(10, 10), Buffer.alloc(4 * 1024 * 1024)]));
    const r = await ctx.app.inject({ method: 'POST', url: '/api/uploads', payload: m.payload, headers: { ...m.headers, cookie: u.cookie } });
    expect(r.statusCode).toBe(201);
  });
  it('sniffs content instead of trusting the declared type', async () => {
    const m = multipart('evil.png', 'image/png', Buffer.from('<script>alert(1)</script>'));
    const r = await ctx.app.inject({ method: 'POST', url: '/api/uploads', payload: m.payload, headers: { ...m.headers, cookie: u.cookie } });
    expect(r.statusCode).toBe(415);
    expect(r.json().code).toBe('UNSUPPORTED_MEDIA');
  });
  it('rejects files over 5 MB', async () => {
    const big = Buffer.concat([png(10, 10), Buffer.alloc(5 * 1024 * 1024)]);
    const m = multipart('big.png', 'image/png', big);
    const r = await ctx.app.inject({ method: 'POST', url: '/api/uploads', payload: m.payload, headers: { ...m.headers, cookie: u.cookie } });
    expect(r.statusCode).toBe(413);
    expect(r.json().code).toBe('TOO_LARGE');
  });
  it('requires auth', async () => {
    const m = multipart('a.png', 'image/png', png(1, 1));
    const r = await ctx.app.inject({ method: 'POST', url: '/api/uploads', payload: m.payload, headers: m.headers });
    expect(r.statusCode).toBe(401);
  });
});

describe('generated media', () => {
  it('serves deterministic svg avatars', async () => {
    const a = await ctx.app.inject({ method: 'GET', url: '/media/avatar/abc.svg' });
    const b = await ctx.app.inject({ method: 'GET', url: '/media/avatar/abc.svg' });
    expect(a.statusCode).toBe(200);
    expect(a.headers['content-type']).toMatch(/image\/svg\+xml/);
    expect(a.body).toBe(b.body);
    expect(a.headers['cache-control']).toMatch(/immutable/);
  });
  it('404s unknown kinds', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/media/nope/abc.svg' })).statusCode).toBe(404);
  });
});
