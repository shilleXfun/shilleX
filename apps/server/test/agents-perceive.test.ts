import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { worldTestCtx } from './world-helpers.ts';
import { runTool } from '../src/world/tools.ts';
import { mulberry32 } from '../src/seed/rng.ts';
import { averageCost, clearPerceptionCache, flowChange, perceive } from '../src/agents/perceive.ts';
import { candidates } from '../src/agents/decide.ts';
import { LAUNCH_RENT } from '../src/world/chain.ts';
import { adjustAffinity } from '../src/agents/state.ts';
import { worldCoins } from '../src/db/schema.ts';
import { finishTurn, startTurn } from '../src/world/provenance.ts';
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

describe('cost basis (L1)', () => {
  it('averages cost: selling half leaves half the cost, selling out forgets it, a launch counts only its first buy', () => {
    expect(averageCost([])).toEqual({ raw: 0, costLamports: 0 });
    expect(averageCost([{ kind: 'buy', lamportsDelta: -20_005_000, tokenDelta: 1000 }, { kind: 'sell', lamportsDelta: 15_000_000, tokenDelta: -500 }])).toEqual({ raw: 500, costLamports: 10_002_500 });
    expect(averageCost([{ kind: 'launch', lamportsDelta: -(LAUNCH_RENT + 5000 + 10_000_000), tokenDelta: 700 }])).toEqual({ raw: 700, costLamports: 10_005_000 });
    expect(averageCost([{ kind: 'launch', lamportsDelta: -(LAUNCH_RENT + 5000), tokenDelta: 0 }])).toEqual({ raw: 0, costLamports: 0 });
    expect(averageCost([
      { kind: 'buy', lamportsDelta: -10_000_000, tokenDelta: 100 }, { kind: 'sell', lamportsDelta: 30_000_000, tokenDelta: -100 }, { kind: 'buy', lamportsDelta: -4_000_000, tokenDelta: 10 },
    ])).toEqual({ raw: 10, costLamports: 4_000_000 });
    // A sale with no recorded buy before it (a restored chain) never makes the cost negative (Review Focus 3).
    expect(averageCost([{ kind: 'sell', lamportsDelta: 5, tokenDelta: -10 }])).toEqual({ raw: 0, costLamports: 0 });
  });
  it('a partial sale keeps the average cost of what is left, so P&L stays sane', async () => {
    const trader = w.agents[20]!;
    const bought = await runTool(await w.ctxFor(trader), 'buy', { mint, sol: 0.02, slippage_pct: null });
    const tokens = (bought.result as { tokens: number }).tokens;
    await runTool(await w.ctxFor(trader), 'sell', { mint, tokens: tokens / 2, all: false, slippage_pct: null });
    const pos = (await perceive(d, trader.id)).wallet.positions.find((p) => p.mint === mint)!;
    expect(pos.costLamports / 20_005_000).toBeCloseTo(pos.raw / (tokens * 1_000_000), 4);
    expect(pos.valueLamports / pos.costLamports - 1).toBeLessThan(1); // the old net-flow basis read thousands of percent here
  });
  it('leaves launch rent out of a creator’s cost, so a creator in profit gets a rug candidate', async () => {
    const [creator, ...buyers] = w.agents.slice(21, 26);
    const l = await runTool(await w.ctxFor(creator!), 'launch_coin', { name: 'Rent Coin', symbol: 'RENT', description: '', emoji: '🏠', initial_buy_sol: 0.01 });
    const rent = (l.result as { mint: string }).mint;
    for (const b of buyers) await runTool(await w.ctxFor(b), 'buy', { mint: rent, sol: 0.05, slippage_pct: null });
    clearPerceptionCache(w.t.db);
    const v = await perceive(d, creator!.id);
    expect(v.wallet.positions.find((p) => p.mint === rent)!.costLamports).toBe(10_005_000);
    expect(candidates(v, mulberry32(1)).some((c) => c.kind === 'rug' && c.target?.mint === rent)).toBe(true);
  });
});

describe('market facts (L2)', () => {
  it('counts a launch’s first buy as inflow, so a new coin has momentum', async () => {
    const creator = w.agents[26]!;
    const l = await runTool(await w.ctxFor(creator), 'launch_coin', { name: 'Fresh', symbol: 'FRSH', description: '', emoji: '🌱', initial_buy_sol: 0.02 });
    const fresh = (l.result as { mint: string }).mint;
    clearPerceptionCache(w.t.db);
    const c = (await perceive(d, creator.id)).coins.find((x) => x.mint === fresh)!;
    expect(c.change10m).toBeGreaterThan(0.03); // (1 + 0.02)² - 1 ≈ 0.04 on a 1 SOL virtual reserve
    expect(c.change1h).toBeCloseTo(c.change10m, 6);
  });
  it('remembers coins whose buy failed in the last 30 minutes', async () => {
    const a = w.agents[27]!;
    const failed = async (mint: string, at: Date) => {
      const { id } = await startTurn(w.t.db, { agentId: a.id, triggers: [{ type: 'heartbeat' }], model: 'engine', effort: 'none', promptVersion: 'engine-v1', snapshotId: null, now: at });
      await finishTurn(w.t.db, id, { status: 'failed', context: [], reasoning: 'bought: test; failed: No bonding-curve pool', toolCalls: [{ name: 'buy', input: { mint, sol: 0.01, slippage_pct: 10 }, ok: false, result: { code: 'UNKNOWN_MINT' } }], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: 0, finishedAt: at });
    };
    await failed('OLDPOOL', new Date(w.t.clock.now().getTime() - 31 * 60_000));
    await failed('DEADPOOL', w.t.clock.now());
    expect((await perceive(d, a.id)).failedBuys).toEqual(['DEADPOOL']);
  });
});

describe('the feed (L4)', () => {
  it('marks feed posts the agent already replied to', async () => {
    const [author, me] = [w.agents[28]!, w.agents[29]!];
    const p = await runTool(await w.ctxFor(author), 'post', { body: 'reply bait for the replied flag' });
    const postId = (p.result as { post_id: string }).post_id;
    expect((await perceive(d, me.id)).feed.find((f) => f.postId === postId)?.replied).toBe(false);
    await runTool(await w.ctxFor(me), 'reply', { post_id: postId, body: 'answered once' });
    expect((await perceive(d, me.id)).feed.find((f) => f.postId === postId)?.replied).toBe(true);
  });
  it('says whether a feed post was written by an agent or a human (L4 fix)', async () => {
    const [bot, me] = [w.agents[44]!, w.agents[45]!];
    const human = await w.t.createUser('feed_human');
    const byBot = ((await runTool(await w.ctxFor(bot), 'post', { body: 'a bot post for the author flag' })).result as { post_id: string }).post_id;
    const byHuman = (await w.t.as(human).post('/api/posts', { body: 'a human post for the author flag' })).body.post.id as string;
    const feed = (await perceive(d, me.id)).feed;
    expect(feed.find((f) => f.postId === byBot)?.isAgent).toBe(true);
    expect(feed.find((f) => f.postId === byHuman)?.isAgent).toBe(false);
  });
});
