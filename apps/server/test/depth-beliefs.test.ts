import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { depthTestCtx } from './depth-helpers.ts';
import { stanceOf, expectFor, checkSaidVsDid, beliefsModule } from '../src/agents/depth/beliefs.ts';
import { emptyDepth, DepthRegistry } from '../src/agents/depth/registry.ts';
import { startEngine, type Engine } from '../src/agents/engine.ts';
import { runTool } from '../src/world/tools.ts';
import { agentAffinity, agentBeliefs, agentState, posts, saidVsDid } from '../src/db/schema.ts';
import { newId } from '../src/lib/ids.ts';
import { recentEvents } from '../src/agents/state.ts';
import type { AgentView, Candidate } from '../src/agents/types.ts';

let ctx: Awaited<ReturnType<typeof depthTestCtx>>;
let engine: Engine | null = null;
afterEach(async () => { await engine?.stop(); engine = null; await ctx?.t.close(); ctx = undefined as never; });

describe('stances', () => {
  it('reads a stance only when the ticker is mentioned', () => {
    expect(stanceOf('$MOTH to the moon, holding forever 🚀', 'MOTH')).toBeGreaterThan(0.5);
    expect(stanceOf('$moth is a rug, selling everything', 'MOTH')).toBeLessThan(-0.5);
    expect(stanceOf('the moon is nice tonight', 'MOTH')).toBeNull();
    expect(stanceOf('$MOTHER is great', 'MOTH')).toBeNull();
    expect(stanceOf('$MOTH', 'MOTH')).toBe(0);
  });
  it('matches word tokens on word boundaries and emoji anywhere', () => {
    expect(stanceOf('$MOTH moreover', 'MOTH')).toBe(0);
    expect(stanceOf('$MOTH paper hands', 'MOTH')).toBe(0);
    expect(stanceOf('$MOTH sender', 'MOTH')).toBe(0);
    expect(stanceOf('$MOTH 12 holders', 'MOTH')).toBe(0);
    expect(stanceOf('$MOTH it is over', 'MOTH')).toBe(-1);
    expect(stanceOf('$MOTH up only', 'MOTH')).toBe(1);
    expect(stanceOf('$MOTH 🚀🚀', 'MOTH')).toBe(1);
  });
  it('expects a coin to rise with momentum and trust, bounded to -1..1', () => {
    expect(expectFor(0.5, 0.9)).toBeGreaterThan(0.5);
    expect(expectFor(-0.5, 0.1)).toBeLessThan(-0.5);
    expect(Math.abs(expectFor(100, 1))).toBeLessThanOrEqual(1);
  });
});

