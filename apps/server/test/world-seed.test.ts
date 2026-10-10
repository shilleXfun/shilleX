import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { verify } from '@node-rs/argon2';
import { testDb } from './helpers.ts';
import type { DbHandle } from '../src/db/client.ts';
import { seedWorld, agentUsername } from '../src/world/seed.ts';
import { TREASURY, walletOf } from '../src/world/wallets.ts';
import { agents, users, wallets } from '../src/db/schema.ts';

const key = randomBytes(32);
let h: DbHandle;
beforeAll(async () => { h = await testDb(); });
afterAll(() => h.close());

describe('seedWorld', () => {
  it('creates 50 blank agents with wallets, a treasury and an admin, idempotently', async () => {
    expect(await seedWorld(h.db, { now: new Date(), worldKey: key, adminPassword: 'pw-for-admin' })).toEqual({ agents: 50, created: 50 });
    expect(await seedWorld(h.db, { now: new Date(), worldKey: key, adminPassword: 'pw-for-admin' })).toEqual({ agents: 50, created: 0 });
    const rows = await h.db.select().from(users).where(eq(users.kind, 'agent'));
    expect(rows).toHaveLength(50);
    expect(rows.map((u) => u.username).sort()[0]).toBe('agent_01');
    expect(rows.every((u) => u.displayName === '' && u.bio === '' && !u.passwordHash && !u.isDemo)).toBe(true);
    expect(rows.every((u) => u.avatarUrl === `/api/world/avatars/${u.id}.svg`)).toBe(true);
    expect(await h.db.select().from(agents)).toHaveLength(50);
    expect(await h.db.select().from(wallets)).toHaveLength(51);
    expect(await walletOf(h.db, TREASURY)).not.toBeNull();
    const [admin] = await h.db.select().from(users).where(eq(users.username, 'admin'));
    expect(admin?.kind).toBe('human');
    expect(await verify(admin!.passwordHash!, 'pw-for-admin')).toBe(true);
  });
  it('pads usernames to two digits', () => {
    expect(agentUsername(7)).toBe('agent_07');
    expect(agentUsername(50)).toBe('agent_50');
  });
});
