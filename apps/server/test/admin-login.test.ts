import { describe, it, expect } from 'vitest';
import { makeTestApp } from './helpers.ts';
import { loadConfig } from '../src/config.ts';
import { seedWorld } from '../src/world/seed.ts';

/** A known login for /admin (owner, 2026-10-29): WORLD_ADMIN_PASSWORD makes the admin account and resets its password when changed. */
describe('the admin login', () => {
  it('signs in with the current WORLD_ADMIN_PASSWORD only, and is always an admin', async () => {
    const t = await makeTestApp();
    const key = Buffer.alloc(32, 3);
    await seedWorld(t.db, { now: new Date('2026-10-29T12:00:00Z'), worldKey: key, adminPassword: 'first-pass-1234' });
    await seedWorld(t.db, { now: new Date('2026-10-29T12:05:00Z'), worldKey: key, adminPassword: 'second-pass-5678' });
    const login = (password: string) => t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password } });
    expect((await login('first-pass-1234')).statusCode).toBe(401);
    expect((await login('second-pass-5678')).statusCode).toBe(200);
    expect(loadConfig({ NODE_ENV: 'test', ADMIN_USERNAMES: 'boss', WORLD_ADMIN_PASSWORD: 'x' }).adminUsernames).toEqual(['boss', 'admin']);
    expect(loadConfig({ NODE_ENV: 'test', ADMIN_USERNAMES: 'boss' }).adminUsernames).toEqual(['boss']);
    await t.close();
  }, 60_000);
});