describe('said vs did', () => {
  async function launchAndBuy() {
    const [creator, liar, holder] = [ctx.agents[0]!, ctx.agents[1]!, ctx.agents[2]!];
    const l = await runTool(await ctx.ctxFor(creator), 'launch_coin', { name: 'Moth', symbol: 'MOTH', description: 'lamps', emoji: '🦋', initial_buy_sol: 0.01 });
    const mint = (l.result as { mint: string }).mint;
    await runTool(await ctx.ctxFor(liar), 'buy', { mint, sol: 0.02, slippage_pct: null });
    await runTool(await ctx.ctxFor(holder), 'buy', { mint, sol: 0.01, slippage_pct: null });
    return { creator, liar, holder, mint };
  }
  it('flags a bullish post made within 60 minutes after selling the same coin, and holders trust the liar less', async () => {
    ctx = await depthTestCtx();
    const { liar, holder, mint } = await launchAndBuy();
    await runTool(await ctx.ctxFor(liar), 'sell', { mint, tokens: null, all: true, slippage_pct: null });
    ctx.t.clock.advance(20 * 60_000);
    const posted = await runTool(await ctx.ctxFor(liar), 'post', { body: '$MOTH is going to the moon, holding forever 🚀' });
    const postId = (posted.result as { post_id: string }).post_id;
    const v = { agent: { id: liar.id, username: liar.username, displayName: liar.displayName }, coins: [{ mint, symbol: 'MOTH', creatorId: ctx.agents[0]!.id }], affinity: {}, depth: emptyDepth() } as unknown as AgentView;
    const c: Candidate = { kind: 'post', score: 1, reason: 'test', situation: 'shilling', target: { mint } };
    await beliefsModule.afterAct!(ctx.d, v, c, { ok: true, turnId: 't', postId, text: '$MOTH is going to the moon, holding forever 🚀' });
    const [row] = await ctx.t.db.select().from(saidVsDid).where(eq(saidVsDid.postId, postId));
    expect(row).toMatchObject({ agentId: liar.id, mint, side: 'sell' });
    const [aff] = await ctx.t.db.select().from(agentAffinity).where(eq(agentAffinity.agentId, holder.id));
    expect(aff).toMatchObject({ otherId: liar.id });
    expect(aff!.score).toBeLessThan(0);
    const viewer = await ctx.t.createUser('viewer');
    const feed = await ctx.t.as(viewer).get(`/api/posts/${postId}`);
    expect(feed.body.post.saidVsDid).toMatchObject({ mint, symbol: 'MOTH', side: 'sell' });
  });
  it('does not flag a post made more than 60 minutes after the sale, or a bearish post after a sale', async () => {
    ctx = await depthTestCtx();
    const { liar, mint } = await launchAndBuy();
    ctx.t.clock.advance(61 * 60_000);
    await runTool(await ctx.ctxFor(liar), 'sell', { mint, tokens: null, all: true, slippage_pct: null });
    ctx.t.clock.advance(61 * 60_000);
    expect(await checkSaidVsDid(ctx.t.db, liar.id, mint, ctx.t.clock.now())).toBeNull();
    ctx.t.clock.advance(-50 * 60_000);
    await runTool(await ctx.ctxFor(liar), 'post', { body: '$MOTH is dead, sold it all' });
    expect(await checkSaidVsDid(ctx.t.db, liar.id, mint, ctx.t.clock.now())).toBeNull();
  });
  it('flags the trade when the bullish post came first', async () => {
    ctx = await depthTestCtx();
    const { liar, mint } = await launchAndBuy();
    await runTool(await ctx.ctxFor(liar), 'post', { body: 'loading more $MOTH, diamond hands 💎' });
    ctx.t.clock.advance(10 * 60_000);
    await runTool(await ctx.ctxFor(liar), 'sell', { mint, tokens: null, all: true, slippage_pct: null });
    const hit = await checkSaidVsDid(ctx.t.db, liar.id, mint, ctx.t.clock.now());
    expect(hit).toMatchObject({ side: 'sell' });
    expect(hit!.stance).toBeGreaterThan(0.3);
  });
  it('never flags against a post in a private community or a deleted post', async () => {
    ctx = await depthTestCtx();
    const { liar, mint } = await launchAndBuy();
    await runTool(await ctx.ctxFor(liar), 'sell', { mint, tokens: null, all: true, slippage_pct: null });
    const base = { authorId: liar.id, kind: 'reply' as const, body: '$MOTH to the moon, holding forever 🚀', createdAt: ctx.t.clock.now() };
    await ctx.t.db.insert(posts).values({ ...base, id: newId(), visibility: 'community', communityId: 'private-c' });
    await ctx.t.db.insert(posts).values({ ...base, id: newId(), visibility: 'public', deletedAt: ctx.t.clock.now() });
    expect(await checkSaidVsDid(ctx.t.db, liar.id, mint, ctx.t.clock.now())).toBeNull();
    await ctx.t.db.insert(posts).values({ ...base, id: newId(), visibility: 'public' });
    expect(await checkSaidVsDid(ctx.t.db, liar.id, mint, ctx.t.clock.now())).toMatchObject({ side: 'sell' });
  });
  it('does not read a report of a sale as a bearish call (L1)', async () => {
    ctx = await depthTestCtx();
    const { liar, mint } = await launchAndBuy();
    ctx.t.clock.advance(5 * 60_000);
    await runTool(await ctx.ctxFor(liar), 'post', { body: 'sold $MOTH into strength' });
    expect(stanceOf('sold $MOTH into strength', 'MOTH')).toBe(0);
    expect(await checkSaidVsDid(ctx.t.db, liar.id, mint, ctx.t.clock.now())).toBeNull();
  });
  it('flags a buy made after a bearish post, but not a buy made before it (L1)', async () => {
    ctx = await depthTestCtx();
    const { liar, mint } = await launchAndBuy(); // the liar bought at t0
    ctx.t.clock.advance(5 * 60_000);
    await runTool(await ctx.ctxFor(liar), 'post', { body: '$MOTH is dead, total scam' });
    expect(await checkSaidVsDid(ctx.t.db, liar.id, mint, ctx.t.clock.now())).toBeNull(); // bought first, soured later: a change of mind
    ctx.t.clock.advance(10 * 60_000);
    await runTool(await ctx.ctxFor(liar), 'buy', { mint, sol: 0.005, slippage_pct: null });
    expect(await checkSaidVsDid(ctx.t.db, liar.id, mint, ctx.t.clock.now())).toMatchObject({ side: 'buy' });
  });
  it('remembers which way the agent was caught talking (L1)', async () => {
    ctx = await depthTestCtx();
    const { liar, mint } = await launchAndBuy();
    ctx.t.clock.advance(60_000);
    await runTool(await ctx.ctxFor(liar), 'post', { body: '$MOTH is dead, total scam' });
    ctx.t.clock.advance(60_000);
    await runTool(await ctx.ctxFor(liar), 'buy', { mint, sol: 0.005, slippage_pct: null });
    const v = { agent: { id: liar.id, username: liar.username, displayName: '' }, coins: [{ mint, symbol: 'MOTH', creatorId: ctx.agents[0]!.id }], affinity: {}, depth: emptyDepth() } as unknown as AgentView;
    await beliefsModule.afterAct!(ctx.d, v, { kind: 'buy', score: 1, reason: 't', target: { mint } }, { ok: true, turnId: 't' });
    expect((await recentEvents(ctx.t.db, liar.id)).find((e) => e.kind === 'caught_lying')).toMatchObject({ data: { mint, symbol: 'MOTH', stance: -1 } });
  });
});

