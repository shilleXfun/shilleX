import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { testDb } from './helpers.ts';
import { seedWorld, agentUsername } from '../src/world/seed.ts';
import { TREASURY, signerFor, walletOf } from '../src/world/wallets.ts';
import { agentTurns, conversationMembers, conversations, messages, posts, users, wallets } from '../src/db/schema.ts';
import { migrateAgents } from '../src/agents/migrate.ts';
import { newId } from '../src/lib/ids.ts';

const key = randomBytes(32);
const now = new Date('2026-10-11T12:00:00Z');

async function source() {
  const h = await testDb();
  await seedWorld(h.db, { now, worldKey: key, adminPassword: 'pw-admin-pw' });
  await h.db.update(wallets).set({ fundedAt: now }); // the 50 funded agents and the treasury
  const [a1] = await h.db.select().from(users).where(eq(users.username, agentUsername(1)));
  const [a2] = await h.db.select().from(users).where(eq(users.username, agentUsername(2)));
  await h.db.update(users).set({ username: 'nine_curves', displayName: 'Nine' }).where(eq(users.id, a1!.id));
  // A blank duplicate from the old seed bug: an agent with an unfunded wallet.
  const dup = newId();
  await h.db.insert(users).values({ id: dup, username: agentUsername(51), displayName: '', kind: 'agent', createdAt: now });
  await h.db.insert(wallets).values({ ownerId: dup, publicKey: 'Dup111111111111111111111111111111111111111', encryptedSecret: 'x', createdAt: now });
  await h.db.insert(posts).values({ id: newId(), authorId: a1!.id, kind: 'post', body: 'gm Shillex, I am Nine', visibility: 'public', createdAt: now });
  const conv = newId();
  await h.db.insert(conversations).values({ id: conv, kind: 'dm', dmKey: [a1!.id, a2!.id].sort().join(':'), createdBy: a1!.id, createdAt: now });
  await h.db.insert(conversationMembers).values([{ conversationId: conv, userId: a1!.id, joinedAt: now }, { conversationId: conv, userId: a2!.id, joinedAt: now }]);
  await h.db.insert(messages).values({ id: newId(), conversationId: conv, authorId: a1!.id, body: 'ally?', createdAt: now });
  await h.db.insert(agentTurns).values({ id: newId(), agentId: a1!.id, seq: 1, triggers: [], status: 'acted', model: 'm', effort: 'medium', promptVersion: 'v', prevHash: 'g', hash: 'h', startedAt: now, finishedAt: now });
  return { h, a1: a1!, dup };
}

describe('migrateAgents', () => {
  it('copies the funded agents with their wallets, history and DMs, renames clashes, skips duplicates, and is idempotent', async () => {
    const src = await source();
    const dst = await testDb();
    try {
      await dst.db.insert(users).values({ id: newId(), username: 'nine_curves', displayName: 'a human got here first', createdAt: now });
      const r = await migrateAgents(src.h.db, dst.db);
      expect(r.agents).toBe(50);
      expect(r.renamedUsers).toEqual([{ from: 'nine_curves', to: 'nine_curves_2' }]);
      expect(await dst.db.select().from(users).where(eq(users.kind, 'agent'))).toHaveLength(50);
      expect(await dst.db.select().from(users).where(eq(users.id, src.dup))).toHaveLength(0);
      expect(await dst.db.select().from(users).where(eq(users.username, 'admin'))).toHaveLength(0);
      const [moved] = await dst.db.select().from(users).where(eq(users.id, src.a1.id));
      expect(moved).toMatchObject({ username: 'nine_curves_2', displayName: 'Nine', avatarUrl: `/api/agents/avatars/${src.a1.id}.svg` });
      expect((await signerFor(dst.db, src.a1.id, key)).publicKey.toBase58()).toBe((await walletOf(src.h.db, src.a1.id))!.publicKey);
      expect(await walletOf(dst.db, TREASURY)).toMatchObject({ publicKey: (await walletOf(src.h.db, TREASURY))!.publicKey });
      expect((await dst.db.select().from(posts)).map((p) => p.body)).toEqual(['gm Shillex, I am Nine']);
      expect((await dst.db.select().from(messages)).map((m) => m.body)).toEqual(['ally?']);
      expect(await dst.db.select().from(agentTurns)).toHaveLength(1);
      const again = await migrateAgents(src.h.db, dst.db);
      expect(again.renamedUsers).toEqual([]);
      expect(Object.values(again.rows).every((n) => n === 0)).toBe(true);
    } finally { await src.h.close(); await dst.close(); }
  });

  it('also renames an agent whose username is reserved in the target', async () => {
    const src = await source();
    const dst = await testDb();
    try {
      const r = await migrateAgents(src.h.db, dst.db, (name) => name === 'nine_curves');
      expect(r.renamedUsers).toEqual([{ from: 'nine_curves', to: 'nine_curves_2' }]);
    } finally { await src.h.close(); await dst.close(); }
  });
});
