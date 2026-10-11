import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { worldTestCtx } from './world-helpers.ts';
import { runTool } from '../src/world/tools.ts';
import { mulberry32 } from '../src/seed/rng.ts';
import { flowChange, perceive } from '../src/agents/perceive.ts';
import { adjustAffinity } from '../src/agents/state.ts';
import type { EngineDeps } from '../src/agents/engine.ts';

let w: Awaited<ReturnType<typeof worldTestCtx>>;
let d: EngineDeps;
let mint = '';
beforeAll(async () => {
  w = await worldTestCtx();
  d = { app: w.t.app, db: w.t.db, chain: w.chain, events: w.events, worldKey: w.key, now: w.t.clock.now, rng: mulberry32(7) };
  const [a, b] = w.agents;
  const launched = await runTool(await w.ctxFor(b!), 'launch_coin', { name: 'Moth Coin', symbol: 'MOTH', description: 'lamps', emoji: '🦋', initial_buy_sol: 0.005 });
  mint = (launched.result as { mint: string }).mint;
  await runTool(await w.ctxFor(a!), 'buy', { mint, sol: 0.02, slippage_pct: null });
});
afterAll(() => w.t.close());

describe('flowChange', () => {
  it('is zero without flow and grows with net buying', () => {
    expect(flowChange(0, 0)).toBe(0);
    expect(flowChange(500_000_000, 500_000_000)).toBeCloseTo(1.25, 5); // (1.5/1)^2 - 1
    expect(flowChange(500_000_000, -100_000_000)).toBeLessThan(0);
  });
});

describe('perceive', () => {
  it('sees its wallet, positions with cost basis, and coins with momentum and holders', async () => {
    const a = w.agents[0]!;
    const v = await perceive(d, a.id);
    expect(v.agent).toMatchObject({ id: a.id, username: a.username });
    expect(v.wallet.lamports).toBeLessThan(100_000_000);
    const pos = v.wallet.positions.find((p) => p.mint === mint)!;
    expect(pos).toMatchObject({ symbol: 'MOTH', createdByMe: false, creatorId: w.agents[1]!.id });
    expect(pos.costLamports).toBeGreaterThan(19_000_000);
    expect(pos.valueLamports).toBeGreaterThan(0);
    const coin = v.coins.find((c) => c.mint === mint)!;
    expect(coin.holders).toBeGreaterThanOrEqual(2);
    expect(coin.change10m).toBeGreaterThan(0);
    expect(coin.change1h).toBeGreaterThanOrEqual(coin.change10m);
    expect(v.weather).toBe('grind');
    expect(v.phrasebook.lines.gm!.length).toBeGreaterThan(0);
  });
  it('sees unanswered human mentions and DMs, and its affinities', async () => {
    const a = w.agents[2]!;
    const human = await w.t.createUser('watcher_1');
    const p = await w.t.as(human).post('/api/posts', { body: `hey @${a.username} what are you buying?` });
    expect(p.status).toBe(201);
    const conv = await w.t.as(human).post('/api/conversations', { kind: 'dm', username: a.username });
    await w.t.as(human).post(`/api/conversations/${conv.body.conversation.id}/messages`, { body: 'psst, private question' });
    await adjustAffinity(w.t.db, a.id, w.agents[3]!.id, 0.6, w.t.clock.now());
    const v = await perceive(d, a.id);
    expect(v.mentions).toEqual([expect.objectContaining({ postId: p.body.post.id, authorId: human.id, authorKind: 'human' })]);
    expect(v.dms).toEqual([expect.objectContaining({ conversationId: conv.body.conversation.id, otherId: human.id, otherKind: 'human', lastBody: 'psst, private question' })]);
    expect(v.affinity).toEqual({ [w.agents[3]!.id]: 0.6 });
    expect(v.feed.some((f) => f.postId === p.body.post.id)).toBe(true);
  });
  it('drops a mention once the agent has replied to it', async () => {
    const a = w.agents[4]!;
    const human = await w.t.createUser('watcher_2');
    const p = await w.t.as(human).post('/api/posts', { body: `@${a.username} gm` });
    await runTool(await w.ctxFor(a), 'reply', { post_id: p.body.post.id, body: 'gm to you' });
    expect((await perceive(d, a.id)).mentions).toEqual([]);
  });
});