describe('belief state', () => {
  it('keeps trust following reputation after a stance upsert, but a rug-set 0 sticks', async () => {
    ctx = await depthTestCtx();
    const [me, creator] = [ctx.agents[1]!, ctx.agents[0]!];
    const mint = 'M1nt';
    await ctx.t.db.insert(agentBeliefs).values({ agentId: me.id, mint, expect: 0, trustCreator: 0.5, stance: 0.8, stanceAt: ctx.t.clock.now() });
    const mk = () => ({ agent: { id: me.id }, coins: [{ mint, symbol: 'MOTH', creatorId: creator.id, change1h: 0 }], depth: { ...emptyDepth(), reputation: { [creator.id]: 1 } } }) as unknown as AgentView;
    let v = mk();
    await beliefsModule.perceive!(ctx.d, v);
    expect(v.depth.beliefs[mint]!.trustCreator).toBe(1);
    await ctx.t.db.update(agentBeliefs).set({ trustCreator: 0 }).where(eq(agentBeliefs.agentId, me.id));
    v = mk();
    await beliefsModule.perceive!(ctx.d, v);
    expect(v.depth.beliefs[mint]!.trustCreator).toBe(0);
  });
  it('a stance upsert updates only stance and stanceAt', async () => {
    ctx = await depthTestCtx();
    const me = ctx.agents[1]!;
    const mint = 'M2nt';
    await ctx.t.db.insert(agentBeliefs).values({ agentId: me.id, mint, expect: 0, trustCreator: 0.2 });
    const v = { agent: { id: me.id }, coins: [{ mint, symbol: 'MOTH', creatorId: ctx.agents[0]!.id }], depth: { ...emptyDepth(), beliefs: { [mint]: { expect: 0.1, trustCreator: 0.9, stance: null, stanceAt: null } } } } as unknown as AgentView;
    await beliefsModule.afterAct!(ctx.d, v, { kind: 'chat', score: 1, reason: 'r' }, { ok: true, turnId: 't', text: '$MOTH 🚀' });
    const [row] = await ctx.t.db.select().from(agentBeliefs).where(eq(agentBeliefs.agentId, me.id));
    expect(row).toMatchObject({ trustCreator: 0.2, expect: 0 });
    expect(row!.stance).toBeGreaterThan(0);
  });
});

describe('belief-weighted decisions', () => {
  it('scales buys up and sells down when the agent expects a rise', () => {
    const v = { depth: { ...emptyDepth(), beliefs: { M: { expect: 0.5, trustCreator: 0.8, stance: null, stanceAt: null } } } } as unknown as AgentView;
    const out = beliefsModule.modify!(v, [
      { kind: 'buy', score: 1, reason: 'r', target: { mint: 'M' } },
      { kind: 'sell', score: 1, reason: 'r', target: { mint: 'M' } },
      { kind: 'post', score: 1, reason: 'r' },
    ]);
    expect(out.map((c) => c.score)).toEqual([1.5, 0.5, 1]);
  });
});

describe('engine cooldowns for depth candidates', () => {
  it('drops depth candidates whose kind is on cooldown', async () => {
    ctx = await depthTestCtx();
    const seen: string[][] = [];
    let cooling = true;
    const registry = new DepthRegistry([{
      name: 'probe',
      perceive: async (_d, v) => { if (cooling) v.state.cooldowns.post = v.now; },
      candidates: () => [{ kind: 'post', score: 1, reason: 'DEPTH_PROBE' }],
      modify: (_v, cs) => { seen.push(cs.map((c) => c.reason)); return cs; },
    }]);
    engine = startEngine({ ...ctx.d, depth: registry, tickMs: [1000, 1000], autoStart: false });
    await engine.tick();
    expect(seen.at(-1)).not.toContain('DEPTH_PROBE');
    cooling = false;
    await ctx.t.db.update(agentState).set({ cooldowns: {} });
    await engine.tick();
    expect(seen.at(-1)).toContain('DEPTH_PROBE');
  });
});
