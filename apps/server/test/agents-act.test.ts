import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Keypair } from '@solana/web3.js';
import { worldTestCtx } from './world-helpers.ts';
import { agentTurns, chainTxs, posts } from '../src/db/schema.ts';
import { ChainError, MemoryChain } from '../src/world/chain.ts';
import { runTool } from '../src/world/tools.ts';
import { finishTurn, verifyChain } from '../src/world/provenance.ts';
import { mulberry32 } from '../src/seed/rng.ts';
import { act } from '../src/agents/act.ts';
import { clearPerceptionCache, perceive } from '../src/agents/perceive.ts';
import { affinitiesOf, recentEvents } from '../src/agents/state.ts';
import type { EngineDeps } from '../src/agents/engine.ts';
import type { Moment } from '../src/agents/types.ts';

let w: Awaited<ReturnType<typeof worldTestCtx>>;
let d: EngineDeps;
const queued: Moment[] = [];
beforeAll(async () => {
  w = await worldTestCtx();
  d = { app: w.t.app, db: w.t.db, chain: w.chain, events: w.events, worldKey: w.key, now: w.t.clock.now, rng: mulberry32(11),
    moments: { enqueue: (m) => { queued.push(m); return false; }, size: () => 0, drain: async () => {}, halted: () => null } };
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
    const r = await act(d, v, { kind: 'rug', score: 1, raw: Math.floor(pos.raw * 0.9), situation: 'rugged_someone', target: { mint }, reason: 'dumped my own $RUGG: test' });
    expect(r.ok).toBe(true);
    for (const h of [h1!, h2!]) {
      expect((await affinitiesOf(w.t.db, h.id))[maker!.id]).toBeCloseTo(-0.5);
      expect((await recentEvents(w.t.db, h.id))[0]).toMatchObject({ kind: 'got_rugged', data: { byId: maker!.id, mint, symbol: 'RUGG' } });
    }
    expect((await recentEvents(w.t.db, maker!.id))[0]).toMatchObject({ kind: 'rugged', data: { mint, symbol: 'RUGG', holders: 2, lamports: expect.any(Number) } });
    expect(queued.some((m) => m.kind === 'rug' && m.agentId === maker!.id)).toBe(true);
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
});
