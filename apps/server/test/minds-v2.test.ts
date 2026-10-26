import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { worldTestCtx } from './world-helpers.ts';
import { agentPersonas, debts, posts, realTrades, relationshipEvents } from '../src/db/schema.ts';
import { ungrounded } from '../src/agents/grounding.ts';
import { assignJobs, personaPass, seedVoice } from '../src/agents/personas.ts';
import { personaWeight } from '../src/agents/depth/persona.ts';
import { adjustAffinity } from '../src/agents/state.ts';
import { pairHistory } from '../src/agents/minds.ts';
import { newId } from '../src/lib/ids.ts';
import { runTool } from '../src/world/tools.ts';

let w: Awaited<ReturnType<typeof worldTestCtx>>;
beforeEach(async () => { w = await worldTestCtx(); });
afterEach(async () => { await w.t.close(); });

describe('the publish gate', () => {
  it('refuses numbers in words, a life outside Shillex, and debts or trades that are not on record', async () => {
    const [a, b] = [w.agents[0]!, w.agents[1]!];
    const now = w.t.clock.now();
    expect(await ungrounded(w.t.db, a.id, 'Entry was set at zero point zero zero seven four six', now)).toMatch(/digits/);
    expect(await ungrounded(w.t.db, a.id, `@${b.username} still owes me twenty solana from the spring pruning`, now)).toMatch(/digits|debt/);
    expect(await ungrounded(w.t.db, a.id, 'my physics classes taught me this chart is a lie', now)).toMatch(/life outside Shillex/);
    expect(await ungrounded(w.t.db, a.id, `@${b.username} owes me and everyone knows it`, now)).toMatch(/no such debt/);
    await w.t.db.insert(debts).values({ id: newId(), lenderId: a.id, borrowerId: b.id, lamports: 1_000_000, signature: 'x', createdAt: now });
    expect(await ungrounded(w.t.db, a.id, `@${b.username} owes me and everyone knows it`, now)).toBeNull();
    expect(await ungrounded(w.t.db, a.id, 'i just bought $BONK at the bottom', now)).toMatch(/no trade of it/);
    await w.t.db.insert(realTrades).values({ id: newId(), agentId: a.id, address: 'bonk', symbol: 'BONK', side: 'buy', qty: 1, priceUsd: 1, usd: 1, feeUsd: 0, at: now } as never);
    expect(await ungrounded(w.t.db, a.id, 'i just bought $BONK at the bottom', now)).toBeNull();
  });

  it('refuses a line said word for word, or nearly, by anyone, and lets a short one through unless it is the same', async () => {
    const [a, b] = [w.agents[0]!, w.agents[1]!];
    const ctx = await w.ctxFor(b);
    expect((await runTool(ctx, 'post', { body: '@dace_lowe put your SOL where your posts are. $NOONYX higher in an hour' })).ok).toBe(true);
    const actx = await w.ctxFor(a);
    expect((await runTool(actx, 'post', { body: '@dace_lowe put your SOL where your posts are. $NOONYX higher in an hour' })).result).toMatchObject({ code: 'REPEATED' });
    expect((await runTool(actx, 'post', { body: 'Put your SOL where your posts are, @dace_lowe: $NOONYX higher in an hour.' })).result).toMatchObject({ code: 'REPEATED' });
    expect((await runTool(actx, 'post', { body: 'gm' })).ok).toBe(true);
    expect((await runTool(await w.ctxFor(w.agents[2]!), 'post', { body: 'gm' })).result).toMatchObject({ code: 'REPEATED' });
    expect(await w.t.db.select().from(posts).where(eq(posts.authorId, a.id))).toHaveLength(1);
  });
});

describe('jobs and personas', () => {
  it('gives every house agent a job by quota, and only devs launch', async () => {
    const jobs = await assignJobs(w.t.db);
    const count = (j: string) => [...jobs.values()].filter((x) => x === j).length;
    expect(jobs.size).toBe(w.agents.length);
    expect(count('builder')).toBe(Math.round(0.1 * w.agents.length));
    expect(count('dev')).toBe(Math.round(0.1 * w.agents.length));
    expect(count('social')).toBeGreaterThan(w.agents.length * 0.4);
    expect(personaWeight('social', 1, { kind: 'launch', score: 1, reason: 't' })).toBe(0);
    expect(personaWeight('dev', 1, { kind: 'launch', score: 1, reason: 't' })).toBeGreaterThan(1);
    expect(personaWeight('lurker', seedVoice('x', 'lurker').postRate, { kind: 'post', score: 1, reason: 't' })).toBeLessThan(0.1);
  });

  it('seeds a persona for everyone without a model, with voices that differ', async () => {
    const r = await personaPass({ db: w.t.db, chain: w.chain, now: w.t.clock.now, brain: null, budget: null });
    expect(r).toEqual({ seeded: w.agents.length, written: 0 });
    const rows = await w.t.db.select().from(agentPersonas);
    expect(rows.every((p) => p.background.length > 10 && p.voice.neverWords.includes('ledger'))).toBe(true);
    expect(new Set(rows.map((p) => `${p.voice.casing}|${p.voice.length}|${p.voice.humor}|${p.voice.temper}|${p.voice.images}`)).size).toBeGreaterThan(rows.length * 0.9);
    expect(seedVoice('a1', 'social')).toEqual(seedVoice('a1', 'social'));
  });

  it('keeps why a feeling moved, both ways, and skips the trivial ones', async () => {
    const [a, b] = [w.agents[0]!, w.agents[1]!];
    const now = w.t.clock.now();
    await adjustAffinity(w.t.db, a.id, b.id, -0.5, now, 'sold on me at the top');
    await adjustAffinity(w.t.db, b.id, a.id, 0.01, now, 'liked a post');
    await adjustAffinity(w.t.db, b.id, a.id, 0.2, now, 'paid back what it owed me');
    expect((await pairHistory(w.t.db, a.id, b.id)).map((h) => [h.mine, h.reason])).toEqual(expect.arrayContaining([[true, 'sold on me at the top'], [false, 'paid back what it owed me']]));
    expect(await w.t.db.select().from(relationshipEvents)).toHaveLength(2);
  });
});
