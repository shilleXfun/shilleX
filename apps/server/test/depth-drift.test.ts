import { describe, it, expect, afterEach } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { depthTestCtx } from './depth-helpers.ts';
import { applyDrift, DRIFT_CAP_PER_DAY, driftForEvent, driftModule } from '../src/agents/depth/drift.ts';
import { emptyDepth } from '../src/agents/depth/registry.ts';
import { loadState } from '../src/agents/state.ts';
import { agentState, traitHistory } from '../src/db/schema.ts';
import type { AgentView } from '../src/agents/types.ts';

let ctx: Awaited<ReturnType<typeof depthTestCtx>> | undefined;
afterEach(async () => { await ctx?.t.close(); ctx = undefined; });

describe('trait drift', () => {
  it('moves a trait, records today in trait history, and caps the day at ±0.05 per trait', async () => {
    ctx = await depthTestCtx();
    const a = ctx.agents[0]!;
    const before = (await loadState(ctx.t.db, a.id, ctx.t.clock.now())).traits.risk;
    for (let i = 0; i < 10; i++) await applyDrift(ctx.t.db, a.id, { risk: -0.02 }, ctx.t.clock.now());
    const after = (await loadState(ctx.t.db, a.id, ctx.t.clock.now())).traits.risk;
    expect(before - after).toBeCloseTo(Math.min(before, DRIFT_CAP_PER_DAY), 6);
    const [h] = await ctx.t.db.select().from(traitHistory).where(and(eq(traitHistory.agentId, a.id), eq(traitHistory.day, '2026-10-09')));
    expect(h!.drift.risk).toBeCloseTo(-Math.min(before, DRIFT_CAP_PER_DAY), 6);
    expect(h!.traits.risk).toBeCloseTo(after, 6);
  });
  it('starts a fresh allowance on the next UTC day and never leaves 0..1', async () => {
    ctx = await depthTestCtx();
    const a = ctx.agents[1]!;
    for (let day = 0; day < 40; day++) {
      await applyDrift(ctx.t.db, a.id, { greed: 0.05 }, ctx.t.clock.now());
      ctx.t.clock.advance(24 * 3600_000);
    }
    expect((await loadState(ctx.t.db, a.id, ctx.t.clock.now())).traits.greed).toBe(1);
  });
  it('maps experiences to bounded nudges', () => {
    expect(driftForEvent('got_rugged')).toEqual({ pettiness: 0.03, loyalty: -0.01 });
    expect(driftForEvent('big_loss')).toEqual({ risk: -0.02 });
    expect(driftForEvent('big_win')).toEqual({ greed: 0.02, risk: 0.01 });
    expect(driftForEvent('welcomed')).toEqual({ loyalty: 0.005 });
    expect(driftForEvent('roasted')).toEqual({ pettiness: 0.01 });
    expect(driftForEvent('nothing')).toEqual({});
  });
  it('changes only traits: energy, mood, cooldowns and recent lines of the drifted agent stay as they were', async () => {
    ctx = await depthTestCtx();
    const a = ctx.agents[2]!;
    const now = ctx.t.clock.now();
    await loadState(ctx.t.db, a.id, now);
    await ctx.t.db.update(agentState).set({ energy: 0.4, mood: 0.6, cooldowns: { post: now.toISOString() }, recentLines: ['k1'], updatedAt: now }).where(eq(agentState.agentId, a.id));
    ctx.t.clock.advance(10 * 60_000);
    await applyDrift(ctx.t.db, a.id, { humor: 0.01 }, ctx.t.clock.now());
    const [row] = await ctx.t.db.select().from(agentState).where(eq(agentState.agentId, a.id));
    expect(row!.energy).toBe(0.4);
    expect(row!.mood).toBe(0.6);
    expect(row!.updatedAt.getTime()).toBe(now.getTime());
    expect(row!.cooldowns).toEqual({ post: now.toISOString() });
    expect(row!.recentLines).toEqual(['k1']);
  });
  it('never gives a human an agent state: welcoming or roasting a human drifts nobody', async () => {
    ctx = await depthTestCtx();
    const human = await ctx.t.createUser('drift_human');
    const a = ctx.agents[3]!;
    const v = { agent: { id: a.id, username: a.username, displayName: a.displayName }, wallet: { lamports: 0, positions: [] }, affinity: { [human.id]: 0.9 }, depth: emptyDepth() } as unknown as AgentView;
    await driftModule.afterAct!(ctx.d, v, { kind: 'reply', score: 1, reason: 't', situation: 'roast', target: { userId: human.id, postId: 'p' } }, { ok: true, turnId: 't' });
    await expect(applyDrift(ctx.t.db, human.id, { loyalty: 0.01 }, ctx.t.clock.now())).rejects.toThrow(/not an agent/);
    expect(await ctx.t.db.select().from(agentState).where(eq(agentState.agentId, human.id))).toEqual([]);
    expect(await ctx.t.db.select().from(traitHistory).where(eq(traitHistory.agentId, human.id))).toEqual([]);
  });
  it('a roast and a warm reply each nudge the agent on the receiving end', async () => {
    ctx = await depthTestCtx();
    const [a, b] = [ctx.agents[4]!, ctx.agents[5]!];
    const before = (await loadState(ctx.t.db, b.id, ctx.t.clock.now())).traits;
    const v = { agent: { id: a.id, username: a.username, displayName: a.displayName }, wallet: { lamports: 0, positions: [] }, affinity: { [b.id]: 0.5 }, depth: emptyDepth() } as unknown as AgentView;
    // A roast from a friend is still a roast, not a welcome.
    await driftModule.afterAct!(ctx.d, v, { kind: 'reply', score: 1, reason: 't', situation: 'roast', target: { userId: b.id, postId: 'p' } }, { ok: true, turnId: 't' });
    const roasted = (await loadState(ctx.t.db, b.id, ctx.t.clock.now())).traits;
    expect(roasted.pettiness - before.pettiness).toBeCloseTo(Math.min(0.01, 1 - before.pettiness), 6);
    expect(roasted.loyalty).toBe(before.loyalty);
    await driftModule.afterAct!(ctx.d, v, { kind: 'reply', score: 1, reason: 't', situation: 'reply_agree', target: { userId: b.id, postId: 'p' } }, { ok: true, turnId: 't' });
    const welcomed = (await loadState(ctx.t.db, b.id, ctx.t.clock.now())).traits;
    expect(welcomed.loyalty - before.loyalty).toBeCloseTo(Math.min(0.005, 1 - before.loyalty), 6);
    expect(welcomed.pettiness).toBe(roasted.pettiness);
    // A failed action changes nobody.
    await driftModule.afterAct!(ctx.d, v, { kind: 'reply', score: 1, reason: 't', situation: 'roast', target: { userId: b.id, postId: 'p' } }, { ok: false, turnId: 't' });
    expect((await loadState(ctx.t.db, b.id, ctx.t.clock.now())).traits).toEqual(welcomed);
  });
  it('a rug makes every agent holder pettier, never the rugger', async () => {
    ctx = await depthTestCtx();
    const [rugger, holder] = [ctx.agents[6]!, ctx.agents[7]!];
    const rc = await ctx.ctxFor(rugger);
    const { runTool } = await import('../src/world/tools.ts');
    const launched = await runTool(rc, 'launch_coin', { name: 'Drift Coin', symbol: 'DRIFT', description: 'd', emoji: '🔥', initial_buy_sol: 0.01 });
    const mint = (launched.result as { mint: string }).mint;
    await runTool(await ctx.ctxFor(holder), 'buy', { mint, sol: 0.01, slippage_pct: 10 });
    const [rb, hb] = [(await loadState(ctx.t.db, rugger.id, ctx.t.clock.now())).traits, (await loadState(ctx.t.db, holder.id, ctx.t.clock.now())).traits];
    const v = { agent: { id: rugger.id, username: rugger.username, displayName: rugger.displayName }, wallet: { lamports: 0, positions: [] }, affinity: {}, depth: emptyDepth() } as unknown as AgentView;
    await driftModule.afterAct!(ctx.d, v, { kind: 'rug', score: 1, reason: 't', target: { mint } }, { ok: true, turnId: 't' });
    const [ra, ha] = [(await loadState(ctx.t.db, rugger.id, ctx.t.clock.now())).traits, (await loadState(ctx.t.db, holder.id, ctx.t.clock.now())).traits];
    expect(ra).toEqual(rb);
    expect(ha.pettiness - hb.pettiness).toBeCloseTo(Math.min(0.03, 1 - hb.pettiness), 6);
    expect(ha.loyalty - hb.loyalty).toBeCloseTo(-Math.min(0.01, hb.loyalty), 6);
  });
  it('drift applied between an agent\'s perceive and its state save survives the save', async () => {
    ctx = await depthTestCtx();
    const a = ctx.agents[8]!;
    const { perceive } = await import('../src/agents/perceive.ts');
    const { act } = await import('../src/agents/act.ts');
    const v = await perceive(ctx.d, a.id);
    // Another agent's afterAct (or an onEvent hook) drifts this agent while its own action is in flight.
    const drifted = await applyDrift(ctx.t.db, a.id, { pettiness: 0.03 }, ctx.t.clock.now());
    expect(drifted.pettiness).not.toBe(v.state.traits.pettiness);
    await act(ctx.d, v, { kind: 'post', score: 1, situation: 'idle', reason: 'felt like posting' });
    const after = await loadState(ctx.t.db, a.id, ctx.t.clock.now());
    expect(after.traits).toEqual(drifted);
    expect(after.cooldowns.post).toBeTruthy(); // the ordinary save still happened
  });
});
