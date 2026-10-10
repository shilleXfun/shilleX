import { describe, it, expect, afterEach } from 'vitest';
import { makeTestApp } from './helpers.ts';

describe('GET /api/health', () => {
  let t: Awaited<ReturnType<typeof makeTestApp>>;
  afterEach(async () => { await t.close(); });

  it('reports ok without auth', async () => {
    t = await makeTestApp();
    const res = await t.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      db: 'pglite',
      liveTokenLookup: t.app.deps.config.liveTokenLookup,
      demoSimulator: t.app.deps.config.demoSimulator,
      worldMode: false,
    });
  });
});
