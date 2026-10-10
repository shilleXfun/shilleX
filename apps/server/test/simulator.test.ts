import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { makeTestApp, type TestCtx } from './helpers.ts';
import { seed } from '../src/seed/seed.ts';
import { startSimulator } from '../src/seed/simulator.ts';
import { createPost } from '../src/services/posts.ts';
import { messages, notifications, posts, users } from '../src/db/schema.ts';

let ctx: TestCtx;
beforeAll(async () => { ctx = await makeTestApp(); await seed(ctx.db, { now: ctx.clock.now() }); });
afterAll(() => ctx.close());

const count = async (t: typeof messages | typeof posts) => (await ctx.db.select({ n: sql<number>`count(*)::int` }).from(t))[0]!.n;

describe('demo simulator', () => {
  it('generates activity through real services as demo personas, never as @demo', async () => {
    const sim = startSimulator(ctx.app, { seed: 7, minMs: 1_000_000, maxMs: 1_000_000 }); // timers effectively disabled
    const [m0, p0] = [await count(messages), await count(posts)];
    for (let i = 0; i < 12; i++) { ctx.clock.advance(61_000); await sim.tick(); }
    sim.stop();
    expect((await count(messages)) + (await count(posts))).toBeGreaterThan(m0 + p0);
    expect(ctx.bus.find('typing').length + ctx.bus.find('message:new').length).toBeGreaterThan(0);
    const [demo] = await ctx.db.select().from(users).where(sql`${users.username} = 'demo'`);
    const { n } = (await ctx.db.select({ n: sql<number>`count(*)::int` }).from(messages).where(sql`${messages.authorId} = ${demo!.id} and ${messages.createdAt} > ${ctx.clock.now()}::timestamptz - interval '1 hour'`))[0]!;
    expect(n).toBe(0);
  });

  it('never replies to or notifies real (non-demo) users', async () => {
    const real = await ctx.createUser(`real_${Date.now() % 1e6}`);
    const [realRow] = await ctx.db.select().from(users).where(eq(users.id, real.id));
    // make every "recent public post" candidate a real user's post
    const realPostIds: string[] = [];
    for (let i = 0; i < 40; i++) {
      ctx.clock.advance(1_000);
      realPostIds.push((await createPost(ctx.deps, realRow!, { body: `real user thought number ${i}` })).id);
    }
    const replyCount = async () => (await ctx.db.select({ n: sql<number>`count(*)::int` }).from(posts).where(eq(posts.kind, 'reply')))[0]!.n;
    const sim = startSimulator(ctx.app, { seed: 11, minMs: 1_000_000, maxMs: 1_000_000 });
    const r0 = await replyCount();
    for (let i = 0; i < 80; i++) { ctx.clock.advance(61_000); await sim.tick(); }
    sim.stop();
    expect(await replyCount()).toBeGreaterThan(r0); // the reply path ran (to demo personas' posts)
    const replies = await ctx.db.select().from(posts).where(inArray(posts.parentId, realPostIds));
    expect(replies).toHaveLength(0);
    const notes = await ctx.db.select().from(notifications).where(eq(notifications.userId, real.id));
    expect(notes).toHaveLength(0);
  });

  it('keeps channel chat fresh and answers earlier messages', async () => {
    const start = (await ctx.db.select({ id: messages.id }).from(messages).orderBy(desc(messages.id)).limit(1))[0]!.id;
    const sim = startSimulator(ctx.app, { seed: 21, minMs: 1_000_000, maxMs: 1_000_000 });
    for (let i = 0; i < 120; i++) { ctx.clock.advance(61_000); await sim.tick(); }
    sim.stop();
    const rows = await ctx.db.select().from(messages).where(sql`${messages.channelId} is not null`).orderBy(messages.id);
    const byChannel = new Map<string, typeof rows>();
    for (const m of rows) byChannel.set(m.channelId!, [...(byChannel.get(m.channelId!) ?? []), m]);
    let simulated = 0, replies = 0;
    for (const list of byChannel.values()) list.forEach((m, i) => {
      if (m.id <= start) return;
      simulated++;
      if (m.replyToId) replies++;
      expect(list.slice(Math.max(0, i - 10), i).map((x) => x.body)).not.toContain(m.body);
      if (i > 0 && list.length > 1) expect(m.authorId === list[i - 1]!.authorId && m.id > start && list[i - 1]!.id > start).toBe(false);
    });
    expect(simulated).toBeGreaterThan(20);
    expect(replies).toBeGreaterThan(0);
  });

  it('puts some personas online as soon as it starts', async () => {
    const personas = await ctx.db.select().from(users).where(and(eq(users.isDemo, true), ne(users.username, 'demo')));
    const sim = startSimulator(ctx.app, { seed: 5, minMs: 1_000_000, maxMs: 1_000_000 });
    await sim.ready;
    expect(personas.some((p) => ctx.presence.isOnline(p.id))).toBe(true);
    sim.stop();
  });

  it('leaves no persona virtually online after stop(), even with a tick in flight or ticks after stop', async () => {
    const personas = await ctx.db.select().from(users).where(and(eq(users.isDemo, true), ne(users.username, 'demo')));
    const anyOnline = () => personas.some((p) => ctx.presence.isOnline(p.id));
    const sim = startSimulator(ctx.app, { seed: 3, minMs: 1_000_000, maxMs: 1_000_000 });
    for (let i = 0; i < 20; i++) { ctx.clock.advance(61_000); await sim.tick(); }
    const inFlight = sim.tick();
    sim.stop();
    await inFlight;
    expect(anyOnline()).toBe(false);
    for (let i = 0; i < 30; i++) { ctx.clock.advance(61_000); await sim.tick(); }
    expect(anyOnline()).toBe(false);
  });
});
