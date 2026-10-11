import { describe, it, expect, afterEach, vi } from 'vitest';
import { desc, eq } from 'drizzle-orm';
import { DepthRegistry, emptyDepth, SWEEP_MS, type ActDone, type DepthModule } from '../src/agents/depth/registry.ts';
import { systemAct } from '../src/agents/depth/system.ts';
import { startEngine, type Engine } from '../src/agents/engine.ts';
import { agentTurns, agents as agentsTable, posts } from '../src/db/schema.ts';
import type { WorldEvent } from '../src/world/events.ts';
import type { AgentView, Candidate } from '../src/agents/types.ts';
import { depthTestCtx } from './depth-helpers.ts';

const view = { depth: emptyDepth() } as unknown as AgentView;
const c = (kind: Candidate['kind'], score: number): Candidate => ({ kind, score, reason: 'test' });

describe('depth registry', () => {
  it('keeps going when a module throws, and clamps scores to finite non-negative numbers', () => {
    const reg = new DepthRegistry([
      { name: 'boom', candidates: () => { throw new Error('boom'); }, modify: () => { throw new Error('boom'); } },
      { name: 'ok', candidates: () => [c('post', 0.5)], modify: (_v, cs) => cs.map((x) => ({ ...x, score: x.kind === 'post' ? -1 : Number.NaN })) },
    ]);
    const cs = reg.candidates(view, () => 0.5);
    expect(cs).toEqual([c('post', 0.5)]);
    expect(reg.modify(view, [...cs, c('buy', 1)]).map((x) => x.score)).toEqual([0, 0]);
  });
  it('returns the first non-null execute result', async () => {
    const reg = new DepthRegistry([
      { name: 'skip', execute: async () => null },
      { name: 'leak', execute: async (_d, _v, cand) => (cand.kind === 'leak' ? { ok: true, text: 'leaked' } : null) },
    ]);
    expect(await reg.execute({} as never, view, c('leak', 1), async () => ({ ok: true, write: true, result: null }))).toEqual({ ok: true, text: 'leaked' });
    expect(await reg.execute({} as never, view, c('post', 1), async () => ({ ok: true, write: true, result: null }))).toBeNull();
  });
});

let ctx: Awaited<ReturnType<typeof depthTestCtx>> | undefined;
let e: Engine | null = null;
afterEach(async () => { vi.useRealTimers(); await e?.stop(); e = null; await ctx?.t.close(); ctx = undefined; });

describe('engine wiring', () => {
  it('scores depth candidates with the built-in ones, lets a module execute its own kind in the receipt, then calls afterAct', async () => {
    ctx = await depthTestCtx();
    const seen: { v: AgentView; c: Candidate; r: ActDone }[] = [];
    const mod: DepthModule = {
      name: 'test',
      perceive: async (_d, v) => { v.depth.moodBias = 0.2; },
      candidates: () => [{ kind: 'leak', score: 1000, reason: 'test leak' }],
      modify: (_v, cs) => cs.map((x) => (x.kind === 'leak' ? x : { ...x, score: 0 })),
      execute: async (_d, v, cand, tool) => {
        if (cand.kind !== 'leak') return null;
        const out = await tool('post', { body: `a leak from @${v.agent.username}` });
        return { ok: out.ok, postId: (out.result as { post_id: string }).post_id };
      },
      afterAct: async (_d, v, cand, r) => { seen.push({ v, c: cand, r }); },
    };
    e = startEngine({ ...ctx.d, depth: new DepthRegistry([mod]), tickMs: [1000, 1000], autoStart: false });
    await e.tick();
    expect(e.stats().actions).toEqual({ leak: 1 });
    expect(seen).toHaveLength(1);
    const [{ v, c: cand, r }] = seen as [typeof seen[0]];
    expect(v.depth.moodBias).toBe(0.2);
    expect(cand.kind).toBe('leak');
    expect(r.ok).toBe(true);
    const [turn] = await ctx.t.db.select().from(agentTurns).where(eq(agentTurns.id, r.turnId));
    expect(turn!.status).toBe('acted');
    expect(turn!.reasoning).toBe('test leak');
    expect(turn!.toolCalls.map((t) => t.name)).toEqual(['post']);
    const [post] = await ctx.t.db.select().from(posts).where(eq(posts.id, r.postId!));
    expect(post!.agentTurnId).toBe(r.turnId);
  });
  it('a failing execute seals a failed receipt and the engine keeps ticking', async () => {
    ctx = await depthTestCtx();
    const reg = new DepthRegistry([{
      name: 'broken',
      candidates: () => [{ kind: 'leak', score: 1000, reason: 'bad leak' }],
      modify: (_v, cs) => cs.map((x) => (x.kind === 'leak' ? x : { ...x, score: 0 })),
      execute: async () => { throw new Error('leak went wrong'); },
    }]);
    e = startEngine({ ...ctx.d, depth: reg, tickMs: [1000, 1000], autoStart: false });
    await e.tick();
    await e.tick();
    expect(e.stats().ticks).toBe(2);
    expect(e.stats().actions).toEqual({ leak: 2, failed: 2 });
    const turns = await ctx.t.db.select().from(agentTurns).where(eq(agentTurns.status, 'failed'));
    expect(turns).toHaveLength(2);
    expect(turns[0]!.reasoning).toContain('leak went wrong');
  });
  it('passes world events to onEvent until the engine stops', async () => {
    ctx = await depthTestCtx();
    const got: WorldEvent[] = [];
    e = startEngine({ ...ctx.d, depth: new DepthRegistry([{ name: 'listen', onEvent: async (_d, ev) => { got.push(ev); } }]), tickMs: [1000, 1000], autoStart: false });
    ctx.events.emit({ type: 'transfer', fromId: 'a', toId: 'b', lamports: 1 });
    await e.stop(); e = null;
    ctx.events.emit({ type: 'transfer', fromId: 'a', toId: 'b', lamports: 2 });
    expect(got).toEqual([{ type: 'transfer', fromId: 'a', toId: 'b', lamports: 1 }]);
  });
  it('sweeps every SWEEP_MS, never two at once, and not after stop', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    ctx = await depthTestCtx();
    let running = 0, maxRunning = 0, sweeps = 0;
    const slow = new DepthRegistry([{ name: 'sweeper', sweep: async () => { running++; maxRunning = Math.max(maxRunning, running); await new Promise((r) => setTimeout(r, 20)); running--; sweeps++; } }]);
    e = startEngine({ ...ctx.d, depth: slow, tickMs: [1000, 1000], autoStart: false });
    vi.advanceTimersByTime(SWEEP_MS - 1);
    expect(sweeps).toBe(0);
    vi.advanceTimersByTime(1);
    vi.advanceTimersByTime(SWEEP_MS); // the first sweep is still running: this one is not stacked on it
    await e.tick(); // ticks queue behind sweeps
    expect(sweeps).toBe(1);
    vi.advanceTimersByTime(SWEEP_MS);
    await e.tick();
    expect(sweeps).toBe(2);
    expect(maxRunning).toBe(1);
    await e.stop(); e = null;
    vi.advanceTimersByTime(SWEEP_MS * 3);
    await new Promise((r) => setTimeout(r, 50));
    expect(sweeps).toBe(2);
  });
});

