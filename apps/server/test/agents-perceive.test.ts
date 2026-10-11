import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { worldTestCtx } from './world-helpers.ts';
import { runTool } from '../src/world/tools.ts';
import { mulberry32 } from '../src/seed/rng.ts';
import { clearPerceptionCache, flowChange, perceive } from '../src/agents/perceive.ts';
import { adjustAffinity } from '../src/agents/state.ts';
import { worldCoins } from '../src/db/schema.ts';
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
beforeEach(() => clearPerceptionCache(w.t.db));
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

describe('perceive details', () => {
  const MIN = 60_000;
  it('counts holders exactly and leaves out a holder who sold everything', async () => {
    const c = w.agents[5]!;
    await runTool(await w.ctxFor(c), 'buy', { mint, sol: 0.01, slippage_pct: null });
    expect((await perceive(d, w.agents[0]!.id)).coins.find((x) => x.mint === mint)!.holders).toBe(3);
    await runTool(await w.ctxFor(c), 'sell', { mint, tokens: null, all: true, slippage_pct: null });
    clearPerceptionCache(w.t.db);
    expect((await perceive(d, w.agents[0]!.id)).coins.find((x) => x.mint === mint)!.holders).toBe(2);
  });
  it('reuses the global coins and rooms inside the TTL and refreshes after clearing', async () => {
    const first = await perceive(d, w.agents[0]!.id);
    const again = await perceive(d, w.agents[1]!.id);
    expect(again.coins).toBe(first.coins);
    expect(again.rooms).toBe(first.rooms);
    clearPerceptionCache(w.t.db);
    expect((await perceive(d, w.agents[0]!.id)).coins).not.toBe(first.coins);
  });
  it('shows at most 20 rooms, newest activity first', async () => {
    const rooms = (await perceive(d, w.agents[0]!.id)).rooms;
    expect(rooms.length).toBeLessThanOrEqual(20);
    const times = rooms.map((r) => r.lastAt);
    expect(times).toEqual([...times].sort().reverse());
  });
  it('drops a mention after 30 minutes', async () => {
    const a = w.agents[6]!;
    const human = await w.t.createUser('watcher_3');
    const p = await w.t.as(human).post('/api/posts', { body: `@${a.username} still there?` });
    w.t.clock.advance(29 * MIN);
    expect((await perceive(d, a.id)).mentions.map((m) => m.postId)).toEqual([p.body.post.id]);
    w.t.clock.advance(2 * MIN);
    expect((await perceive(d, a.id)).mentions).toEqual([]);
  });
  it('drops a DM after 120 minutes', async () => {
    const a = w.agents[7]!;
    const human = await w.t.createUser('watcher_4');
    const conv = await w.t.as(human).post('/api/conversations', { kind: 'dm', username: a.username });
    await w.t.as(human).post(`/api/conversations/${conv.body.conversation.id}/messages`, { body: 'hello?' });
    w.t.clock.advance(119 * MIN);
    expect((await perceive(d, a.id)).dms).toHaveLength(1);
    w.t.clock.advance(2 * MIN);
    expect((await perceive(d, a.id)).dms).toEqual([]);
  });
  it('drops a DM the agent has answered', async () => {
    const a = w.agents[8]!;
    const human = await w.t.createUser('watcher_5');
    const conv = await w.t.as(human).post('/api/conversations', { kind: 'dm', username: a.username });
    const id = conv.body.conversation.id as string;
    await w.t.as(human).post(`/api/conversations/${id}/messages`, { body: 'ping' });
    expect((await perceive(d, a.id)).dms).toHaveLength(1);
    const r = await w.actor.call(a.id, 'POST', `/api/conversations/${id}/messages`, { body: 'pong' });
    expect(r.status).toBe(201);
    expect((await perceive(d, a.id)).dms).toEqual([]);
  });
  it('keeps the most recent unanswered DMs when more than 20 exist', async () => {
    const a = w.agents[9]!;
    for (let i = 0; i < 22; i++) {
      const human = await w.t.createUser(`dm_sender_${i}`);
      const conv = await w.t.as(human).post('/api/conversations', { kind: 'dm', username: a.username });
      await w.t.as(human).post(`/api/conversations/${conv.body.conversation.id}/messages`, { body: `dm ${i}` });
    }
    const dms = (await perceive(d, a.id)).dms;
    expect(dms).toHaveLength(20);
    expect(dms[0]!.lastBody).toBe('dm 21');
    expect(dms[19]!.lastBody).toBe('dm 2');
  });
});

describe('perceive held coins', () => {
  it('always includes coins the agent holds or created, even beyond the 60 newest, without touching the shared cache', async () => {
    const creator = w.agents[1]!;
    const later = new Date(w.t.clock.now().getTime() + 60_000);
    await w.t.db.insert(worldCoins).values(Array.from({ length: 61 }, (_, i) => ({
      mint: `FILLER${i}`, pool: `pool${i}`, creatorId: w.agents[6]!.id, name: `Filler ${i}`, symbol: `F${i}`, launchSignature: `sig${i}`, launchedAt: later, priceLamports: 1,
    })));
    clearPerceptionCache(w.t.db);
    const holder = await perceive(d, w.agents[0]!.id);
    expect(holder.coins.some((c) => c.mint === mint)).toBe(true);
    const maker = await perceive(d, creator.id);
    expect(maker.coins.some((c) => c.mint === mint)).toBe(true);
    const bystander = await perceive(d, w.agents[8]!.id);
    expect(bystander.coins.some((c) => c.mint === mint)).toBe(false);
    expect(bystander.coins).toHaveLength(60);
    expect(holder.coins.length).toBe(61);
  });
});
