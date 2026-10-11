import { describe, it, expect, afterEach } from 'vitest';
import { depthTestCtx } from './depth-helpers.ts';
import { reputationScore, repFacts, ReputationCache, reputationModule } from '../src/agents/depth/reputation.ts';
import { emptyDepth } from '../src/agents/depth/registry.ts';
import { runTool } from '../src/world/tools.ts';
import type { AgentView } from '../src/agents/types.ts';

let ctx: Awaited<ReturnType<typeof depthTestCtx>>;
afterEach(async () => { await ctx?.t.close(); ctx = undefined as never; });

describe('reputation', () => {
  it('scores deeds: rugs and lies down, honesty and repaid debts up, bounded', () => {
    const zero = { rugs: 0, honestCalls: 0, wrongCalls: 0, hypocrisy: 0, repaid: 0, defaulted: 0, lent: 0 };
    expect(reputationScore(zero)).toBe(0);
    expect(reputationScore({ ...zero, rugs: 2 })).toBeLessThan(-0.8);
    expect(reputationScore({ ...zero, honestCalls: 4, repaid: 1 })).toBeGreaterThan(0.7);
    expect(reputationScore({ ...zero, honestCalls: 1000 })).toBeLessThanOrEqual(1);
  });
  it('counts a creator who sold ≥70% of its bag as one rug', async () => {
    ctx = await depthTestCtx();
    const creator = ctx.agents[0]!, buyer = ctx.agents[1]!;
    const l = await runTool(await ctx.ctxFor(creator), 'launch_coin', { name: 'Moth', symbol: 'MOTH', description: 'x', emoji: '🦋', initial_buy_sol: 0.02 });
    const mint = (l.result as { mint: string }).mint;
    await runTool(await ctx.ctxFor(buyer), 'buy', { mint, sol: 0.02, slippage_pct: null });
    expect((await repFacts(ctx.t.db, creator.id, ctx.t.clock.now())).rugs).toBe(0);
    await runTool(await ctx.ctxFor(creator), 'sell', { mint, tokens: null, all: true, slippage_pct: null });
    expect((await repFacts(ctx.t.db, creator.id, ctx.t.clock.now())).rugs).toBe(1);
  });
  it('scores an honest call once the price has moved 6 hours later', async () => {
    ctx = await depthTestCtx();
    const caller = ctx.agents[2]!, creator = ctx.agents[0]!;
    const l = await runTool(await ctx.ctxFor(creator), 'launch_coin', { name: 'Moth', symbol: 'MOTH', description: 'x', emoji: '🦋', initial_buy_sol: 0.01 });
    const mint = (l.result as { mint: string }).mint;
    // A small reference buy fixes the price at the post; the clock moves so no two rows share a timestamp.
    await runTool(await ctx.ctxFor(ctx.agents[3]!), 'buy', { mint, sol: 0.001, slippage_pct: null });
    ctx.t.clock.advance(60_000);
    await runTool(await ctx.ctxFor(caller), 'post', { body: '$MOTH will moon, buying 🚀' });
    ctx.t.clock.advance(60_000);
    for (const a of ctx.agents.slice(5, 12)) { await runTool(await ctx.ctxFor(a), 'buy', { mint, sol: 0.05, slippage_pct: null }); ctx.t.clock.advance(1000); }
    ctx.t.clock.advance(6 * 3600_000);
    expect((await repFacts(ctx.t.db, caller.id, ctx.t.clock.now())).honestCalls).toBe(1);
  });
  it('feeds the cache into perception only for the db that filled it', async () => {
    ctx = await depthTestCtx();
    const { reputation } = await import('../src/agents/depth/reputation.ts');
    const v = { coins: [], depth: emptyDepth() } as unknown as AgentView;
    await reputationModule.perceive!(ctx.d, v);
    expect(v.depth.reputation).toEqual({});
    await reputationModule.sweep!(ctx.d);
    await reputationModule.perceive!(ctx.d, v);
    expect(Object.keys(v.depth.reputation)).toHaveLength(ctx.agents.length);
    expect(reputation.allFor({} as never)).toEqual({});
  });
  it('weights buys by the creator’s reputation', () => {
    const cache = new ReputationCache();
    cache.set('bad', -1); cache.set('good', 1);
    const v = { coins: [{ mint: 'A', creatorId: 'bad' }, { mint: 'B', creatorId: 'good' }], depth: emptyDepth() } as unknown as AgentView;
    v.depth.reputation = cache.all();
    const out = reputationModule.modify!(v, [
      { kind: 'buy', score: 1, reason: 'r', target: { mint: 'A' } },
      { kind: 'buy', score: 1, reason: 'r', target: { mint: 'B' } },
      { kind: 'follow', score: 1, reason: 'r', target: { userId: 'good' } },
    ]);
    expect(out.map((c) => c.score)).toEqual([0.5, 1.5, 2]);
  });
});
