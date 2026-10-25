import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { desc, eq } from 'drizzle-orm';
import { worldTestCtx } from './world-helpers.ts';
import { posts, wallets } from '../src/db/schema.ts';
import { FakeBrain, fakeReply } from '../src/world/brain.ts';
import { Budget } from '../src/world/budget.ts';
import { angleFor, claimsTrade, createVoice, grounded } from '../src/agents/voice.ts';
import { act } from '../src/agents/act.ts';
import { perceive } from '../src/agents/perceive.ts';
import { mulberry32 } from '../src/seed/rng.ts';
import type { EngineDeps } from '../src/agents/engine.ts';
import type { Candidate } from '../src/agents/types.ts';

let w: Awaited<ReturnType<typeof worldTestCtx>>;
beforeEach(async () => { w = await worldTestCtx(); await w.t.db.update(wallets).set({ fundedAt: w.t.clock.now() }); });
afterEach(async () => { await w.t.close(); });

const deps = (reply: string, over: Partial<EngineDeps> = {}) => {
  const brain = new FakeBrain(() => fakeReply.end(reply));
  const budget = new Budget(w.t.db, 1, () => new Date('2026-10-25T23:00:00Z'), { hardStop: true });
  const d: EngineDeps = { app: w.t.app, db: w.t.db, chain: w.chain, events: w.events, worldKey: w.key, now: w.t.clock.now, rng: mulberry32(7), ...over };
  return { brain, d: { ...d, voice: createVoice({ db: w.t.db, brain, budget, now: w.t.clock.now, perHour: 100 }) } };
};
const post: Candidate = { kind: 'post', score: 1, reason: 'test', situation: 'market_take' };
const lastPost = async (authorId: string) => (await w.t.db.select({ body: posts.body }).from(posts).where(eq(posts.authorId, authorId)).orderBy(desc(posts.createdAt)).limit(1))[0]?.body ?? null;

describe('the agents\' own words', () => {
  it('lets through only numbers that are in the facts', () => {
    const facts = 'MARKET NOW: $SOL 152.31, +4% in the hour; YOUR PAPER BOOK: $BONK -12% after 6 h (stop -15%)';
    expect(grounded('$BONK is -12% and my stop is -15%: still in.', facts)).toBe(true);
    expect(grounded('$SOL at 152.31, up 4% in the hour.', facts)).toBe(true);
    expect(grounded('I lost 10% on the 3:00 PM take.', facts)).toBe(false);
    expect(grounded('No numbers, just a read on @rewyn and $BONK2.', facts)).toBe(true);
  });
  it('drops lines that announce a trade the post is not making', () => {
    // The live lines of 2026-10-25 that promised trades no post makes.
    expect(claimsTrade('$PENGU looks quiet; I’ll slip a paper buy desk before the tape widens.', false)).toBe(true);
    expect(claimsTrade('sellers are taking control, so I’m flipping to paper short before the dip deepens.', false)).toBe(true);
    expect(claimsTrade('loading paper on $PUMP while the fire’s still hot.', false)).toBe(true);
    expect(claimsTrade('i’ll sell into strength if it hits +40%.', false)).toBe(true);
    expect(claimsTrade('i’ll sell into strength if it hits my +40% target.', true)).toBe(false);
    expect(claimsTrade('$GTA did $2.1M this hour on a 6 hour old pool. Who is still buying that?', false)).toBe(false);
    expect(claimsTrade('In short, nobody here reads the liquidity.', false)).toBe(false);
  });
  it('gives each turn its own kind of post, and only kinds the agent has material for', () => {
    const seen = new Set(Array.from({ length: 60 }, (_, n) => angleFor(`turn-${n}`, { holds: false, remembers: false, others: false })));
    expect(seen.size).toBeGreaterThanOrEqual(4);
    expect([...seen].some((a) => a.includes('paper position') || a.includes('REMEMBER') || a.includes('ALREADY SAID'))).toBe(false);
    expect(angleFor('turn-1', { holds: true, remembers: true, others: true })).toBe(angleFor('turn-1', { holds: true, remembers: true, others: true }));
  });
  it('posts what the model wrote from the agent\'s state, with the facts in the prompt', async () => {
    const a = w.agents[0]!;
    const { brain, d } = deps('Nothing on my book yet, and I am not chasing $SABLE after that run. I want to see who sells first.');
    const r = await act(d, await perceive(d, a.id), post);
    expect(r.ok).toBe(true);
    expect(await lastPost(a.id)).toBe('Nothing on my book yet, and I am not chasing $SABLE after that run. I want to see who sells first.');
    expect(JSON.stringify(brain.calls[0]!.messages)).toContain('this is a market take');
  });

  it('says nothing when the model has nothing to add', async () => {
    const a = w.agents[1]!;
    const { d } = deps('SKIP');
    const r = await act(d, await perceive(d, a.id), post);
    expect(r.ok).toBe(false);
    expect(await lastPost(a.id)).toBeNull();
  });

  it('goes back to the engine line once the quota for the hour is used', async () => {
    const a = w.agents[2]!;
    const brain = new FakeBrain(() => fakeReply.end('a model line about $SABLE liquidity leaving the pool'));
    const budget = new Budget(w.t.db, 1, () => new Date('2026-10-25T23:00:00Z'), { hardStop: true });
    const base: EngineDeps = { app: w.t.app, db: w.t.db, chain: w.chain, events: w.events, worldKey: w.key, now: w.t.clock.now, rng: mulberry32(7) };
    const d = { ...base, voice: createVoice({ db: w.t.db, brain, budget, now: w.t.clock.now, perHour: 1 }) };
    await act(d, await perceive(d, a.id), post);
    w.t.clock.advance(60_000);
    await act(d, await perceive(d, a.id), { ...post, situation: 'idle' });
    expect(brain.calls).toHaveLength(1);
  });
});
