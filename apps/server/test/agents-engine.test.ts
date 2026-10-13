import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import type { Keypair } from '@solana/web3.js';
import { worldTestCtx } from './world-helpers.ts';
import { agentState, agentTurns, agents as agentsTable, phrasebooks, posts } from '../src/db/schema.ts';
import { ChainError, MemoryChain } from '../src/world/chain.ts';
import { mulberry32 } from '../src/seed/rng.ts';
import { pickAgent, startEngine, type Engine, type EngineDeps } from '../src/agents/engine.ts';
import type { Moment } from '../src/agents/types.ts';
import { DepthRegistry } from '../src/agents/depth/registry.ts';

let w: Awaited<ReturnType<typeof worldTestCtx>>;
let e: Engine | null = null;
beforeEach(async () => { w = await worldTestCtx(); });
afterEach(async () => { await e?.stop(); e = null; await w.t.close(); });
const deps = (over: Partial<EngineDeps> = {}): EngineDeps => ({ app: w.t.app, db: w.t.db, chain: w.chain, events: w.events, worldKey: w.key, now: w.t.clock.now, rng: mulberry32(5), ...over });
const run = async (n: number) => { for (let i = 0; i < n; i++) { await e!.tick(); w.t.clock.advance(60_000); } };

describe('engine', () => {
  it('runs agents with no phrasebook on the fallback voice, without asking for the model (Review Focus 1)', async () => {
    const asked: Moment[] = [];
    e = startEngine({ ...deps({ moments: { enqueue: (m) => { asked.push(m); return false; }, size: () => 0, drain: async () => {}, halted: () => null, stop: async () => {} } }), tickMs: [1000, 1000], autoStart: false });
    await run(60);
    expect(e.stats().ticks).toBe(60);
    expect((await w.t.db.select({ n: sql<number>`count(*)::int` }).from(posts).where(sql`${posts.agentTurnId} is not null`))[0]!.n).toBeGreaterThan(0);
    expect(await w.t.db.select().from(phrasebooks)).toEqual([]);
    // Since Phase 3 the tick also asks for missing phrasebooks; the refused asks leave the fallback voice in place.
    expect(asked.every((m) => ['launch', 'rug', 'graduation', 'phrasebook'].includes(m.kind))).toBe(true);
    expect(asked.some((m) => m.kind === 'phrasebook')).toBe(true);
    // Every tick took a turn: a receipt each, except resting, which writes none (server-rest M6).
    expect((await w.t.db.select().from(agentTurns).where(eq(agentTurns.model, 'engine'))).length + (e.stats().actions.idle ?? 0)).toBe(60);
  });
  it('rests without a receipt or a state write, and still counts the turn (server-rest M6)', async () => {
    const rest = new DepthRegistry([{ name: 'rest', modify: (_v, cs) => cs.map((c) => (c.kind === 'idle' ? c : { ...c, score: 0 })) }]);
    e = startEngine({ ...deps({ depth: rest }), tickMs: [1000, 1000], autoStart: false });
    await run(10);
    expect(e.stats().actions).toEqual({ idle: 10 });
    expect(await w.t.db.select().from(agentTurns)).toEqual([]);
    expect((await w.t.db.select().from(agentState)).filter((s) => s.cooldowns.idle)).toEqual([]);
  });
  it('keeps ticking when the chain is down: failed receipts, no thrown tick (Review Focus 2)', async () => {
    class DownChain extends MemoryChain {
      override async buy(_s: Keypair, _m: string, _l: number): Promise<never> { throw new ChainError('RPC_DOWN', 'devnet RPC down'); }
      override async balances(): Promise<never> { throw new ChainError('RPC_DOWN', 'devnet RPC down'); }
    }
    e = startEngine({ ...deps({ chain: new DownChain() }), tickMs: [1000, 1000], autoStart: false });
    await expect(run(20)).resolves.toBeUndefined();
    expect(e.stats().ticks).toBe(20);
    expect(e.stats().lastError).toContain('devnet RPC down');
  });
  it('prefers agents someone just talked to, and never picks a paused agent', async () => {
    const human = await w.t.createUser('pinger');
    const target = w.agents[3]!;
    await w.t.as(human).post('/api/posts', { body: `@${target.username} you there?` });
    await w.t.db.update(agentsTable).set({ status: 'paused' }).where(sql`${agentsTable.userId} <> ${target.id} and ${agentsTable.userId} <> ${w.agents[4]!.id}`);
    const d = deps({ rng: mulberry32(1) });
    const picks = await Promise.all(Array.from({ length: 40 }, () => pickAgent(d)));
    expect(new Set(picks)).toEqual(new Set([target.id, w.agents[4]!.id]));
    expect(picks.filter((p) => p === target.id).length).toBeGreaterThan(20);
  });
  it('weights agents by the energy they have now, not the figure their last action stored (rests write no row)', async () => {
    const [rested, tired] = [w.agents[5]!, w.agents[6]!];
    await w.t.db.update(agentsTable).set({ status: 'paused' }).where(sql`${agentsTable.userId} <> ${rested.id} and ${agentsTable.userId} <> ${tired.id}`);
    const traits = { risk: 0.5, chattiness: 0.5, loyalty: 0.5, pettiness: 0.5, greed: 0.5, humor: 0.5, curiosity: 0.5 };
    const now = w.t.clock.now();
    for (const [id, updatedAt] of [[rested.id, new Date(now.getTime() - 2 * 3_600_000)], [tired.id, now]] as const) {
      await w.t.db.insert(agentState).values({ agentId: id, energy: 0, mood: 0, traits, updatedAt })
        .onConflictDoUpdate({ target: agentState.agentId, set: { energy: 0, traits, updatedAt } });
    }
    const d = deps({ rng: mulberry32(2) });
    const picks = await Promise.all(Array.from({ length: 200 }, () => pickAgent(d)));
    // Weights 1.7 vs 0.7 once the rest counts (about 141 of 200); the stored zeros alone would make it an even split.
    expect(picks.filter((p) => p === rested.id).length).toBeGreaterThan(120);
  });
  it('stops cleanly', async () => {
    e = startEngine({ ...deps(), tickMs: [5, 10] });
    await new Promise((r) => setTimeout(r, 200));
    await e.stop();
    const after = e.stats().ticks;
    await new Promise((r) => setTimeout(r, 100));
    expect(e.stats().ticks).toBe(after);
    e = null;
  });
  it('treats a skipped act as a no-op and never overlaps ticks', async () => {
    let live = 0, peak = 0;
    const slow = new MemoryChain();
    const orig = slow.balances.bind(slow);
    slow.balances = (async (...a: Parameters<typeof orig>) => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 5)); try { return await orig(...a); } finally { live--; } }) as typeof slow.balances;
    for (const a of w.agents) slow.airdrop((await (await import('../src/world/wallets.ts')).walletOf(w.t.db, a.id))!.publicKey, 100_000_000);
    e = startEngine({ ...deps({ chain: slow }), tickMs: [1000, 1000], autoStart: false });
    await Promise.all([e.tick(), e.tick(), e.tick()]);
    expect(e.stats().ticks).toBe(3);
    expect(peak).toBeLessThanOrEqual(1);
  });
});
