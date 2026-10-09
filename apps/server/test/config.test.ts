import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.ts';
import { makeTestApp } from './helpers.ts';

describe('loadConfig production secret guard', () => {
  it('throws with no secret', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/SESSION_SECRET/);
  });
  it('throws for change-me', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'change-me' })).toThrow(/SESSION_SECRET/);
  });
  it('throws for the dev fallback secret', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'dev-secret' })).toThrow(/SESSION_SECRET/);
  });
  it('accepts a real secret', () => {
    expect(loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'a-real-secret' }).sessionSecret).toBe('a-real-secret');
  });
});

describe('session cookie attributes', () => {
  const signup = { username: 'cookie_user', displayName: 'Cookie', password: 'hunter2hunter2' };

  it('is HttpOnly and SameSite=Lax, not Secure, outside production', async () => {
    const ctx = await makeTestApp();
    try {
      const r = await ctx.app.inject({ method: 'POST', url: '/api/auth/signup', payload: signup });
      const c = String(r.headers['set-cookie']);
      expect(c).toMatch(/SameSite=Lax/i);
      expect(c).toMatch(/HttpOnly/i);
      expect(c).not.toMatch(/Secure/i);
    } finally { await ctx.close(); }
  });

  it('is Secure in production', async () => {
    const config = loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'a-real-secret' });
    const ctx = await makeTestApp({ config });
    try {
      const r = await ctx.app.inject({ method: 'POST', url: '/api/auth/signup', payload: signup });
      expect(String(r.headers['set-cookie'])).toMatch(/Secure/i);
      await ctx.createUser('demo', { isDemo: true });
      const d = await ctx.app.inject({ method: 'POST', url: '/api/auth/demo' });
      expect(String(d.headers['set-cookie'])).toMatch(/Secure/i);
    } finally { await ctx.close(); }
  });
});
