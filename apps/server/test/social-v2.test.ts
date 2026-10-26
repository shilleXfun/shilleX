import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { worldTestCtx } from './world-helpers.ts';
import { agentMemories, agentReactions, arcs } from '../src/db/schema.ts';
import { MAX_OPEN, WAR_DEPTH, queueComeback, queueReaction, situationFor } from '../src/agents/reactions.ts';
import { RUNS, arcPass } from '../src/agents/arcs.ts';
import { adjustAffinity } from '../src/agents/state.ts';
import { reasonAs } from '../src/agents/minds.ts';

let w: Awaited<ReturnType<typeof worldTestCtx>>;
beforeEach(async () => { w = await worldTestCtx(); });
afterEach(async () => { await w.t.close(); });

describe('reactions', () => {
  it('queues at most a few per agent, never the same event twice', async () => {
    const a = w.agents[0]!;
    const now = w.t.clock.now();
    expect(await queueReaction(w.t.db, { agentId: a.id, kind: 'post', format: 'cope', event: 'your call on $X closed at -8%' }, now)).toBe(true);
    expect(await queueReaction(w.t.db, { agentId: a.id, kind: 'post', format: 'cope', event: 'your call on $X closed at -8%' }, now)).toBe(false);
    for (let i = 0; i < MAX_OPEN + 2; i++) await queueReaction(w.t.db, { agentId: a.id, kind: 'post', format: 'shitpost', event: `thing ${i}` }, now);
    expect(await w.t.db.select().from(agentReactions).where(eq(agentReactions.agentId, a.id))).toHaveLength(MAX_OPEN);
    expect(situationFor('reply', 'callout')).toBe('reply_disagree');
    expect(situationFor('reply', 'reply_guy')).toBe('reply_agree');
    expect(situationFor('post', 'callout')).toBe('idle');
  });

  it('turns a reply between rivals into a war that stops at its cap, and leaves neutral pairs alone', async () => {
    const [a, b, c] = [w.agents[0]!, w.agents[1]!, w.agents[2]!];
    const now = w.t.clock.now();
    await adjustAffinity(w.t.db, b.id, a.id, -0.6, now, 'sold on me');
    expect(await queueComeback(w.t.db, { fromId: a.id, fromName: a.username, toId: b.id, replyId: 'p1', depth: 0 }, now)).toBe('queued');
    const [r] = await w.t.db.select().from(agentReactions).where(eq(agentReactions.agentId, b.id));
    expect(r).toMatchObject({ kind: 'reply', format: 'callout', postId: 'p1', depth: 1 });
    expect(await queueComeback(w.t.db, { fromId: a.id, fromName: a.username, toId: b.id, replyId: 'p9', depth: WAR_DEPTH - 1 }, now)).toBe('ended');
    expect(await queueComeback(w.t.db, { fromId: a.id, fromName: a.username, toId: c.id, replyId: 'p2', depth: 0 }, now)).toBe('none');
  });

  it('tells a ledger reason from either side', () => {
    expect(reasonAs('rugged $X while i held it', 'you')).toBe('rugged $X while you held it');
    expect(reasonAs('never paid back what i lent it, my loss', 'they')).toBe('never paid back what they lent it, their loss');
  });
});

describe('the arc director', () => {
  it('opens a feud between two agents who hate each other, queues its opening, and ends it from the numbers', async () => {
    const [a, b] = [w.agents[0]!, w.agents[1]!];
    const t0 = w.t.clock.now();
    await adjustAffinity(w.t.db, a.id, b.id, -0.7, t0, 'sold on me');
    await adjustAffinity(w.t.db, b.id, a.id, -0.7, t0, 'called me a clown');
    expect(await arcPass(w.t.db, t0)).toMatchObject({ opened: 1 });
    const [arc] = await w.t.db.select().from(arcs);
    expect(arc).toMatchObject({ kind: 'feud', stage: 0, resolvedAt: null });
    expect(new Set(arc!.cast)).toEqual(new Set([a.id, b.id]));
    expect((await w.t.db.select().from(agentReactions).where(eq(agentReactions.arcId, arc!.id))).length).toBeGreaterThan(0);
    // Nobody is in two arcs at once, and the same pair is not reopened while it runs.
    expect(await arcPass(w.t.db, t0)).toMatchObject({ opened: 0 });
    // Still hostile when time runs out: a cold war, remembered by both.
    const end = new Date(t0.getTime() + RUNS.feud + 1);
    expect(await arcPass(w.t.db, end)).toMatchObject({ resolved: 1 });
    const [done] = await w.t.db.select().from(arcs);
    expect(done).toMatchObject({ outcome: 'cold war' });
    expect((await w.t.db.select().from(agentMemories).where(eq(agentMemories.sourceId, `arc:${arc!.id}`))).length).toBe(2);
  });
});
