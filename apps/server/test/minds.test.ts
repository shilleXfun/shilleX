import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { worldTestCtx } from './world-helpers.ts';
import { agentAffinity, agentCommitments, agentGoals, realPositions } from '../src/db/schema.ts';
import { rememberEvent } from '../src/agents/state.ts';
import { breakPromise, openPromise, persistGoal, promiseStop, recallLines, repeats, similarity, trustOf, GOAL_MIN_MS } from '../src/agents/minds.ts';
import { trustWeight } from '../src/agents/depth/trust.ts';
import { stubbornness, trustTilt } from '../src/world/real-desk.ts';
import { reputationScore } from '../src/agents/depth/reputation.ts';
import type { Candidate } from '../src/agents/types.ts';
import { runTool } from '../src/world/tools.ts';

let w: Awaited<ReturnType<typeof worldTestCtx>>;
beforeEach(async () => { w = await worldTestCtx(); });
afterEach(async () => { await w.t.close(); });
const T0 = new Date('2026-10-20T15:00:00Z');

describe('persistent minds', () => {
  it('remembers a rug the next day and no longer trusts whoever did it', async () => {
    const [me, them] = [w.agents[0]!, w.agents[1]!];
    await rememberEvent(w.t.db, me.id, 'got_rugged', { byId: them.id, mint: 'MINT1', symbol: 'MOTH' }, T0);
    // Fifty newer events push it out of the short window; the lasting memory stays.
    for (let i = 0; i < 55; i++) await rememberEvent(w.t.db, me.id, 'chatted', { i }, new Date(T0.getTime() + i * 60_000));
    const lines = await recallLines(w.t.db, me.id, { aboutId: them.id }, new Date('2026-10-21T10:00:00Z'));
    expect(lines).toEqual([`- yesterday: @${them.username} dumped $MOTH on me`]);
    expect((await trustOf(w.t.db, me.id))[them.id]).toBe(-0.5);
  });

  it('a broken stop costs trust with the agents in the same coin, and they then avoid what it holds', async () => {
    const [liar, holder, stranger] = [w.agents[0]!, w.agents[1]!, w.agents[2]!];
    await w.t.db.insert(realPositions).values([
      { agentId: liar.id, address: 'ADDR', symbol: 'SABLE', qty: 10, costUsd: 100, openedAt: T0, updatedAt: T0 },
      { agentId: holder.id, address: 'ADDR', symbol: 'SABLE', qty: 5, costUsd: 50, openedAt: T0, updatedAt: T0 },
    ]);
    await promiseStop(w.t.db, { agentId: liar.id, thesisId: 'th1', asset: 'ADDR', symbol: 'SABLE', stopPct: -0.12, dueAt: new Date(T0.getTime() + 86_400_000), now: T0 });
    const witnesses = await breakPromise(w.t.db, (await openPromise(w.t.db, 'th1'))!, -0.15, T0);
    expect(witnesses).toEqual([holder.id]);
    expect((await openPromise(w.t.db, 'th1'))!.status).toBe('broken');
    const trust = await trustOf(w.t.db, holder.id);
    expect(trust[liar.id]).toBe(-0.25);
    expect(await trustOf(w.t.db, stranger.id)).toEqual({});
    // Twice burned: below the line where it stops following the liar into coins and stops lending to it.
    await w.t.db.update(agentAffinity).set({ trust: -0.5 }).where(and(eq(agentAffinity.agentId, holder.id), eq(agentAffinity.otherId, liar.id)));
    const t2 = await trustOf(w.t.db, holder.id);
    expect(trustTilt([liar.id], t2).w).toBeLessThan(1);
    const lend = { kind: 'lend', target: { userId: liar.id }, score: 1, reason: '' } as unknown as Candidate;
    expect(trustWeight(lend, t2, () => undefined)).toBeLessThan(0.2);
    expect((await recallLines(w.t.db, holder.id, { aboutId: liar.id }, T0))[0]).toContain(`@${liar.username} promised`);
  });

  it('counts a broken promise against reputation more than a lost call', () => {
    const base = { rugs: 0, honestCalls: 0, wrongCalls: 0, hypocrisy: 0, repaid: 0, defaulted: 0, lent: 0 };
    expect(reputationScore({ ...base, broken: 1 })).toBeLessThan(reputationScore({ ...base, lost: 3 }));
    expect(reputationScore({ ...base, lost: 1 })).toBeLessThan(0);
    expect(reputationScore({ ...base, won: 1 })).toBeGreaterThan(0);
  });

  it('keeps a goal for hours unless something more pressing comes, and records how it ended', async () => {
    const a = w.agents[0]!;
    const none = { targetId: null, mint: null, symbol: null };
    await persistGoal(w.t.db, a.id, { kind: 'famous', why: 'loves an audience', ...none }, T0);
    const held = await persistGoal(w.t.db, a.id, { kind: 'explore', why: 'is curious', ...none }, new Date(T0.getTime() + 60_000));
    expect(held.kind).toBe('famous');
    const urgent = await persistGoal(w.t.db, a.id, { kind: 'recover', why: 'is down to 0.01 SOL', ...none }, new Date(T0.getTime() + 120_000));
    expect(urgent.kind).toBe('recover');
    const out = await persistGoal(w.t.db, a.id, { kind: 'explore', why: 'is curious', ...none }, new Date(T0.getTime() + 180_000));
    expect(out.kind).toBe('explore');
    const rows = await w.t.db.select().from(agentGoals).where(eq(agentGoals.agentId, a.id)).orderBy(agentGoals.startedAt);
    expect(rows.map((r) => [r.kind, r.outcome])).toEqual([['famous', 'dropped'], ['recover', 'achieved'], ['explore', null]]);
    expect(GOAL_MIN_MS).toBeGreaterThan(60_000);
  });

  it('refuses to say the same thing again in the same words, but not the same template about another coin', async () => {
    expect(similarity('everyone is chasing $SABLE. noted', 'everyone is chasing $SABLE noted!!')).toBe(1);
    expect(similarity('Stopped out of $MOTH on my paper desk at -12%. The stop is the stop.', 'Stopped out of $SABLE on my paper desk at -9%. The stop is the stop.')).toBeLessThan(0.7);
    const a = w.agents[0]!;
    const first = await runTool(await w.ctxFor(a), 'post', { body: 'hm. listening, not posting' });
    expect(first.ok).toBe(true);
    const again = await runTool(await w.ctxFor(a), 'post', { body: 'Hm, listening. Not posting.' });
    expect(again).toMatchObject({ ok: false, result: { code: 'REPEATED' } });
    expect(await repeats(w.t.db, a.id, 'a brand new thought about liquidity leaving the pool', w.t.clock.now())).toBeNull();
  });

  it('makes greedy risk-takers likelier to hold through a stop than careful ones', () => {
    const t = { risk: 0.5, chattiness: 0.5, loyalty: 0.5, pettiness: 0.5, greed: 0.5, humor: 0.5, curiosity: 0.5 };
    expect(stubbornness({ ...t, greed: 0.9, risk: 0.9, pettiness: 0.8 })).toBeGreaterThan(stubbornness({ ...t, greed: 0.1, risk: 0.2, pettiness: 0.1 }));
    expect(stubbornness({ ...t, greed: 1, risk: 1, pettiness: 1 })).toBeLessThanOrEqual(0.6);
  });
});

describe('commitments table', () => {
  it('holds one stop promise per thesis', async () => {
    const a = w.agents[0]!;
    const p = { agentId: a.id, thesisId: 'thX', asset: 'A', symbol: 'X', stopPct: -0.1, dueAt: T0, now: T0 };
    await promiseStop(w.t.db, p);
    await promiseStop(w.t.db, p);
    expect(await w.t.db.select().from(agentCommitments).where(eq(agentCommitments.thesisId, 'thX'))).toHaveLength(1);
  });
});
