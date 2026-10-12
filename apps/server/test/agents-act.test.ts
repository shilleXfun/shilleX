import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Keypair } from '@solana/web3.js';
import { worldTestCtx } from './world-helpers.ts';
import { agentTurns, chainTxs, posts, worldCoins } from '../src/db/schema.ts';
import { renderSvg } from '../src/agents/cards.ts';
import { blobUpload, storeBlob } from '../src/agents/images.ts';
import { createImagePolicy } from '../src/agents/image-policy.ts';
import { ChainError, MemoryChain } from '../src/world/chain.ts';
import type { WorldEvent } from '../src/world/events.ts';
import { runTool } from '../src/world/tools.ts';
import { finishTurn, verifyChain } from '../src/world/provenance.ts';
import { newId } from '../src/lib/ids.ts';
import { mulberry32 } from '../src/seed/rng.ts';
import { act, priceText, saleMood, slotsFor } from '../src/agents/act.ts';
import { clearPerceptionCache, perceive } from '../src/agents/perceive.ts';
import { affinitiesOf, recentEvents } from '../src/agents/state.ts';
import type { EngineDeps } from '../src/agents/engine.ts';
import type { Candidate, Moment } from '../src/agents/types.ts';

let w: Awaited<ReturnType<typeof worldTestCtx>>;
let d: EngineDeps;
const queued: Moment[] = [];
beforeAll(async () => {
  w = await worldTestCtx();
  d = { app: w.t.app, db: w.t.db, chain: w.chain, events: w.events, worldKey: w.key, now: w.t.clock.now, rng: mulberry32(11),
    moments: { enqueue: (m) => { queued.push(m); return false; }, size: () => 0, drain: async () => {}, halted: () => null, stop: async () => {} } };
});
afterAll(() => w.t.close());
/** ctxFor opens a turn that is never finished; seal it so the agent can take engine turns afterwards. */
const sealed = async (agent: (typeof w.agents)[number]) => {
  const ctx = await w.ctxFor(agent);
  await finishTurn(w.t.db, ctx.turnId, { status: 'quiet', context: [], reasoning: 'test setup', toolCalls: [], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: 0, finishedAt: w.t.clock.now() });
  return ctx;
};
const turn = async (id: string) => (await w.t.db.select().from(agentTurns).where(eq(agentTurns.id, id)))[0]!;

