import { describe, it, expect } from 'vitest';
import { worldTestCtx } from './world-helpers.ts';
import { runTool } from '../src/world/tools.ts';
import { Indexer } from '../src/world/indexer.ts';
import { Budget } from '../src/world/budget.ts';
import { registerAgentRoutes } from '../src/routes/agents.ts';
import { adjustAffinity } from '../src/agents/state.ts';
import { buildOverview } from '../src/agents/overview.ts';

describe('agents overview', () => {
  it('reports a feud once, the newest launch, a rug today and everyone’s mood', async () => {
    const w = await worldTestCtx();
    const indexer = new Indexer(w.t.db, w.chain, w.t.clock.now, { balanceTtlMs: 0 });
    // The agent routes are registered by bootAgents in production; tests register them by hand, as test/agents-routes.test.ts does.
    await registerAgentRoutes(w.t.app, { indexer, budget: new Budget(w.t.db, 1, w.t.clock.now), chain: w.chain, key: w.key, engine: null, moments: null, network: 'memory', startAgents: () => 'AGENTS is off' });
    const [a, b, c] = w.agents;
    for (const [x, y, d] of [[a, b, -0.8], [b, a, -0.6], [a, c, 0.9]] as const) await adjustAffinity(w.t.db, x!.id, y!.id, d, w.t.clock.now());
    const launched = await runTool(await w.ctxFor(c!), 'launch_coin', { name: 'Moth', symbol: 'MOTH', description: 'x', emoji: '🦋', initial_buy_sol: 0.02 });
    const mint = (launched.result as { mint: string }).mint;
    await runTool(await w.ctxFor(b!), 'buy', { mint, sol: 0.01, slippage_pct: null });
    await runTool(await w.ctxFor(c!), 'sell', { mint, tokens: null, all: true, slippage_pct: null });
    const o = await buildOverview({ db: w.t.db, indexer, now: w.t.clock.now });
    expect(o.feuds).toHaveLength(1);
    expect(o.feuds[0]!.affinity).toBeCloseTo(-0.7);
    expect(new Set([o.feuds[0]!.a.id, o.feuds[0]!.b.id])).toEqual(new Set([a!.id, b!.id]));
    expect(o.launches[0]!.symbol).toBe('MOTH');
    expect(o.rugs).toHaveLength(1);
    expect(o.rugs[0]!.creator.id).toBe(c!.id);
    expect(o.rugs[0]!.soldPct).toBeGreaterThanOrEqual(70);
    expect(o.moods).toHaveLength(50);
    expect(o.movers.down.every((x) => x.pnlSol < 0)).toBe(true);
    const r = await w.t.app.inject({ method: 'GET', url: '/api/agents/overview' });
    expect(r.statusCode).toBe(200);
    await w.t.close();
  });

  it('measures each sale against the bag the creator held before it, so selling in halves is one rug, not two', async () => {
    const w = await worldTestCtx();
    const indexer = new Indexer(w.t.db, w.chain, w.t.clock.now, { balanceTtlMs: 0 });
    const c = w.agents[2]!;
    const launched = await runTool(await w.ctxFor(c), 'launch_coin', { name: 'Half', symbol: 'HALF', description: 'x', emoji: '🌗', initial_buy_sol: 0.02 });
    const { mint, tokens } = launched.result as { mint: string; tokens: number };
    await runTool(await w.ctxFor(c), 'sell', { mint, tokens: tokens / 2, all: false, slippage_pct: null });
    await runTool(await w.ctxFor(c), 'sell', { mint, tokens: null, all: true, slippage_pct: null });
    const o = await buildOverview({ db: w.t.db, indexer, now: w.t.clock.now });
    expect(o.rugs).toHaveLength(1);
    expect(o.rugs[0]!.soldPct).toBeCloseTo(100);
    await w.t.close();
  });
});
