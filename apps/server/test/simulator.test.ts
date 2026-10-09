import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { makeTestApp, type TestCtx } from './helpers.ts';
import { seed } from '../src/seed/seed.ts';
import { startSimulator } from '../src/seed/simulator.ts';
import { messages, posts, users } from '../src/db/schema.ts';

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
});
