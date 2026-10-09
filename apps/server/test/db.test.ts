import { describe, it, expect, afterAll } from 'vitest';
import { createDb } from '../src/db/client.ts';
import { users } from '../src/db/schema.ts';
import { newId } from '../src/lib/ids.ts';

describe('createDb (in-memory PGlite)', async () => {
  const h = await createDb({});
  afterAll(() => h.close());

  it('runs migrations and round-trips a user', async () => {
    const id = newId();
    await h.db.insert(users).values({ id, username: 'Alpha', displayName: 'Alpha', createdAt: new Date() });
    const rows = await h.db.select().from(users);
    expect(rows.map((r) => r.username)).toContain('Alpha');
  });

  it('enforces case-insensitive unique usernames', async () => {
    await expect(
      h.db.insert(users).values({ id: newId(), username: 'alpha', displayName: 'x', createdAt: new Date() }),
    ).rejects.toThrow();
  });

  it('newId is monotonic', () => {
    const a = newId(); const b = newId();
    expect(a < b).toBe(true);
  });
});

