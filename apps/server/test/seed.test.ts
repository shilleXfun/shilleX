import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { createDb, type DbHandle } from '../src/db/client.ts';
import { seed, isDatabaseEmpty } from '../src/seed/seed.ts';
import { PERSONAS } from '../src/seed/personas.ts';
import { DEMO_TOKENS } from '../src/seed/world.ts';
import { users, communities, tokens, tokenMentions, conversations, conversationMembers, readMarkers, posts, callUpdates } from '../src/db/schema.ts';
import { isValidSolanaAddress } from '@shillex/shared';

let h: DbHandle; const now = new Date('2026-10-09T12:00:00Z');
beforeAll(async () => { h = await createDb({}); expect(await isDatabaseEmpty(h.db)).toBe(true); await seed(h.db, { now }); });
afterAll(() => h.close());

describe('seed', () => {
  it('has 40 valid unique personas plus @demo, all flagged demo', async () => {
    expect(new Set(PERSONAS.map((p) => p.username)).size).toBe(40);
    expect(PERSONAS.every((p) => /^[a-z0-9_]{3,20}$/.test(p.username))).toBe(true);
    const all = await h.db.select().from(users);
    expect(all).toHaveLength(41);
    expect(all.every((u) => u.isDemo)).toBe(true);
    expect(all.find((u) => u.username === 'demo')).toBeTruthy();
    expect(await isDatabaseEmpty(h.db)).toBe(false);
  });
  it('has every community visibility type', async () => {
    const vis = (await h.db.select().from(communities)).map((c) => c.visibility);
    expect(new Set(vis)).toEqual(new Set(['public', 'private', 'invite']));
  });
  it('demo tokens are labeled demo with valid-format mints; two are promoted', async () => {
    const rows = await h.db.select().from(tokens);
    expect(rows).toHaveLength(DEMO_TOKENS.length);
    expect(rows.every((t) => t.source === 'demo' && isValidSolanaAddress(t.mint))).toBe(true);
    expect(rows.filter((t) => t.promoted).map((t) => t.symbol).sort()).toEqual(['GLOW', 'YAWN']);
  });
  it('private-only tokens never have public mentions', async () => {
    for (const sym of ['SECRT', 'VAULTY']) {
      const mint = DEMO_TOKENS.find((t) => t.symbol === sym)!.mint;
      const pub = await h.db.select().from(tokenMentions).where(and(eq(tokenMentions.mint, mint), eq(tokenMentions.isPublic, true)));
      expect(pub).toHaveLength(0);
      const any = await h.db.select().from(tokenMentions).where(eq(tokenMentions.mint, mint));
      expect(any.length).toBeGreaterThan(0);
    }
  });
  it('gives @demo DMs, a group, joined communities with unread, a feed and call updates to look at', async () => {
    const [demo] = await h.db.select().from(users).where(eq(users.username, 'demo'));
    const convs = await h.db.select({ k: conversations.kind }).from(conversationMembers).innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId)).where(eq(conversationMembers.userId, demo!.id));
    expect(convs.filter((c) => c.k === 'dm').length).toBeGreaterThanOrEqual(4);
    expect(convs.filter((c) => c.k === 'group').length).toBeGreaterThanOrEqual(2);
    expect((await h.db.select().from(readMarkers).where(eq(readMarkers.userId, demo!.id))).length).toBeGreaterThan(0);
    const { n } = (await h.db.select({ n: sql<number>`count(*)::int` }).from(posts))[0]!;
    expect(n).toBeGreaterThanOrEqual(250);
    expect((await h.db.select().from(callUpdates)).length).toBeGreaterThanOrEqual(10);
  });
  it('is deterministic and re-runnable', async () => {
    const before = (await h.db.select({ u: users.username }).from(users)).map((r) => r.u).sort();
    await seed(h.db, { now });
    const after = (await h.db.select({ u: users.username }).from(users)).map((r) => r.u).sort();
    expect(after).toEqual(before);
  });
});
