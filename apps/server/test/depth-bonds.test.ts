import { describe, it, expect, afterEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { depthTestCtx } from './depth-helpers.ts';
import { agentAffinity, worldCoins } from '../src/db/schema.ts';
import { DECAY_KEY, FEUD_HOT_MS, bondCoHolders, bondsModule, decayAffinity, startFeuds } from '../src/agents/depth/bonds.ts';
import { emptyDepth } from '../src/agents/depth/registry.ts';
import { clearPerceptionCache } from '../src/agents/perceive.ts';
import { adjustAffinity, affinitiesOf, recentEvents, rememberEvent } from '../src/agents/state.ts';
import { getSetting, setSetting } from '../src/world/launchpad.ts';
import { runTool } from '../src/world/tools.ts';
import type { AgentView, Candidate, Moment, Moments } from '../src/agents/types.ts';

let ctx: Awaited<ReturnType<typeof depthTestCtx>> | undefined;
afterEach(async () => { await ctx?.t.close(); ctx = undefined; });
const H = 3600_000;
const queue = () => {
  const got: Moment[] = [];
  const q: Moments = { enqueue: (m) => { got.push(m); return true; }, size: () => got.length, drain: async () => {}, halted: () => null, stop: async () => {} };
  return { q, got };
};

describe('fading feelings (L5)', () => {
  it('halves every feeling after a day, forgets the faint ones, and leaves updatedAt alone', async () => {
    ctx = await depthTestCtx();
    const [a, b, c] = ctx.agents;
    const now = ctx.t.clock.now();
    await adjustAffinity(ctx.t.db, a!.id, b!.id, 0.8, now);
    await adjustAffinity(ctx.t.db, b!.id, a!.id, -0.6, now);
    await adjustAffinity(ctx.t.db, a!.id, c!.id, 0.015, now);
    const row = async (x: string, y: string) => (await ctx!.t.db.select().from(agentAffinity).where(and(eq(agentAffinity.agentId, x), eq(agentAffinity.otherId, y))))[0];
    const stamped = (await row(a!.id, b!.id))!.updatedAt;
    expect(await decayAffinity(ctx.d)).toBe(1); // the first run only starts the clock
    ctx.t.clock.advance(24 * H);
    expect(await decayAffinity(ctx.d)).toBeCloseTo(0.5);
    expect((await affinitiesOf(ctx.t.db, a!.id))[b!.id]).toBeCloseTo(0.4);
    expect((await affinitiesOf(ctx.t.db, b!.id))[a!.id]).toBeCloseTo(-0.3);
    expect(await row(a!.id, c!.id)).toBeUndefined(); // 0.0075 is forgotten
    expect((await row(a!.id, b!.id))!.updatedAt).toEqual(stamped);
  });
  it('survives a clock that went backwards or a long outage (Review Focus 2)', async () => {
    ctx = await depthTestCtx();
    const [a, b] = ctx.agents;
    await adjustAffinity(ctx.t.db, a!.id, b!.id, 0.8, ctx.t.clock.now());
    await setSetting(ctx.t.db, DECAY_KEY, new Date(ctx.t.clock.now().getTime() + H).toISOString()); // stored "in the future"
    expect(await decayAffinity(ctx.d)).toBe(1);
    expect((await affinitiesOf(ctx.t.db, a!.id))[b!.id]).toBeCloseTo(0.8);
    ctx.t.clock.advance(3 * 24 * H); // three days down
    expect(await decayAffinity(ctx.d)).toBeCloseTo(0.125, 6);
    expect((await affinitiesOf(ctx.t.db, a!.id))[b!.id]).toBeCloseTo(0.1);
    expect(await getSetting(ctx.t.db, DECAY_KEY)).toBe(ctx.t.clock.now().toISOString());
  });
});

describe('bonds between holders (L5)', () => {
  it('holders of a coin up 30% in an hour warm to each other', async () => {
    ctx = await depthTestCtx();
    const [creator, h1, h2, h3] = ctx.agents;
    const l = await runTool(await ctx.ctxFor(creator!), 'launch_coin', { name: 'Pump', symbol: 'PUMP', description: '', emoji: '📈', initial_buy_sol: 0.01 });
    const mint = (l.result as { mint: string }).mint;
    for (const h of [h1!, h2!, h3!]) await runTool(await ctx.ctxFor(h), 'buy', { mint, sol: 0.05, slippage_pct: null });
    clearPerceptionCache(ctx.t.db);
    expect(await bondCoHolders(ctx.d)).toBe(12); // 4 holders, every ordered pair
    expect((await affinitiesOf(ctx.t.db, h1!.id))[h2!.id]).toBeCloseTo(0.02);
    expect((await affinitiesOf(ctx.t.db, creator!.id))[h3!.id]).toBeCloseTo(0.02);
  });
  it('a sale that knocks the price down 10% or more sours the other holders on the seller', async () => {
    ctx = await depthTestCtx();
    const [creator, h1, h2, seller] = ctx.agents;
    const l = await runTool(await ctx.ctxFor(creator!), 'launch_coin', { name: 'Drop', symbol: 'DROP', description: '', emoji: '📉', initial_buy_sol: 0.01 });
    const mint = (l.result as { mint: string }).mint;
    for (const h of [h1!, h2!]) await runTool(await ctx.ctxFor(h), 'buy', { mint, sol: 0.02, slippage_pct: null });
    await runTool(await ctx.ctxFor(seller!), 'buy', { mint, sol: 0.09, slippage_pct: null });
    const [{ price }] = await ctx.t.db.select({ price: worldCoins.priceLamports }).from(worldCoins).where(eq(worldCoins.mint, mint)) as [{ price: number }];
    await runTool(await ctx.ctxFor(seller!), 'sell', { mint, tokens: null, all: true, slippage_pct: null });
    const v = { agent: { id: seller!.id }, coins: [{ mint, priceLamports: price }] } as unknown as AgentView;
    await bondsModule.afterAct!(ctx.d, v, { kind: 'sell', score: 1, reason: 'r', target: { mint } }, { ok: true, turnId: 't' });
    for (const h of [creator!, h1!, h2!]) expect((await affinitiesOf(ctx.t.db, h.id))[seller!.id]).toBeCloseTo(-0.05);
  });
});

describe('feuds (L5)', () => {
  it('starts a feud once a pair averages -0.7: both remember it, one moment is queued, once a day', async () => {
    ctx = await depthTestCtx();
    const [a, b, c] = ctx.agents;
    const now = ctx.t.clock.now();
    await adjustAffinity(ctx.t.db, a!.id, b!.id, -0.9, now);
    await adjustAffinity(ctx.t.db, b!.id, a!.id, -0.6, now);
    await adjustAffinity(ctx.t.db, a!.id, c!.id, -0.9, now);
    await adjustAffinity(ctx.t.db, c!.id, a!.id, -0.3, now); // a mean of -0.6: not a feud yet
    const { q, got } = queue();
    const pair = [a!.id, b!.id].sort() as [string, string];
    expect(await startFeuds({ ...ctx.d, moments: q })).toEqual([pair]);
    expect(got).toEqual([expect.objectContaining({ kind: 'feud', agentId: a!.id, data: { otherId: b!.id, key: pair.join('|') } })]);
    expect((await recentEvents(ctx.t.db, b!.id))[0]).toMatchObject({ kind: 'feud', data: { otherId: a!.id } });
    expect(await startFeuds({ ...ctx.d, moments: q })).toEqual([]); // once a day
    ctx.t.clock.advance(24 * H);
    expect(await startFeuds({ ...ctx.d, moments: q })).toHaveLength(1);
  });
  it('never starts a feud with a human (Review Focus 5)', async () => {
    ctx = await depthTestCtx();
    const human = await ctx.t.createUser('grumpy_human');
    const agent = ctx.agents[0]!;
    await adjustAffinity(ctx.t.db, agent.id, human.id, -1, ctx.t.clock.now());
    await adjustAffinity(ctx.t.db, human.id, agent.id, -1, ctx.t.clock.now());
    const { q, got } = queue();
    expect(await startFeuds({ ...ctx.d, moments: q })).toEqual([]);
    expect(got).toEqual([]);
  });
  it('makes a fresh feud twice as tempting to roast, for an hour', async () => {
    ctx = await depthTestCtx();
    const [a, b] = ctx.agents;
    await rememberEvent(ctx.t.db, a!.id, 'feud', { otherId: b!.id }, ctx.t.clock.now());
    const v = { agent: { id: a!.id }, depth: emptyDepth() } as unknown as AgentView;
    await bondsModule.perceive!(ctx.d, v);
    expect(v.depth.feudsWith).toEqual([b!.id]);
    const roast: Candidate = { kind: 'reply', situation: 'roast', score: 0.2, reason: 'r', target: { postId: 'p', userId: b!.id } };
    const other: Candidate = { ...roast, target: { postId: 'q', userId: 'someone' } };
    expect(bondsModule.modify!(v, [roast, other]).map((x) => x.score)).toEqual([0.4, 0.2]);
    ctx.t.clock.advance(FEUD_HOT_MS + 1);
    await bondsModule.perceive!(ctx.d, v);
    expect(v.depth.feudsWith).toEqual([]);
  });
});
