import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, type TestCtx } from './helpers.ts';

let ctx: TestCtx;
beforeAll(async () => { ctx = await makeTestApp(); });
afterAll(() => ctx.close());

const cookieFrom = (r: { headers: Record<string, unknown> }) => String(r.headers['set-cookie']).split(';')[0]!;

describe('auth', () => {
  it('signs up, sets an httpOnly session cookie, and /me returns the user', async () => {
    const r = await ctx.app.inject({ method: 'POST', url: '/api/auth/signup', payload: { username: 'trader_one', displayName: 'Trader One', password: 'hunter2hunter2' } });
    expect(r.statusCode).toBe(201);
    expect(String(r.headers['set-cookie'])).toMatch(/HttpOnly/i);
    const me = await ctx.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: cookieFrom(r) } });
    expect(me.json().user.username).toBe('trader_one');
    expect(me.json().user.unreadNotifications).toBe(0);
  });

  it('rejects duplicate usernames case-insensitively', async () => {
    const r = await ctx.app.inject({ method: 'POST', url: '/api/auth/signup', payload: { username: 'TRADER_ONE', displayName: 'x', password: 'hunter2hunter2' } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe('USERNAME_TAKEN');
  });

  it('concurrent signups for the same name yield one 201 and one 409, never 500', async () => {
    const mk = (username: string) => ctx.app.inject({ method: 'POST', url: '/api/auth/signup', payload: { username, displayName: 'R', password: 'hunter2hunter2' } });
    const rs = await Promise.all([mk('racer_x'), mk('RACER_X')]);
    expect(rs.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(rs.find((r) => r.statusCode === 409)!.json().code).toBe('USERNAME_TAKEN');
  });

  it('validates input with a structured error', async () => {
    const r = await ctx.app.inject({ method: 'POST', url: '/api/auth/signup', payload: { username: 'a', displayName: '', password: 'x' } });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ code: 'VALIDATION', message: expect.any(String) });
  });

  it('logs in with correct password and rejects wrong password', async () => {
    const ok = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'Trader_One', password: 'hunter2hunter2' } });
    expect(ok.statusCode).toBe(200);
    const bad = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'trader_one', password: 'nope-nope' } });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().code).toBe('INVALID_CREDENTIALS');
  });

  it('logout destroys the session', async () => {
    const r = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'trader_one', password: 'hunter2hunter2' } });
    const cookie = cookieFrom(r);
    await ctx.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    const me = await ctx.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.json().user).toBeNull();
  });

  it('demo login returns 404 when not seeded, logs in when the demo user exists', async () => {
    expect((await ctx.as(null).post('/api/auth/demo')).status).toBe(404);
    await ctx.createUser('demo', { isDemo: true });
    const r = await ctx.as(null).post('/api/auth/demo');
    expect(r.status).toBe(200);
    expect(r.body.user.username).toBe('demo');
  });

  it('blocks cross-origin mutations', async () => {
    const r = await ctx.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { origin: 'https://evil.example' } });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe('BAD_ORIGIN');
  });

  it('unknown api routes return the error shape', async () => {
    const r = await ctx.as(null).get('/api/nope');
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('NOT_FOUND');
  });
});
