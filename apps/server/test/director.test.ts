import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { worldTestCtx } from './world-helpers.ts';
import { agentDecisions, agentReactions, posts, wallets } from '../src/db/schema.ts';
import { FakeBrain, fakeReply } from '../src/world/brain.ts';
import { Budget } from '../src/world/budget.ts';
import { mulberry32 } from '../src/seed/rng.ts';
import { createDirector, pickAgents } from '../src/agents/director.ts';
import { FREE_KINDS } from '../src/agents/engine.ts';

let w: Awaited<ReturnType<typeof worldTestCtx>>;
beforeEach(async () => { w = await worldTestCtx(); await w.t.db.update(wallets).set({ fundedAt: w.t.clock.now() }); });
afterEach(async () => { await w.t.close(); });

const directorWith = (brain: FakeBrain) => createDirector({
  app: w.t.app, db: w.t.db, chain: w.chain, events: w.events, worldKey: w.key, now: w.t.clock.now, rng: mulberry32(3),
  brain, budget: new Budget(w.t.db, 5, () => new Date('2026-10-27T23:00:00Z'), { hardStop: true }), postsPerHour: 10,
});

describe('the director', () => {
  it('wakes an agent that chooses to post, says it in its own words and keeps the decision with its reason', async () => {
    const a = w.agents[0]!;
    const brain = new FakeBrain(() => fakeReply.tools({ name: 'post', input: { text: 'nobody here reads a chart before aping into it', why: 'the feed is all noise today' } }));
    expect(await directorWith(brain).wake(a.id)).toMatchObject({ tool: 'post', ok: true });
    // It was offered tools, not a genre: idle and post at least.
    expect(brain.calls[0]!.tools.map((t) => t.name)).toEqual(expect.arrayContaining(['idle', 'post', 'collab_with']));
    expect((await w.t.db.select().from(posts).where(eq(posts.authorId, a.id))).map((p) => p.body)).toContain('nobody here reads a chart before aping into it');
    expect((await w.t.db.select().from(agentDecisions).where(eq(agentDecisions.agentId, a.id)))[0]).toMatchObject({ tool: 'post', ok: true, why: 'the feed is all noise today' });
  });

  it('turns back a stock line once with the reason, and keeps what it chose instead', async () => {
    const a = w.agents[1]!;
    const replies = [fakeReply.tools({ name: 'post', input: { text: 'agreed', why: 'x' } }), fakeReply.tools({ name: 'idle', input: { why: 'nothing worth saying after all' } })];
    const brain = new FakeBrain((_r, i) => replies[i]!);
    expect(await directorWith(brain).wake(a.id)).toMatchObject({ tool: 'idle', ok: true });
    const retry = brain.calls[1]!.messages.at(-1)!.content as { type: string; is_error?: boolean }[];
    expect(retry[0]).toMatchObject({ type: 'tool_result', is_error: true });
    expect(await w.t.db.select().from(posts).where(eq(posts.authorId, a.id))).toHaveLength(0);
  });

  it('wakes first the agents something happened to, and leaves an agent it just woke alone', async () => {
    const [a, b] = w.agents;
    const now = w.t.clock.now();
    await w.t.db.insert(agentReactions).values({ id: 'r1', agentId: b!.id, kind: 'post', format: 'callout', event: '@x called you out', createdAt: now, expiresAt: new Date(now.getTime() + 3_600_000) });
    const first = await pickAgents({ db: w.t.db, now: w.t.clock.now }, 2, mulberry32(1), new Map());
    expect(first[0]).toBe(b!.id);
    expect(await pickAgents({ db: w.t.db, now: w.t.clock.now }, 2, mulberry32(1), new Map([[b!.id, now.getTime()]]))).not.toContain(b!.id);
    void a;
  });

  it('leaves the engine only the moves that need no thought', () => {
    expect([...FREE_KINDS].sort()).toEqual(['follow', 'idle', 'react', 'sell', 'unfollow']);
  });
});
