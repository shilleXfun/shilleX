import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTestApp, type TestCtx } from './helpers.ts';
import { loadConfig } from '../src/config.ts';

let ctx: TestCtx;
beforeAll(async () => {
  const dist = mkdtempSync(join(tmpdir(), 'shillex-dist-'));
  const uploads = mkdtempSync(join(tmpdir(), 'shillex-uploads-'));
  mkdirSync(join(dist, 'assets'));
  writeFileSync(join(dist, 'index.html'), '<!doctype html><div id="root"></div>');
  writeFileSync(join(dist, 'assets', 'app.js'), 'console.log(1)');
  writeFileSync(join(uploads, 'a.txt'), 'hello');
  ctx = await makeTestApp({ config: { ...loadConfig({ NODE_ENV: 'test' }), webDistDir: dist, uploadsDir: uploads } });
});
afterAll(() => ctx.close());

describe('static serving', () => {
  it('serves the SPA for client routes and assets directly', async () => {
    const r = await ctx.app.inject({ method: 'GET', url: '/c/trenches/123' });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('id="root"');
    expect(r.headers['cache-control']).toBe('no-cache');
    const asset = await ctx.app.inject({ method: 'GET', url: '/assets/app.js' });
    expect(asset.body).toBe('console.log(1)');
    expect(String(asset.headers['cache-control'])).toContain('immutable');
  });
  it('keeps API 404s as JSON and does not fall back for non-GET or reserved prefixes', async () => {
    const r = await ctx.app.inject({ method: 'GET', url: '/api/nope' });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ code: 'NOT_FOUND', message: 'Route not found' });
    expect((await ctx.app.inject({ method: 'POST', url: '/somewhere' })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: 'GET', url: '/uploads/missing.png' })).headers['content-type']).not.toContain('text/html');
    expect((await ctx.app.inject({ method: 'GET', url: '/media/nope/x.svg' })).headers['content-type']).not.toContain('text/html');
    // A stale client asking for a chunk from an older build must get a 404, not index.html.
    const stale = await ctx.app.inject({ method: 'GET', url: '/assets/old-chunk.js' });
    expect(stale.statusCode).toBe(404);
    expect(stale.headers['content-type']).not.toContain('text/html');
  });
  it('answers HEAD on client routes', async () => {
    const r = await ctx.app.inject({ method: 'HEAD', url: '/c/x' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/html');
  });
  it('sends security headers and a health endpoint', async () => {
    const r = await ctx.app.inject({ method: 'GET', url: '/api/health' });
    expect(r.json()).toMatchObject({ ok: true, db: 'pglite' });
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(String(r.headers['content-security-policy'])).toContain("default-src 'self'");
  });
  it('keeps the stricter CSP set by uploads and media routes', async () => {
    const up = await ctx.app.inject({ method: 'GET', url: '/uploads/a.txt' });
    expect(up.statusCode).toBe(200);
    expect(up.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    const media = await ctx.app.inject({ method: 'GET', url: '/media/avatar/abc.svg' });
    expect(media.statusCode).toBe(200);
    expect(media.headers['content-security-policy']).toBe("default-src 'none'; style-src 'unsafe-inline'");
  });
});