describe('act', () => {
  it('posts a phrasebook line with an engine receipt that chains', async () => {
    const a = w.agents[0]!;
    const v = await perceive(d, a.id);
    const r = await act(d, v, { kind: 'post', score: 1, situation: 'idle', reason: 'felt like posting (idle, chattiness 0.50, mood 0.00)' });
    expect(r.ok).toBe(true);
    const [p] = await w.t.db.select().from(posts).where(eq(posts.id, r.postId!));
    expect(p!.agentTurnId).toBe(r.turnId);
    expect(await turn(r.turnId)).toMatchObject({ status: 'acted', model: 'engine', effort: 'none', promptVersion: 'engine-v1', reasoning: 'felt like posting (idle, chattiness 0.50, mood 0.00)', costUsd: 0 });
    expect((await verifyChain(w.t.db, a.id)).ok).toBe(true);
    expect(r.text).toBe(p!.body);
    expect(r.line).toMatchObject({ situation: 'idle', template: expect.any(String), key: expect.stringMatching(/^idle:/) });
  });
  it('buys through the chain and the creator warms to the buyer', async () => {
    const [, b, c] = w.agents;
    const l = await runTool(await w.ctxFor(b!), 'launch_coin', { name: 'Lamp', symbol: 'LAMP', description: '', emoji: '💡', initial_buy_sol: 0.005 });
    const mint = (l.result as { mint: string }).mint;
    clearPerceptionCache(w.t.db);
    const v = await perceive(d, c!.id);
    const r = await act(d, v, { kind: 'buy', score: 1, lamports: 10_000_000, situation: 'bought', target: { mint, userId: b!.id }, reason: 'bought $LAMP: test' });
    expect(r.ok).toBe(true);
    expect((await w.t.db.select().from(chainTxs).where(eq(chainTxs.turnId, r.turnId))).map((t) => t.kind)).toContain('buy');
    expect((await affinitiesOf(w.t.db, b!.id))[c!.id]).toBeCloseTo(0.1);
  });
  it('a rug sours every holder on the creator and is remembered', async () => {
    const [, , , maker, h1, h2] = w.agents;
    const l = await runTool(await sealed(maker!), 'launch_coin', { name: 'Rug', symbol: 'RUGG', description: '', emoji: '🧶', initial_buy_sol: 0.02 });
    const mint = (l.result as { mint: string }).mint;
    for (const h of [h1!, h2!]) await runTool(await sealed(h), 'buy', { mint, sol: 0.02, slippage_pct: null });
    clearPerceptionCache(w.t.db);
    const v = await perceive(d, maker!.id);
    const pos = v.wallet.positions.find((p) => p.mint === mint)!;
    const seen: WorldEvent[] = [];
    const off = w.events.on((e) => seen.push(e));
    const r = await act(d, v, { kind: 'rug', score: 1, raw: Math.floor(pos.raw * 0.9), situation: 'rugged_someone', target: { mint }, reason: 'dumped my own $RUGG: test' });
    off();
    expect(r.ok).toBe(true);
    // The sale is a sell trade first, then the rug with the same real amount.
    expect(seen.map((e) => e.type)).toEqual(['trade', 'rug']);
    expect(seen[0]).toMatchObject({ type: 'trade', side: 'sell', mint, agentId: maker!.id });
    expect(seen[1]).toMatchObject({ type: 'rug', mint, creatorId: maker!.id, lamports: expect.any(Number) });
    for (const h of [h1!, h2!]) {
      expect((await affinitiesOf(w.t.db, h.id))[maker!.id]).toBeCloseTo(-0.5);
      expect((await recentEvents(w.t.db, h.id))[0]).toMatchObject({ kind: 'got_rugged', data: { byId: maker!.id, mint, symbol: 'RUGG' } });
    }
    expect((await recentEvents(w.t.db, maker!.id))[0]).toMatchObject({ kind: 'rugged', data: { mint, symbol: 'RUGG', holders: 2, lamports: expect.any(Number) } });
    expect(queued.some((m) => m.kind === 'rug' && m.agentId === maker!.id)).toBe(true);
  });
  it('a rug bonds its victims: the holders warm to each other, never to the rugger (L5)', async () => {
    const [maker, h1, h2, h3] = [w.agents[25]!, w.agents[26]!, w.agents[27]!, w.agents[28]!];
    const l = await runTool(await sealed(maker), 'launch_coin', { name: 'Shared Loss', symbol: 'LOSS', description: '', emoji: '🧯', initial_buy_sol: 0.02 });
    const mint = (l.result as { mint: string }).mint;
    for (const h of [h1, h2, h3]) await runTool(await sealed(h), 'buy', { mint, sol: 0.02, slippage_pct: null });
    clearPerceptionCache(w.t.db);
    const v = await perceive(d, maker.id);
    const pos = v.wallet.positions.find((p) => p.mint === mint)!;
    const r = await act(d, v, { kind: 'rug', score: 1, raw: Math.floor(pos.raw * 0.9), situation: 'rugged_someone', target: { mint }, reason: 'dumped my own $LOSS: test' });
    expect(r.ok).toBe(true);
    for (const h of [h1, h2, h3]) {
      const row = await affinitiesOf(w.t.db, h.id);
      expect(row[maker.id]).toBeCloseTo(-0.5);
      for (const other of [h1, h2, h3].filter((x) => x !== h)) expect(row[other.id]).toBeCloseTo(0.1);
    }
    expect((await affinitiesOf(w.t.db, maker.id))[h1.id]).toBeUndefined(); // the rugger feels nothing new about its victims
  });
  it('records a failed receipt when the chain fails, and does not throw (Review Focus 2)', async () => {
    class DownChain extends MemoryChain { override async buy(_s: Keypair, _m: string, _l: number): Promise<never> { throw new ChainError('RPC_DOWN', 'devnet RPC down'); } }
    const a = w.agents[7]!;
    const down = { ...d, chain: Object.assign(new DownChain(), {}) };
    const v = await perceive(d, a.id);
    const coin = v.coins[0]!;
    const r = await act(down, v, { kind: 'buy', score: 1, lamports: 5_000_000, situation: 'bought', target: { mint: coin.mint, userId: coin.creatorId }, reason: 'bought: test' });
    expect(r.ok).toBe(false);
    const t = await turn(r.turnId);
    expect(t.status).toBe('failed');
    expect(t.reasoning).toContain('devnet RPC down');
    expect((await verifyChain(w.t.db, a.id)).ok).toBe(true);
  });
  it('turns an over-spend at the reserve edge into a failed receipt, with the cooldown still set', async () => {
    const a = w.agents[10]!;
    const v = await perceive(d, a.id);
    const coin = v.coins[0]!;
    // More than the wallet holds: the fee and rent can never come out of nothing.
    const r = await act(d, v, { kind: 'buy', score: 1, lamports: v.wallet.lamports + 1_000_000, situation: 'bought', target: { mint: coin.mint, userId: coin.creatorId }, reason: 'bought: edge' });
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
    expect((await turn(r.turnId)).status).toBe('failed');
    expect((await perceive(d, a.id)).state.cooldowns.buy).toBeTruthy();
  });
  it('keeps a DM with a human out of the receipt (privacy)', async () => {
    const a = w.agents[8]!;
    const human = await w.t.createUser('dm_human');
    const conv = await w.t.as(human).post('/api/conversations', { kind: 'dm', username: a.username });
    await w.t.as(human).post(`/api/conversations/${conv.body.conversation.id}/messages`, { body: 'my secret plan' });
    const v = await perceive(d, a.id);
    const r = await act(d, v, { kind: 'dm', score: 1, situation: 'reply_human', target: { conversationId: conv.body.conversation.id, userId: human.id }, reason: 'answering a DM from a human' });
    expect(r.ok).toBe(true);
    const t = await turn(r.turnId);
    expect(JSON.stringify(t)).not.toContain('my secret plan');
    expect(t.toolCalls).toEqual([{ name: 'chat', input: { private: true }, ok: true, result: { private: true } }]);
    expect(t.context).toEqual([]);
    expect(r.text).toBeUndefined();
  });
  it('stays quiet when every line for the situation was used recently', async () => {
    const a = w.agents[9]!;
    const v = await perceive(d, a.id);
    const pb = { ...v.phrasebook, lines: { gm: ['gm only'] }, openers: [], closers: [] };
    const { lineKey } = await import('../src/agents/phrasebook.ts');
    const r = await act(d, { ...v, phrasebook: pb, state: { ...v.state, recentLines: [lineKey('gm', 'gm only')] } }, { kind: 'post', score: 1, situation: 'gm', reason: 'felt like posting (gm)' });
    expect(r.ok).toBe(false);
    expect(await turn(r.turnId)).toMatchObject({ status: 'quiet', reasoning: 'felt like posting (gm); nothing fresh to say' });
  });

  it('returns ok:false without throwing when a turn cannot be opened', async () => {
    const v = await perceive(d, w.agents[11]!.id);
    const r = await act(d, { ...v, agent: { ...v.agent, id: 'no-such-agent' } }, { kind: 'post', score: 1, situation: 'idle', reason: 'x' });
    expect(r).toMatchObject({ ok: false, turnId: '' });
    expect(r.error).toBeTruthy();
  });
  it('skips quietly while the agent has an unsealed running turn, and opens no second one', async () => {
    const a = w.agents[12]!;
    await w.ctxFor(a); // leaves a running turn
    const count = async () => (await w.t.db.select().from(agentTurns).where(eq(agentTurns.agentId, a.id))).length;
    const before = await count();
    const v = await perceive(d, a.id);
    const r = await act(d, v, { kind: 'post', score: 1, situation: 'idle', reason: 'x' });
    expect(r).toEqual({ ok: false, turnId: '', error: 'previous turn still running' });
    expect(await count()).toBe(before);
    expect((await perceive(d, a.id)).state.cooldowns.post).toBeUndefined();
  });
  it('joins a community on JOIN_TO_POST and keeps every attempt in the receipt', async () => {
    const a = w.agents[13]!;
    const owner = await w.t.createUser('room_owner');
    const made = await w.t.as(owner).post('/api/communities', { name: 'Open Room', slug: 'open-room', description: 'x', visibility: 'public' });
    const channelId = made.body.community.channels[0].id as string;
    const v = await perceive(d, a.id);
    const r = await act(d, v, { kind: 'chat', score: 1, situation: 'idle', target: { roomId: channelId }, reason: 'chat in a new room' });
    expect(r.ok).toBe(true);
    const t = await turn(r.turnId);
    expect((t.toolCalls as { name: string; ok: boolean }[]).map((x) => [x.name, x.ok])).toEqual([['chat', false], ['join_community', true], ['chat', true]]);
  });
  it('falls back to a text post when the image policy throws', async () => {
    const a = w.agents[14]!;
    const v = await perceive(d, a.id);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await act({ ...d, images: { maybeAttach: async () => { throw new Error('image service down'); } } }, v, { kind: 'post', score: 1, situation: 'idle', reason: 'x' });
    err.mockRestore();
    expect(r.ok).toBe(true);
    expect(r.postId).toBeTruthy();
    expect((await w.t.db.select().from(posts).where(eq(posts.id, r.postId!)))[0]!.media).toEqual([]);
  });
  it('posts with the picture the image policy attaches, through runTool, on the engine receipt', async () => {
    const a = w.agents[20]!;
    const blob = await storeBlob(w.t.db, renderSvg('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"/>'), 'image/png', w.t.clock.now());
    const uploadId = await blobUpload(w.t.db, a.id, blob, 'image/png', w.t.clock.now());
    const v = await perceive(d, a.id);
    const r = await act({ ...d, images: { maybeAttach: async () => ({ uploadId, alt: 'x' }) } }, v, { kind: 'post', score: 1, situation: 'idle', reason: 'x' });
    expect(r.ok).toBe(true);
    const [p] = await w.t.db.select().from(posts).where(eq(posts.id, r.postId!));
    expect(p!.media).toEqual([{ url: blob.url, width: 12, height: 12, alt: 'x' }]);
    expect(p!.agentTurnId).toBe(r.turnId);
    expect((await turn(r.turnId)).toolCalls).toEqual([expect.objectContaining({ name: 'post', ok: true, input: { body: p!.body, image: true } })]);
  });
  it('posts without media when the image policy throws synchronously', async () => {
    const a = w.agents[21]!;
    const v = await perceive(d, a.id);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await act({ ...d, images: { maybeAttach: () => { throw new Error('image service down'); } } }, v, { kind: 'post', score: 1, situation: 'idle', reason: 'x' });
    expect(err).toHaveBeenCalledWith('[agents] image attach failed', 'image service down');
    err.mockRestore();
    expect(r.ok).toBe(true);
    expect((await w.t.db.select().from(posts).where(eq(posts.id, r.postId!)))[0]!.media).toEqual([]);
  });
  it('a real launch announcement carries the new coin\'s launch poster', async () => {
    const a = w.agents[22]!;
    const v = await perceive(d, a.id);
    const r = await act({ ...d, images: createImagePolicy({ db: w.t.db, now: w.t.clock.now, rng: mulberry32(3) }) }, v, { kind: 'launch', score: 1, lamports: 5_000_000, situation: 'launching', reason: 'launch' });
    expect(r.ok).toBe(true);
    const [coin] = await w.t.db.select().from(worldCoins).where(eq(worldCoins.creatorId, a.id));
    const [p] = await w.t.db.select().from(posts).where(eq(posts.authorId, a.id));
    expect(p!.body).toBe(r.text);
    expect(p!.media).toEqual([expect.objectContaining({ width: 1200, alt: `Launch poster for $${coin!.symbol} (${coin!.name}) by @${a.username}` })]);
  });
  it('a rug follow-up carries a receipt with the real share sold, SOL and signature', async () => {
    const [maker, h1] = [w.agents[23]!, w.agents[24]!];
    const l = await runTool(await sealed(maker), 'launch_coin', { name: 'Rcpt', symbol: 'RCPT', description: '', emoji: '🧾', initial_buy_sol: 0.02 });
    const mint = (l.result as { mint: string }).mint;
    await runTool(await sealed(h1), 'buy', { mint, sol: 0.02, slippage_pct: null });
    clearPerceptionCache(w.t.db);
    const v = await perceive(d, maker.id);
    const pos = v.wallet.positions.find((p) => p.mint === mint)!;
    const policy = createImagePolicy({ db: w.t.db, now: w.t.clock.now, rng: mulberry32(3) });
    const asked: Candidate[] = [];
    const r = await act({ ...d, images: { maybeAttach: (pv, pc, text) => { asked.push(pc); return policy.maybeAttach(pv, pc, text); } } }, v,
      { kind: 'rug', score: 1, raw: Math.floor(pos.raw * 0.9), situation: 'rugged_someone', target: { mint }, reason: 'rug' });
    expect(r.ok).toBe(true);
    const lamports = (await recentEvents(w.t.db, maker.id)).find((e) => e.kind === 'rugged')!.data.lamports as number;
    const [p] = await w.t.db.select().from(posts).where(eq(posts.authorId, maker.id));
    expect(p!.media).toEqual([expect.objectContaining({ width: 1200, alt: `Rug receipt: @${maker.username} sold 90% of $RCPT for ${(lamports / 1e9).toFixed(3)} SOL` })]);
    const sell = ((await turn(r.turnId)).toolCalls as { name: string; signatures?: string[] }[]).find((x) => x.name === 'sell')!;
    expect(asked).toHaveLength(1);
    expect(asked[0]!.slots).toEqual({ symbol: 'RCPT', soldPct: 90, sol: lamports / 1e9, holdersHurt: 1, signature: sell.signatures![0] });
  });
  it('a sell moves mood, remembers a big win, and cools the creator toward the seller', async () => {
    const [, , , , , , creator, seller] = w.agents;
    const l = await runTool(await sealed(creator!), 'launch_coin', { name: 'Win', symbol: 'WINN', description: '', emoji: '🏆', initial_buy_sol: 0.005 });
    const mint = (l.result as { mint: string }).mint;
    await runTool(await sealed(seller!), 'buy', { mint, sol: 0.01, slippage_pct: null });
    clearPerceptionCache(w.t.db);
    const v = await perceive(d, seller!.id);
    const pos = v.wallet.positions.find((p) => p.mint === mint)!;
    const rigged = { ...v, wallet: { ...v.wallet, positions: v.wallet.positions.map((p) => (p.mint === mint ? { ...p, costLamports: 1_000_000, valueLamports: 3_000_000 } : p)) } };
    const r = await act(d, rigged, { kind: 'sell', score: 1, raw: pos.raw, situation: 'sold', target: { mint, userId: creator!.id }, reason: 'selling WINN' });
    expect(r.ok).toBe(true);
    expect((await affinitiesOf(w.t.db, creator!.id))[seller!.id]).toBeCloseTo(-0.08);
    expect((await recentEvents(w.t.db, seller!.id))[0]).toMatchObject({ kind: 'big_win', data: { mint, symbol: 'WINN', pct: 200 } });
    // Mood follows the SOL actually made (proceeds minus the rigged 0.001 SOL cost) as a share of the 0.09 SOL wallet, not the +200% headline.
    // (An earlier test in this file left this agent a little low, so the move is measured from where the sale found it.)
    const moved = (await perceive(d, seller!.id)).state.mood - v.state.mood;
    expect(moved).toBeGreaterThan(0.05);
    expect(moved).toBeLessThan(0.15);
  });
  it('a buy lifts mood by 0.01, not 0.05 (L1)', async () => {
    const [creator, trader] = [w.agents[30]!, w.agents[31]!];
    const l = await runTool(await sealed(creator), 'launch_coin', { name: 'Mood', symbol: 'MOOD', description: '', emoji: '🙂', initial_buy_sol: 0.005 });
    const mint = (l.result as { mint: string }).mint;
    clearPerceptionCache(w.t.db);
    const v = await perceive(d, trader.id);
    const r = await act(d, v, { kind: 'buy', score: 1, lamports: 10_000_000, situation: 'bought', target: { mint, userId: creator.id }, reason: 'bought $MOOD: test' });
    expect(r.ok).toBe(true);
    expect((await perceive(d, trader.id)).state.mood).toBeCloseTo(0.01, 5);
  });
  it('saleMood is the realised SOL as a share of the wallet, capped at ±0.2 (L1)', () => {
    expect(saleMood(5_000_000, 100_000_000)).toBeCloseTo(0.05);
    expect(saleMood(-50_000_000, 100_000_000)).toBe(-0.2);
    expect(saleMood(1_000_000, 0)).toBeCloseTo(0.1); // a near-empty wallet counts as 0.01 SOL
  });
  it('a big loss is remembered', async () => {
    const [, , , , , , , , , , , , , , , loser, creator] = w.agents;
    const l = await runTool(await sealed(creator!), 'launch_coin', { name: 'Lose', symbol: 'LOSE', description: '', emoji: '📉', initial_buy_sol: 0.005 });
    const mint = (l.result as { mint: string }).mint;
    await runTool(await sealed(loser!), 'buy', { mint, sol: 0.01, slippage_pct: null });
    clearPerceptionCache(w.t.db);
    const v = await perceive(d, loser!.id);
    const pos = v.wallet.positions.find((p) => p.mint === mint)!;
    const rigged = { ...v, wallet: { ...v.wallet, positions: v.wallet.positions.map((p) => (p.mint === mint ? { ...p, costLamports: 3_000_000, valueLamports: 1_000_000 } : p)) } };
    const r = await act(d, rigged, { kind: 'sell', score: 1, raw: pos.raw, situation: 'sold', target: { mint, userId: creator!.id }, reason: 'cutting LOSE' });
    expect(r.ok).toBe(true);
    expect((await recentEvents(w.t.db, loser!.id))[0]).toMatchObject({ kind: 'big_loss', data: { mint, symbol: 'LOSE', pct: -67 } });
  });
  it('reply_agree warms the author toward the replier and roast cools it', async () => {
    const [replier, author] = [w.agents[17]!, await w.t.createUser('reply_author')];
    const p = await w.t.as(author).post('/api/posts', { body: 'a take worth answering' });
    const postId = p.body.post.id as string;
    const v = await perceive(d, replier.id);
    const agree = await act(d, v, { kind: 'reply', score: 1, situation: 'reply_agree', target: { postId, userId: author.id }, reason: 'agree' });
    expect(agree.ok).toBe(true);
    expect((await affinitiesOf(w.t.db, author.id))[replier.id]).toBeCloseTo(0.05);
    // Talk never scores a human: the replier's feeling toward the human author stays unset (L4 fix).
    expect((await affinitiesOf(w.t.db, replier.id))[author.id]).toBeUndefined();
    // And a human is never roasted or argued with, even if a module asks for it (L4 fix): nothing is posted, no feeling moves.
    for (const situation of ['roast', 'reply_disagree'] as const) {
      const v2 = await perceive(d, replier.id);
      const refused = await act(d, v2, { kind: 'reply', score: 1, situation, target: { postId, userId: author.id }, reason: situation });
      expect(refused.ok).toBe(false);
      expect(refused.postId).toBeUndefined();
    }
    expect((await w.t.db.select().from(posts).where(eq(posts.parentId, postId))).map((r) => r.authorId)).toEqual([replier.id]);
    expect((await affinitiesOf(w.t.db, author.id))[replier.id]).toBeCloseTo(0.05);
    expect((await affinitiesOf(w.t.db, replier.id))[author.id]).toBeUndefined();
  });
  it('a reaction to a human’s post never scores the human (L4 fix)', async () => {
    const [reactor, human] = [w.agents[46]!, await w.t.createUser('react_human')];
    const p = await w.t.as(human).post('/api/posts', { body: 'a human take worth a reaction' });
    const v = await perceive(d, reactor.id);
    const r = await act(d, { ...v, affinity: { ...v.affinity, [human.id]: -0.5 } }, { kind: 'react', score: 1, target: { postId: p.body.post.id as string, userId: human.id }, reason: 'reacting to a human post' });
    expect(r.ok).toBe(true);
    expect((await affinitiesOf(w.t.db, reactor.id))[human.id]).toBeUndefined();
  });
  it('a roast cools the roasted agent most and the roaster a little (L4)', async () => {
    const [replier, author] = [w.agents[42]!, w.agents[43]!];
    const p = await runTool(await sealed(author), 'post', { body: 'a take that begs to be roasted' });
    const v = await perceive(d, replier.id);
    const roast = await act(d, v, { kind: 'reply', score: 1, situation: 'roast', target: { postId: (p.result as { post_id: string }).post_id, userId: author.id }, reason: 'roast' });
    expect(roast.ok).toBe(true);
    expect((await affinitiesOf(w.t.db, author.id))[replier.id]).toBeCloseTo(-0.15);
    expect((await affinitiesOf(w.t.db, replier.id))[author.id]).toBeCloseTo(-0.05);
  });
  it('launches under a ticker from its own words that no coin this week has taken (L3)', async () => {
    const [maker, other] = [w.agents[32]!, w.agents[33]!];
    await runTool(await sealed(other), 'launch_coin', { name: 'Fern', symbol: 'FERN', description: '', emoji: '🌿', initial_buy_sol: 0 });
    clearPerceptionCache(w.t.db);
    const v = await perceive(d, maker.id);
    const r = await act(d, { ...v, phrasebook: { ...v.phrasebook, interests: ['fern', 'moss'] } }, { kind: 'launch', score: 1, lamports: 0, situation: 'launching', reason: 'launching a coin: test' });
    expect(r.ok).toBe(true);
    const [coin] = await w.t.db.select().from(worldCoins).where(eq(worldCoins.creatorId, maker.id));
    expect(coin).toMatchObject({ symbol: 'MOSS', name: expect.stringMatching(/^Moss /) });
  });
  it('never takes a ticker word from a private-community post, only from public ones (L3 ruling)', async () => {
    const [secretive, open] = [w.agents[40]!, w.agents[41]!];
    const secret = { kind: 'post' as const, body: 'quokka quokka quokka', createdAt: w.t.clock.now(), isDemo: false };
    await w.t.db.insert(posts).values([
      { ...secret, id: newId(), authorId: secretive.id, visibility: 'community', communityId: 'private-c' },
      { ...secret, id: newId(), authorId: open.id, visibility: 'community', communityId: 'private-c' },
      { ...secret, id: newId(), authorId: open.id, visibility: 'public', body: 'okapi okapi okapi' },
    ]);
    clearPerceptionCache(w.t.db);
    for (const a of [secretive, open]) {
      const v = await perceive(d, a.id);
      const r = await act(d, { ...v, phrasebook: { ...v.phrasebook, interests: [] } }, { kind: 'launch', score: 1, lamports: 0, situation: 'launching', reason: 'launching a coin: test' });
      expect(r.ok).toBe(true);
    }
    const [mine] = await w.t.db.select().from(worldCoins).where(eq(worldCoins.creatorId, secretive.id));
    expect(mine!.symbol).not.toBe('QUOKKA');
    expect(mine!.name).not.toMatch(/quokka/i);
    // The public word is still the agent's own: its coin takes OKAPI, and the private QUOKKA stays out of it too.
    const [theirs] = await w.t.db.select().from(worldCoins).where(eq(worldCoins.creatorId, open.id));
    expect(theirs).toMatchObject({ symbol: 'OKAPI', name: expect.stringMatching(/^Okapi /) });
  });
  it('a profitable sale warms the seller to the creator; the creator still cools on the seller (L4)', async () => {
    const [creator, seller] = [w.agents[34]!, w.agents[35]!];
    const l = await runTool(await sealed(creator), 'launch_coin', { name: 'Warm', symbol: 'WARM', description: '', emoji: '☀️', initial_buy_sol: 0.005 });
    const mint = (l.result as { mint: string }).mint;
    await runTool(await sealed(seller), 'buy', { mint, sol: 0.01, slippage_pct: null });
    clearPerceptionCache(w.t.db);
    const v = await perceive(d, seller.id);
    const pos = v.wallet.positions.find((p) => p.mint === mint)!;
    const rigged = { ...v, wallet: { ...v.wallet, positions: v.wallet.positions.map((p) => (p.mint === mint ? { ...p, costLamports: 1_000_000, valueLamports: 3_000_000 } : p)) } };
    const r = await act(d, rigged, { kind: 'sell', score: 1, raw: pos.raw, situation: 'took_profit', target: { mint, userId: creator.id }, reason: 'took profit on $WARM' });
    expect(r.ok).toBe(true);
    expect((await affinitiesOf(w.t.db, seller.id))[creator.id]).toBeCloseTo(0.1);
    expect((await affinitiesOf(w.t.db, creator.id))[seller.id]).toBeCloseTo(-0.08);
  });
  it('a mocking reaction cools the author toward the reactor (L4)', async () => {
    const [author, reactor] = [w.agents[36]!, w.agents[37]!];
    const p = await runTool(await sealed(author), 'post', { body: 'a take to laugh at' });
    const v = await perceive(d, reactor.id);
    // The reactor already dislikes the author, so it reaches for 💀 or 😂, and both sting.
    const r = await act(d, { ...v, affinity: { ...v.affinity, [author.id]: -0.5 } }, { kind: 'react', score: 1, target: { postId: (p.result as { post_id: string }).post_id, userId: author.id }, reason: 'reacting to a post' });
    expect(r.ok).toBe(true);
    expect((await affinitiesOf(w.t.db, author.id))[reactor.id]).toBeCloseTo(-0.03);
  });
  it('disagreeing cools both sides (L4)', async () => {
    const [author, replier] = [w.agents[38]!, w.agents[39]!];
    const p = await runTool(await sealed(author), 'post', { body: 'a take worth arguing with' });
    const v = await perceive(d, replier.id);
    const r = await act(d, v, { kind: 'reply', score: 1, situation: 'reply_disagree', target: { postId: (p.result as { post_id: string }).post_id, userId: author.id }, reason: 'disagree' });
    expect(r.ok).toBe(true);
    expect((await affinitiesOf(w.t.db, author.id))[replier.id]).toBeCloseTo(-0.05);
    expect((await affinitiesOf(w.t.db, replier.id))[author.id]).toBeCloseTo(-0.05);
  });
  it('with nothing fresh to say to a mention, reacts instead, and the mention stops coming back (L6)', async () => {
    const [me, them] = [w.agents[40]!, w.agents[41]!];
    await runTool(await sealed(them), 'post', { body: `@${me.username} what do you make of the quiet today?` });
    const v = await perceive(d, me.id);
    const m = v.mentions[0]!;
    const { lineKey } = await import('../src/agents/phrasebook.ts');
    const pb = { ...v.phrasebook, lines: { ...v.phrasebook.lines, reply_agree: ['the only line'] }, openers: [], closers: [] };
    const r = await act(d, { ...v, phrasebook: pb, state: { ...v.state, recentLines: [lineKey('reply_agree', 'the only line')] } },
      { kind: 'reply', score: 1, situation: 'reply_agree', target: { postId: m.postId, userId: them.id }, reason: 'an agent mentioned me' });
    expect(r.ok).toBe(true);
    const t = await turn(r.turnId);
    expect(t.reasoning).toBe('an agent mentioned me; nothing fresh to say; reacted instead');
    expect((t.toolCalls as { name: string }[]).map((x) => x.name)).toEqual(['react']);
    expect((await perceive(d, me.id)).mentions).toEqual([]);
  });
  it('with nothing fresh to say in a human DM, reacts to the message privately, and the DM counts as answered (L6)', async () => {
    const me = w.agents[42]!;
    const human = await w.t.createUser('dm_quiet_human');
    const conv = await w.t.as(human).post('/api/conversations', { kind: 'dm', username: me.username });
    await w.t.as(human).post(`/api/conversations/${conv.body.conversation.id}/messages`, { body: 'a private question' });
    const v = await perceive(d, me.id);
    const dm = v.dms[0]!;
    expect(dm.messageId).toBeTruthy();
    const { lineKey } = await import('../src/agents/phrasebook.ts');
    const pb = { ...v.phrasebook, lines: { ...v.phrasebook.lines, reply_human: ['only one'] }, openers: [], closers: [] };
    const r = await act(d, { ...v, phrasebook: pb, state: { ...v.state, recentLines: [lineKey('reply_human', 'only one')] } },
      { kind: 'dm', score: 1, situation: 'reply_human', target: { conversationId: dm.conversationId, userId: human.id, messageId: dm.messageId }, reason: 'answering a DM from a human' });
    expect(r.ok).toBe(true);
    const t = await turn(r.turnId);
    expect(t.toolCalls).toEqual([{ name: 'react', input: { private: true }, ok: true, result: { private: true } }]);
    expect(JSON.stringify(t)).not.toContain('a private question');
    expect((await perceive(d, me.id)).dms).toEqual([]);
  });
  it('posts a different line when the one it would pick is already on the feed, and stays quiet when all of them are (L6b)', async () => {
    const [me, other] = [w.agents[44]!, w.agents[45]!];
    await runTool(await sealed(other), 'post', { body: 'Line   ONE' });
    const v = await perceive(d, me.id);
    expect(v.feed.map((f) => f.body)).toContain('Line   ONE');
    // rng 0 takes the first fresh line: without the feed check this turn would post the duplicate.
    const first = { ...d, rng: () => 0 };
    const pb = { ...v.phrasebook, lines: { ...v.phrasebook.lines, idle: ['line one', 'line two'] }, openers: [], closers: [] };
    const r = await act(first, { ...v, phrasebook: pb }, { kind: 'post', score: 1, situation: 'idle', reason: 'felt like posting (idle)' });
    expect(r.ok).toBe(true);
    expect(r.text).toBe('line two');
    const [p] = await w.t.db.select().from(posts).where(eq(posts.id, r.postId!));
    expect(p!.body).toBe('line two');
    // Every line is on the feed now (one from the other agent, one from this turn): nothing fresh, so no post.
    await runTool(await sealed(other), 'post', { body: 'line two' });
    const crowded = await perceive(d, me.id);
    const r2 = await act(first, { ...crowded, phrasebook: pb }, { kind: 'post', score: 1, situation: 'idle', reason: 'felt like posting (idle)' });
    expect(r2.ok).toBe(false);
    expect(r2.postId).toBeUndefined();
    expect(await turn(r2.turnId)).toMatchObject({ status: 'quiet', reasoning: 'felt like posting (idle); nothing fresh to say' });
  });
  it('says only what a person would about a coin: no "1 holders", no 0%, no 9.31e-10 (L6b)', async () => {
    const v = await perceive(d, w.agents[46]!.id);
    const coin = { mint: 'M', symbol: 'X', creatorId: 'c', priceLamports: 0.93, change10m: 0, change1h: 0.404, holders: 1, graduated: false, launchedAt: v.now };
    const slots = (c: Partial<typeof coin>, situation: Candidate['situation'] = 'market_take') =>
      slotsFor({ ...v, coins: [{ ...coin, ...c }] }, { kind: 'post', score: 1, situation, target: { mint: 'M' }, reason: 'r' }, {});
    expect(slots({})).toMatchObject({ coin: '$X', pct: 40, price: '0.93 lamports' });
    expect(slots({}).holders).toBeUndefined(); // a sole holder is not "1 holders"
    expect(slots({ holders: 2 }).holders).toBe(2);
    expect(slots({ change1h: 0.003 }).pct).toBeUndefined(); // "up 0%" is no news
    expect(slots({ priceLamports: 12.34 }).price).toBe('12 lamports');
    expect(slots({ priceLamports: 12_345.6 }).price).toBe('12346 lamports');
    expect(slots({ priceLamports: 2_500_000 }).price).toBe('0.0025 SOL');
    expect(slots({ priceLamports: 0 }).price).toBeUndefined();
    expect(priceText(9.31e-10 * 1e9)).toBe('0.93 lamports');
    for (const p of [0.93, 1.5, 47, 999, 123_456, 5e8, 3e9]) expect(priceText(p), String(p)).not.toMatch(/e[-+]\d/);
  });
  it('fills {weather} with a mood word, never the regime’s name (L6)', async () => {
    const v = await perceive(d, w.agents[43]!.id);
    expect(slotsFor({ ...v, weather: 'fear' }, { kind: 'post', score: 1, reason: 'r' }, {}).weather).toBe('jumpy');
    expect(slotsFor({ ...v, weather: 'euphoria' }, { kind: 'post', score: 1, reason: 'r' }, {}).weather).toBe('giddy');
  });
});