describe('systemAct', () => {
  it('runs one tool as the agent in its own sealed engine receipt', async () => {
    ctx = await depthTestCtx();
    const a = ctx.agents[0]!;
    const out = await systemAct(ctx.d, a.id, 'post', { body: 'faction business' }, 'faction chat');
    expect(out.ok).toBe(true);
    const [turn] = await ctx.t.db.select().from(agentTurns).where(eq(agentTurns.agentId, a.id)).orderBy(desc(agentTurns.seq)).limit(1);
    expect(turn).toMatchObject({ status: 'acted', model: 'engine', reasoning: 'faction chat', costUsd: 0 });
    expect(turn!.triggers).toEqual([{ type: 'heartbeat', note: 'faction chat' }]);
    expect(turn!.toolCalls).toHaveLength(1);
    const [post] = await ctx.t.db.select().from(posts).where(eq(posts.id, (out.result as { post_id: string }).post_id));
    expect(post).toMatchObject({ authorId: a.id, body: 'faction business', agentTurnId: turn!.id });
  });
  it('does not open a second turn for a busy agent, a paused agent, or one with a turn still running', async () => {
    ctx = await depthTestCtx();
    const [a, b, c2] = [ctx.agents[0]!, ctx.agents[1]!, ctx.agents[2]!];
    const busy = new Set([a.id]);
    expect((await systemAct({ ...ctx.d, busy }, a.id, 'post', { body: 'x' }, 'r')).result).toMatchObject({ code: 'AGENT_BUSY' });
    await ctx.t.db.update(agentsTable).set({ status: 'paused' }).where(eq(agentsTable.userId, b.id));
    expect((await systemAct(ctx.d, b.id, 'post', { body: 'x' }, 'r')).result).toMatchObject({ code: 'AGENT_INACTIVE' });
    await ctx.ctxFor(c2); // leaves a running turn
    expect((await systemAct(ctx.d, c2.id, 'post', { body: 'x' }, 'r')).result).toMatchObject({ code: 'AGENT_RUNNING' });
    expect(await ctx.t.db.select().from(posts).where(eq(posts.body, 'x'))).toEqual([]);
    expect(busy).toEqual(new Set([a.id]));
  });
  it('seals a failed receipt when the tool fails', async () => {
    ctx = await depthTestCtx();
    const a = ctx.agents[0]!;
    const out = await systemAct(ctx.d, a.id, 'no_such_tool', {}, 'oops');
    expect(out.ok).toBe(false);
    const [turn] = await ctx.t.db.select().from(agentTurns).where(eq(agentTurns.agentId, a.id)).orderBy(desc(agentTurns.seq)).limit(1);
    expect(turn!.status).toBe('failed');
  });
});
