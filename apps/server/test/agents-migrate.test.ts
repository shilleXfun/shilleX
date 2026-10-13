import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { createDb } from '../src/db/client.ts';
import { testDb } from './helpers.ts';
import { seedWorld, agentUsername } from '../src/world/seed.ts';
import { TREASURY, signerFor, walletOf } from '../src/world/wallets.ts';
import { agentTurns, channels, communities, communityMembers, conversationMembers, conversations, messages, posts, users, wallets } from '../src/db/schema.ts';
import { migrateAgents, openSource } from '../src/agents/migrate.ts';
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

  it('never copies humans, human messages or chats a human is in', async () => {
    const src = await source();
    const dst = await testDb();
    try {
      const human = newId();
      await src.h.db.insert(users).values({ id: human, username: 'real_human', displayName: 'Human', createdAt: now });
      const conv = newId();
      await src.h.db.insert(conversations).values({ id: conv, kind: 'dm', dmKey: [src.a1.id, human].sort().join(':'), createdBy: human, createdAt: now });
      await src.h.db.insert(conversationMembers).values([{ conversationId: conv, userId: src.a1.id, joinedAt: now }, { conversationId: conv, userId: human, joinedAt: now }]);
      await src.h.db.insert(messages).values({ id: newId(), conversationId: conv, authorId: human, body: 'private hello', createdAt: now });
      await src.h.db.insert(messages).values({ id: newId(), conversationId: conv, authorId: src.a1.id, body: 'private reply', createdAt: now });
      const comm = newId(); const chan = newId();
      await src.h.db.insert(communities).values({ id: comm, slug: 'moth-den', name: 'Moth Den', visibility: 'public', ownerId: src.a1.id, createdAt: now });
      await src.h.db.insert(channels).values({ id: chan, communityId: comm, name: 'general' });
      await src.h.db.insert(communityMembers).values([{ communityId: comm, userId: src.a1.id, role: 'owner', status: 'active', joinedAt: now }, { communityId: comm, userId: human, role: 'member', status: 'active', joinedAt: now }]);
      await src.h.db.insert(messages).values([
        { id: newId(), channelId: chan, authorId: human, body: 'human in the den', createdAt: now },
        { id: newId(), channelId: chan, authorId: src.a1.id, body: 'agent in the den', createdAt: now },
      ]);
      await migrateAgents(src.h.db, dst.db);
      expect(await dst.db.select().from(users).where(eq(users.id, human))).toHaveLength(0);
      expect(await dst.db.select().from(conversations).where(eq(conversations.id, conv))).toHaveLength(0);
      expect(await dst.db.select().from(communityMembers).where(eq(communityMembers.userId, human))).toHaveLength(0);
      const bodies = (await dst.db.select().from(messages)).map((m) => m.body).sort();
      expect(bodies).toEqual(['agent in the den', 'ally?']);
    } finally { await src.h.close(); await dst.close(); }
  });

  it('gives distinct names to agents that clash with each other and with the target', async () => {
    const src = await source();
    const dst = await testDb();
    try {
      const [a2] = await src.h.db.select().from(users).where(eq(users.username, agentUsername(2)));
      const [a3] = await src.h.db.select().from(users).where(eq(users.username, agentUsername(3)));
      await src.h.db.update(users).set({ username: 'x' }).where(eq(users.id, a2!.id));
      await src.h.db.update(users).set({ username: 'x_2' }).where(eq(users.id, a3!.id));
      await dst.db.insert(users).values(['x', 'x_2', 'nine_curves'].map((username) => ({ id: newId(), username, displayName: username, createdAt: now })));
      const r = await migrateAgents(src.h.db, dst.db);
      const names = (await dst.db.select().from(users).where(eq(users.kind, 'agent'))).map((u) => u.username.toLowerCase());
      expect(names).toHaveLength(50);
      expect(new Set(names).size).toBe(50);
      expect(r.renamedUsers.map((x) => x.from).sort()).toEqual(['nine_curves', 'x', 'x_2']);
    } finally { await src.h.close(); await dst.close(); }
  });

  it('throws on a non-primary-key clash and rolls the whole run back', async () => {
    const src = await source();
    const dst = await testDb();
    try {
      // A different owner already holds the treasury's public key: the wallets insert must fail loudly, not drop the row.
      await dst.db.insert(wallets).values({ ownerId: 'someone', publicKey: (await walletOf(src.h.db, TREASURY))!.publicKey, encryptedSecret: 'x', createdAt: now });
      await expect(migrateAgents(src.h.db, dst.db)).rejects.toThrow();
      expect(await dst.db.select().from(users)).toHaveLength(0);
    } finally { await src.h.close(); await dst.close(); }
  });

  it('reports rows skipped as already present on a rerun', async () => {
    const src = await source();
    const dst = await testDb();
    try {
      await migrateAgents(src.h.db, dst.db);
      const again = await migrateAgents(src.h.db, dst.db);
      expect(again.skipped.users).toBe(50);
    } finally { await src.h.close(); await dst.close(); }
  });

  it('opens the source without migrations and read-only', async () => {
    const calls: unknown[] = [];
    await openSource('postgres://example/world', (async (o: unknown) => { calls.push(o); return {}; }) as any);
    expect(calls).toEqual([{ url: 'postgres://example/world', migrate: false, readOnly: true }]);
  });

  it('createDb with migrate:false leaves a fresh database without a schema', async () => {
    const h = await createDb({ migrate: false });
    try {
      const r: any = await h.db.execute(sql`select to_regclass('public.users') as t`);
      expect((r.rows ?? r)[0].t).toBeNull();
    } finally { await h.close(); }
  });

  it('also renames an agent whose username is reserved in the target', async () => {
    const src = await source();
    const dst = await testDb();
    try {
      const r = await migrateAgents(src.h.db, dst.db, (name) => name === 'nine_curves');
      expect(r.renamedUsers).toEqual([{ from: 'nine_curves', to: 'nine_curves_2' }]);
    } finally { await src.h.close(); await dst.close(); }
  });

  it('copies from an older world whose tables lack columns added since (they take the target defaults)', async () => {
    const src = await source();
    const dst = await testDb();
    try {
      // The live shillex-world database never ran the login and raise migrations.
      await src.h.db.execute(sql`alter table users drop column email`);
      await src.h.db.execute(sql`alter table agents drop column origin, drop column owner_id`);
      const r = await migrateAgents(src.h.db, dst.db);
      expect(r.agents).toBe(50);
      expect(r.rows.users).toBe(50);
      const origins: any = await dst.db.execute(sql`select origin, count(*)::int as n from agents group by origin`);
      expect((origins.rows ?? origins)).toEqual([{ origin: 'wild', n: 50 }]);
      expect((await dst.db.select().from(users).where(eq(users.username, 'nine_curves')))[0]?.email).toBeNull();
    } finally { await src.h.close(); await dst.close(); }
  });
});
