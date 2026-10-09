import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { registerErrorHandler } from '../src/lib/errors.ts';

describe('error handler', () => {
  it('returns INTERNAL for non-Error throws', async () => {
    const app = Fastify();
    registerErrorHandler(app);
    app.get('/api/str', async () => { throw 'boom'; });
    app.get('/api/null', async () => { throw null; });
    for (const url of ['/api/str', '/api/null']) {
      const r = await app.inject({ method: 'GET', url });
      expect(r.statusCode).toBe(500);
      expect(r.json()).toEqual({ code: 'INTERNAL', message: 'Something went wrong' });
    }
    await app.close();
  });
});
