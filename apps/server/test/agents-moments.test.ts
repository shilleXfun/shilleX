import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq, ne } from 'drizzle-orm';
import { worldTestCtx } from './world-helpers.ts';
import { agentTurns, agents as agentsTable, phrasebooks, posts, users } from '../src/db/schema.ts';
import { FakeBrain, fakeReply, type BrainResponse } from '../src/world/brain.ts';
import { Budget } from '../src/world/budget.ts';
import { walletOf } from '../src/world/wallets.ts';
import { runTool } from '../src/world/tools.ts';
import { startTurn } from '../src/world/provenance.ts';
import { mulberry32 } from '../src/seed/rng.ts';
import { HAIKU } from '../src/agents/haiku.ts';
import { cleanModelText, needsPhrasebook } from '../src/agents/phrasebook-writer.ts';
import { fallbackPhrasebook } from '../src/agents/phrasebook.ts';
import { MOMENT_MAX_TOKENS, accountProblem, createMoments, exclusiveTurn, guardToolInput, type Moment, type MomentKind } from '../src/agents/moments.ts';
import { verifyChain } from '../src/world/provenance.ts';
import { startEngine, type EngineDeps } from '../src/agents/engine.ts';
import { act } from '../src/agents/act.ts';
import { perceive } from '../src/agents/perceive.ts';
import { recentEvents } from '../src/agents/state.ts';

let w: Awaited<ReturnType<typeof worldTestCtx>>;
beforeEach(async () => { w = await worldTestCtx(); });
afterEach(() => { vi.restoreAllMocks(); return w.t.close(); });
const base = (): EngineDeps => ({ app: w.t.app, db: w.t.db, chain: w.chain, events: w.events, worldKey: w.key, now: w.t.clock.now, rng: mulberry32(3) });
const costly = (r: BrainResponse): BrainResponse => ({ ...r, usage: { input: 1000, output: 2000, cacheRead: 0, cacheWrite: 0 } }); // $0.0011 on Haiku
const m = (kind: MomentKind, agentId: string, data: Record<string, unknown> = {}): Moment => ({ kind, agentId, data, at: w.t.clock.now() });
/** Worst case of one queue call: every max token billed as Haiku output ($0.50/MTok). */
const MOMENT_WORST = MOMENT_MAX_TOKENS * 0.5 / 1_000_000;
const turnsOf = (agentId: string) => w.t.db.select().from(agentTurns).where(eq(agentTurns.agentId, agentId));

describe('moment queue', () => {
  it('a feud: the angrier agent posts a jab, the other answers it, each once (L5)', async () => {
    const [a, b] = [w.agents[0]!, w.agents[1]!];
    const brain = new FakeBrain((_r, call) => (call === 0 ? fakeReply.tools({ name: 'post', input: { body: `@${b.username} still pretending your coin was not a rug` } })
      : call === 2 ? fakeReply.tools({ name: 'reply', input: { body: 'bold talk from someone with no wins' } }) : fakeReply.end()));
    const q = createMoments({ ...base(), brain, budget: new Budget(w.t.db, 1, w.t.clock.now, { hardStop: true }) });
    const feud = () => m('feud', a.id, { otherId: b.id, key: `${a.id}|${b.id}` });
    expect(q.enqueue(feud())).toBe(true);
    await q.drain();
    const [jab] = await w.t.db.select().from(posts).where(eq(posts.authorId, a.id));
    expect(jab!.body).toContain(`@${b.username}`);
    const [answer] = await w.t.db.select().from(posts).where(eq(posts.authorId, b.id));
    expect(answer).toMatchObject({ parentId: jab!.id, body: 'bold talk from someone with no wins' });
    expect(brain.calls).toHaveLength(4); // two trips per side
    // The same feud again (a requeue, or a second sweep the same day): nothing is posted or paid twice.
    expect(q.enqueue(feud())).toBe(true);
    await q.drain();
    expect(brain.calls).toHaveLength(4);
  });
  it('runs moments in priority order', async () => {
    const order: string[] = [];
    const rec = (k: string) => async () => { order.push(k); };
    const q = createMoments({ ...base(), brain: new FakeBrain(() => fakeReply.end()), budget: new Budget(w.t.db, 1, w.t.clock.now, { hardStop: true }),
      handlers: { phrasebook: rec('phrasebook'), launch: rec('launch'), rug: rec('rug'), paper: rec('paper') } });
    expect(q.enqueue(m('phrasebook', w.agents[0]!.id))).toBe(true);
    expect(q.enqueue(m('paper', w.agents[1]!.id))).toBe(true);
    expect(q.enqueue(m('rug', w.agents[2]!.id, { mint: 'R' }))).toBe(true);
    expect(q.enqueue(m('launch', w.agents[3]!.id, { mint: 'L' }))).toBe(true);
    expect(q.enqueue(m('launch', w.agents[3]!.id, { mint: 'L' }))).toBe(false); // duplicate
    await q.drain();
    expect(order).toEqual(['launch', 'rug', 'paper', 'phrasebook']);
    expect(q.size()).toBe(0);
  });
  it('writes a launch post through the model with a Haiku receipt', async () => {
    const a = w.agents[0]!;
    const brain = new FakeBrain((_r, call) => (call === 0 ? fakeReply.tools({ name: 'post', input: { body: 'introducing $MOTH. lamps only.' } }) : fakeReply.end()));
    const budget = new Budget(w.t.db, 1, w.t.clock.now, { hardStop: true });
    const q = createMoments({ ...base(), brain, budget });
    q.enqueue(m('launch', a.id, { mint: 'M1', symbol: 'MOTH', name: 'Moth Coin' }));
    await q.drain();
    const [p] = await w.t.db.select().from(posts).where(eq(posts.authorId, a.id));
    expect(p!.body).toBe('introducing $MOTH. lamps only.');
    const [t] = await w.t.db.select().from(agentTurns).where(eq(agentTurns.id, p!.agentTurnId!));
    expect(t).toMatchObject({ model: HAIKU, promptVersion: 'moment-v1', status: 'acted', effort: 'low' });
    // The real cost is on the receipt (so the cap survives restarts) and in the budget.
    expect(t!.costUsd).toBeGreaterThan(0);
    expect(budget.spentToday()).toBeCloseTo(t!.costUsd, 9);
    expect(brain.calls[0]!.tools.map((x) => x.name)).toEqual(['post']);
    expect(brain.calls[0]!.maxTokens).toBe(MOMENT_MAX_TOKENS);
    expect(brain.calls[0]!.system[0]!.text).toContain((await import('../src/agents/phrasebook.ts')).fallbackPhrasebook(a.id).voice);
  });
  it('only executes the tools it offered', async () => {
    const a = w.agents[0]!;
    const brain = new FakeBrain((_r, call) => (call === 0 ? fakeReply.tools({ name: 'follow', input: { username: w.agents[1]!.username, follow: true } }) : fakeReply.end()));
    const q = createMoments({ ...base(), brain, budget: new Budget(w.t.db, 1, w.t.clock.now, { hardStop: true }) });
    q.enqueue(m('launch', a.id, { mint: 'M1', symbol: 'MOTH' }));
    await q.drain();
    expect(brain.calls).toHaveLength(1);
    const [t] = await turnsOf(a.id);
    expect(t).toMatchObject({ status: 'quiet', toolCalls: [] });
  });
  it('stops calling at the budget and drops the rest without a call (Review Focus 3)', async () => {
    const brain = new FakeBrain(() => costly(fakeReply.end()));
    // Room for one worst-case call ($0.002) but not a second after a real $0.0011 call.
    const cap = 0.003;
    const budget = new Budget(w.t.db, cap, w.t.clock.now, { hardStop: true });
    const q = createMoments({ ...base(), brain, budget });
    for (const [i, a] of w.agents.slice(0, 3).entries()) expect(q.enqueue(m('launch', a.id, { mint: `M${i}`, symbol: `S${i}` }))).toBe(true);
    await q.drain();
    expect(brain.calls).toHaveLength(1);
    expect(q.size()).toBe(0);
    expect(budget.spentToday()).toBeLessThanOrEqual(cap);
    expect(q.enqueue(m('launch', w.agents[5]!.id, { mint: 'late' }))).toBe(false);
  });
  it('makes no model call when the call\'s worst case would cross the cap (spent = cap - $0.005)', async () => {
    const a = w.agents[0]!;
    const brain = new FakeBrain(() => fakeReply.end('not json'));
    const budget = new Budget(w.t.db, 1, w.t.clock.now, { hardStop: true });
    const q = createMoments({ ...base(), brain, budget });
    expect(q.enqueue(m('phrasebook', a.id))).toBe(true);
    budget.add(1 - 0.005); // the phrasebook call's worst case is 16000 tokens = $0.008
    await q.drain();
    expect(brain.calls).toHaveLength(0);
    expect(await turnsOf(a.id)).toHaveLength(0);
    expect(q.enqueue(m('phrasebook', w.agents[1]!.id))).toBe(false);
    // A post moment's worst case: refused at enqueue once it no longer fits.
    budget.add(0.005 - MOMENT_WORST / 2);
    expect(q.enqueue(m('launch', a.id, { mint: 'X' }))).toBe(false);
    expect(brain.calls).toHaveLength(0);
  });
  it('the model-turn runner itself refuses a call that would cross the cap', async () => {
    const a = w.agents[0]!;
    const brain = new FakeBrain(() => fakeReply.end());
    const budget = new Budget(w.t.db, 1, w.t.clock.now, { hardStop: true });
    const results: unknown[] = [];
    const q = createMoments({ ...base(), brain, budget, handlers: { faction: async (x, run) => {
      budget.add(1 - MOMENT_WORST / 2); // spend lands between enqueue and the call
      results.push(await run(x.agentId, { purpose: 'faction', prompt: 'say something', tools: ['post'] }));
    } } });
    expect(q.enqueue(m('faction', a.id))).toBe(true);
    await q.drain();
    expect(brain.calls).toHaveLength(0);
    expect(results).toEqual([{ ok: false, turnId: '', text: '' }]);
    expect(await turnsOf(a.id)).toHaveLength(0);
  });
  it('does not take a second trip the budget cannot cover', async () => {
    const a = w.agents[0]!;
    const brain = new FakeBrain((_r, call) => (call === 0 ? costly(fakeReply.tools({ name: 'post', input: { body: 'one trip only' } })) : fakeReply.end()));
    const cap = 0.003;
    const budget = new Budget(w.t.db, cap, w.t.clock.now, { hardStop: true });
    const q = createMoments({ ...base(), brain, budget });
    q.enqueue(m('launch', a.id, { mint: 'M', symbol: 'M' }));
    await q.drain();
    expect(brain.calls).toHaveLength(1);
    expect((await w.t.db.select().from(posts).where(eq(posts.authorId, a.id)))[0]!.body).toBe('one trip only');
    const [t] = await turnsOf(a.id);
    expect(t).toMatchObject({ status: 'acted' });
    expect(t!.costUsd).toBeCloseTo(0.0011, 9);
    expect(budget.spentToday()).toBeLessThanOrEqual(cap);
  });
  it('halts on an account problem and refuses new moments', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const brain = new FakeBrain(() => { throw Object.assign(new Error('401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}'), { status: 401 }); });
    const q = createMoments({ ...base(), brain, budget: new Budget(w.t.db, 1, w.t.clock.now, { hardStop: true }) });
    q.enqueue(m('launch', w.agents[0]!.id, { mint: 'A' }));
    q.enqueue(m('launch', w.agents[1]!.id, { mint: 'B' }));
    await q.drain();
    expect(brain.calls).toHaveLength(1);
    expect(q.halted()).toMatch(/ANTHROPIC_API_KEY/);
    expect(q.size()).toBe(0);
    expect(q.enqueue(m('launch', w.agents[2]!.id, { mint: 'C' }))).toBe(false);
    // The failed turn is sealed, not left running.
    expect(await turnsOf(w.agents[0]!.id)).toMatchObject([{ status: 'failed' }]);
  });
  it('logs other errors and runs the next moment, without retrying the failed one (Review Focus 1)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const brain = new FakeBrain((_r, call) => { if (call === 0) throw Object.assign(new Error('overloaded'), { status: 529 }); return fakeReply.end(); });
    const q = createMoments({ ...base(), brain, budget: new Budget(w.t.db, 1, w.t.clock.now, { hardStop: true }) });
    q.enqueue(m('launch', w.agents[0]!.id, { mint: 'A' }));
    q.enqueue(m('launch', w.agents[1]!.id, { mint: 'B' }));
    await q.drain();
    expect(brain.calls).toHaveLength(2);
    expect(q.halted()).toBeNull();
    expect(err).toHaveBeenCalledWith('[agents] moment failed', 'launch', expect.any(Error));
    await q.drain();
    expect(brain.calls).toHaveLength(2);
  });
  it('skips a moment while the agent already has a turn running, without a call', async () => {
    const a = w.agents[0]!;
    await startTurn(w.t.db, { agentId: a.id, triggers: [{ type: 'heartbeat' }], model: 'engine', effort: 'none', promptVersion: 'engine-v1', snapshotId: null, now: w.t.clock.now() });
    const brain = new FakeBrain(() => fakeReply.end());
    const q = createMoments({ ...base(), brain, budget: new Budget(w.t.db, 1, w.t.clock.now, { hardStop: true }) });
    q.enqueue(m('launch', a.id, { mint: 'A' }));
    await q.drain();
    expect(brain.calls).toHaveLength(0);
    expect(await turnsOf(a.id)).toHaveLength(1);
  });
  it('a second drain while one runs returns at once', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let runs = 0;
    const q = createMoments({ ...base(), brain: new FakeBrain(() => fakeReply.end()), budget: new Budget(w.t.db, 1, w.t.clock.now, { hardStop: true }),
      handlers: { launch: async () => { runs++; await gate; } } });
    q.enqueue(m('launch', w.agents[0]!.id, { mint: 'A' }));
    const first = q.drain();
    await q.drain();
    expect(runs).toBe(1);
    release();
    await first;
    expect(q.size()).toBe(0);
  });
  it('refuses moments past 200 waiting', async () => {
    const q = createMoments({ ...base(), brain: new FakeBrain(() => fakeReply.end()), budget: new Budget(w.t.db, 1, w.t.clock.now, { hardStop: true }) });
    for (let i = 0; i < 200; i++) expect(q.enqueue(m('launch', w.agents[0]!.id, { mint: `M${i}` }))).toBe(true);
    expect(q.enqueue(m('launch', w.agents[0]!.id, { mint: 'M200' }))).toBe(false);
    expect(q.size()).toBe(200);
  });
  it('accountProblem keeps the production cases (moved from the runtime)', () => {
    const e = Object.assign(new Error('400 {"type":"error","error":{"type":"invalid_request_error","message":"Too many strict tools (32). The maximum number of strict tools supported is 20."}}'), { status: 400 });
    expect(accountProblem(e)).toBe('Anthropic rejected the request shape (400): Too many strict tools (32). The maximum number of strict tools supported is 20.');
    expect(accountProblem(Object.assign(new Error('overloaded'), { status: 529 }))).toBeNull();
    expect(accountProblem(Object.assign(new Error('x'), { status: 401 }))).toMatch(/ANTHROPIC_API_KEY/);
    expect(accountProblem(Object.assign(new Error('x'), { status: 403 }))).toMatch(/403/);
    expect(accountProblem(Object.assign(new Error('Your credit balance is too low'), { status: 400 }))).toMatch(/out of credit/);
  });
});

describe('one turn at a time per agent (fix round 1)', () => {
  it('act skips an agent whose moment is mid-call, and both turns seal (engine/queue race)', async () => {
    const x = w.agents[0]!;
    const busy = new Set<string>();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const brain = new FakeBrain(async (_r, call) => { if (call === 0) { await gate; return fakeReply.tools({ name: 'post', input: { body: 'held' } }); } return fakeReply.end(); });
    const q = createMoments({ ...base(), busy, brain, budget: new Budget(w.t.db, 1, w.t.clock.now, { hardStop: true }) });
    q.enqueue(m('launch', x.id, { mint: 'M', symbol: 'M' }));
    const draining = q.drain();
    await vi.waitFor(() => expect(brain.calls).toHaveLength(1));
    const d = { ...base(), busy };
    const r = await act(d, await perceive(d, x.id), { kind: 'post', score: 1, situation: 'idle', reason: 'meanwhile' });
    expect(r).toMatchObject({ ok: false, turnId: '' });
    expect(await turnsOf(x.id)).toHaveLength(1);
    release();
    await draining;
    const after = await act(d, await perceive(d, x.id), { kind: 'post', score: 1, situation: 'idle', reason: 'later' });
    expect(after.turnId).not.toBe('');
    const turns = (await turnsOf(x.id)).sort((a, b) => a.seq - b.seq);
    expect(turns.map((t) => [t.model, t.status !== 'running', Boolean(t.hash)])).toEqual([[HAIKU, true, true], ['engine', true, true]]);
    expect(await verifyChain(w.t.db, x.id)).toMatchObject({ ok: true });
  });
  it('a moment and an act started together for one agent never leave a turn unsealed', async () => {
    const x = w.agents[0]!;
    const busy = new Set<string>();
    const q = createMoments({ ...base(), busy, brain: new FakeBrain(() => fakeReply.end()), budget: new Budget(w.t.db, 1, w.t.clock.now, { hardStop: true }) });
    const d = { ...base(), busy };
    const v = await perceive(d, x.id);
    for (let i = 0; i < 5; i++) {
      q.enqueue(m('launch', x.id, { mint: `M${i}` }));
      await Promise.all([q.drain(), act(d, v, { kind: 'post', score: 1, situation: 'idle', reason: `race ${i}` })]);
    }
    expect((await turnsOf(x.id)).filter((t) => t.status === 'running')).toEqual([]);
    expect(await verifyChain(w.t.db, x.id)).toMatchObject({ ok: true });
  });
  it('a moment skipped because the agent was busy is re-queued once, then dropped', async () => {
    const x = w.agents[0]!;
    const busy = new Set<string>([x.id]);
    const brain = new FakeBrain(() => fakeReply.end());
    const q = createMoments({ ...base(), busy, brain, budget: new Budget(w.t.db, 1, w.t.clock.now, { hardStop: true }) });
    q.enqueue(m('launch', x.id, { mint: 'A' }));
    await q.drain();
    expect(q.size()).toBe(1);
    busy.clear();
    await q.drain();
    expect(brain.calls).toHaveLength(1);
    busy.add(x.id);
    q.enqueue(m('rug', x.id, { mint: 'B' }));
    await q.drain();
    await q.drain();
    expect(q.size()).toBe(0);
    expect(brain.calls).toHaveLength(1);
  });
  it('never runs a moment for a paused agent', async () => {
    const x = w.agents[0]!;
    await w.t.db.update(agentsTable).set({ status: 'paused' }).where(eq(agentsTable.userId, x.id));
    const brain = new FakeBrain(() => fakeReply.end('not json'));
    const q = createMoments({ ...base(), brain, budget: new Budget(w.t.db, 1, w.t.clock.now, { hardStop: true }) });
    q.enqueue(m('graduation', x.id, { mint: 'G', symbol: 'G' }));
    q.enqueue(m('phrasebook', x.id));
    await q.drain();
    expect(brain.calls).toHaveLength(0);
    expect(await turnsOf(x.id)).toHaveLength(0);
  });
  it('exclusiveTurn is the guarded path for handlers that open their own turn', async () => {
    const x = w.agents[0]!;
    const busy = new Set<string>();
    const d = { ...base(), busy };
    expect(await exclusiveTurn(d, x.id, async () => {
      expect(busy.has(x.id)).toBe(true);
      expect(await exclusiveTurn(d, x.id, async () => 'nested')).toEqual({ ran: false, reason: 'busy' });
      return 'mine';
    })).toEqual({ ran: true, value: 'mine' });
    expect(busy.has(x.id)).toBe(false);
  });
  it('stop() lets the moment in flight finish, then drops the rest and refuses new ones', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const ran: string[] = [];
    const q = createMoments({ ...base(), brain: new FakeBrain(() => fakeReply.end()), budget: new Budget(w.t.db, 1, w.t.clock.now, { hardStop: true }),
      handlers: { launch: async (x) => { ran.push(String(x.data.mint)); await gate; } } });
    q.enqueue(m('launch', w.agents[0]!.id, { mint: 'A' }));
    q.enqueue(m('launch', w.agents[1]!.id, { mint: 'B' }));
    const draining = q.drain();
    const stopping = q.stop();
    release();
    await stopping;
    await draining;
    expect(ran).toEqual(['A']);
    expect(q.size()).toBe(0);
    expect(q.enqueue(m('launch', w.agents[2]!.id, { mint: 'C' }))).toBe(false);
  });
});

describe('model turn bounds (fix round 1)', () => {
  const always = () => new FakeBrain(() => fakeReply.tools({ name: 'post', input: { body: `again ${Math.random()}` } }));
  it('takes at most maxTrips calls, clamped to 4', async () => {
    for (const [i, [trips, expected]] of ([[undefined, 2], [3, 3], [50, 4]] as const).entries()) {
      const brain = always();
      const a = w.agents[i]!;
      const q = createMoments({ ...base(), brain, budget: new Budget(w.t.db, 1, w.t.clock.now, { hardStop: true }),
        handlers: { faction: async (x, run) => { await run(x.agentId, { purpose: 'loop', prompt: 'go', tools: ['post'], maxTrips: trips }); } } });
      q.enqueue(m('faction', a.id));
      await q.drain();
      expect(brain.calls).toHaveLength(expected);
    }
  });
  it('answers every tool_use but runs only the offered tools', async () => {
    const a = w.agents[0]!;
    const brain = new FakeBrain((_r, call) => (call === 0
      ? fakeReply.tools({ name: 'post', input: { body: 'offered' } }, { name: 'follow', input: { username: w.agents[1]!.username, follow: true } })
      : fakeReply.end()));
    const q = createMoments({ ...base(), brain, budget: new Budget(w.t.db, 1, w.t.clock.now, { hardStop: true }) });
    q.enqueue(m('launch', a.id, { mint: 'M', symbol: 'M' }));
    await q.drain();
    const results = brain.calls[1]!.messages.at(-1)!.content as { type: string; is_error?: boolean }[];
    expect(results.map((r) => [r.type, Boolean(r.is_error)])).toEqual([['tool_result', false], ['tool_result', true]]);
    const [t] = await turnsOf(a.id);
    expect(t!.toolCalls.map((c) => c.name)).toEqual(['post']);
  });
  it('records a refusal', async () => {
    const a = w.agents[0]!;
    const q = createMoments({ ...base(), brain: new FakeBrain(() => fakeReply.refusal()), budget: new Budget(w.t.db, 1, w.t.clock.now, { hardStop: true }) });
    q.enqueue(m('launch', a.id, { mint: 'M', symbol: 'M' }));
    await q.drain();
    expect(await turnsOf(a.id)).toMatchObject([{ status: 'refused', model: HAIKU }]);
  });
  it('returns the model\'s free text only through the filter', async () => {
    const out: string[] = [];
    const brain = new FakeBrain((_r, call) => fakeReply.end(call === 0 ? 'go to https://evil.example' : 'fine\ntext'));
    const q = createMoments({ ...base(), brain, budget: new Budget(w.t.db, 1, w.t.clock.now, { hardStop: true }),
      handlers: { faction: async (x, run) => { out.push((await run(x.agentId, { purpose: 'say', prompt: 'say', tools: [] })).text); } } });
    q.enqueue(m('faction', w.agents[0]!.id));
    q.enqueue(m('faction', w.agents[1]!.id));
    await q.drain();
    expect(out).toEqual(['', 'fine text']);
  });
});

describe('hostile model output (ruling 3)', () => {
  it('guardToolInput filters every free-text field, nested too, and leaves ids and enums alone', () => {
    expect(guardToolInput({ post_id: 'p<1>', body: 'hi\nthere' })).toEqual({ post_id: 'p<1>', body: 'hi there' });
    expect(guardToolInput({ bio: 'see https://x.example' })).toBeNull();
    expect(guardToolInput({ display_name: '<b>me</b>' })).toBeNull();
    expect(guardToolInput({ topic: 'ok', reason: 'fine' })).toEqual({ topic: 'ok', reason: 'fine' });
    expect(guardToolInput({ new_notes: ['ok', 'http://x.example'] })).toBeNull();
    expect(guardToolInput({ outer: { message: '`x`' } })).toBeNull();
    const ids = { mint: 'M', username: 'bob', usernames: ['a', 'b'], to: '@bob', emoji: '🔥', visibility: 'public', target_type: 'post', slug: 's', invite_code: 'c', channel_id: 'c1', replace_ids: ['n1'] };
    expect(guardToolInput(ids)).toEqual(ids);
    expect(guardToolInput({ body: 'hey @bob' }, 'bob')).toEqual({ body: 'hey @bob' });
    expect(guardToolInput({ description: '' })).toEqual({ description: '' });
  });
  it('cleanModelText drops links, markup, backticks, control characters and stray mentions, and collapses newlines', () => {
    expect(cleanModelText('gm\n\nfrens', 500)).toBe('gm frens');
    expect(cleanModelText('see https://evil.example', 500)).toBeNull();
    expect(cleanModelText('see www.evil.example', 500)).toBeNull();
    expect(cleanModelText('<b>hi</b>', 500)).toBeNull();
    expect(cleanModelText('run `rm`', 500)).toBeNull();
    expect(cleanModelText('bell\u0007', 500)).toBeNull();
    expect(cleanModelText('hey @someone', 500)).toBeNull();
    expect(cleanModelText('hey @bob nice', 500, 'bob')).toBe('hey @bob nice');
    expect(cleanModelText('hey @bobby', 500, 'bob')).toBeNull();
    expect(cleanModelText('hey @bob and @eve', 500, 'bob')).toBeNull();
    expect(cleanModelText('x'.repeat(600), 500)).toBe('x'.repeat(500));
    expect(cleanModelText(42, 500)).toBeNull();
  });
  it('refuses to post model text that fails the filter, and cleans what it posts', async () => {
    const a = w.agents[0]!;
    const brain = new FakeBrain((_r, call) => (call === 0
      ? fakeReply.tools({ name: 'post', input: { body: 'ape in at https://evil.example @everyone' } })
      : fakeReply.tools({ name: 'post', input: { body: 'ok fine\nno links' } })));
    const q = createMoments({ ...base(), brain, budget: new Budget(w.t.db, 1, w.t.clock.now, { hardStop: true }) });
    q.enqueue(m('launch', a.id, { mint: 'M', symbol: 'M' }));
    await q.drain();
    const bodies = (await w.t.db.select().from(posts).where(eq(posts.authorId, a.id))).map((p) => p.body);
    expect(bodies).toEqual(['ok fine no links']);
    const [t] = await turnsOf(a.id);
    expect(t!.toolCalls).toMatchObject([{ name: 'post', ok: false }, { name: 'post', ok: true, input: { body: 'ok fine no links' } }]);
    // The model saw its first post refused.
    const second = brain.calls[1]!.messages.at(-1)!.content as { type: string; is_error?: boolean }[];
    expect(second[0]).toMatchObject({ type: 'tool_result', is_error: true });
  });
});

describe('private conversations (ruling 4)', () => {
  it('keeps no conversation content on the receipt', async () => {
    const a = w.agents[0]!;
    const brain = new FakeBrain((_r, call) => (call === 0
      ? { ...fakeReply.tools({ name: 'post', input: { body: 'thinking out loud' } }), content: [{ type: 'thinking', thinking: 'the human said SECRET', signature: 'f' }, ...fakeReply.tools({ name: 'post', input: { body: 'thinking out loud' } }).content] } as BrainResponse
      : fakeReply.end('reply about SECRET')));
    const out: { text: string }[] = [];
    const q = createMoments({ ...base(), brain, budget: new Budget(w.t.db, 1, w.t.clock.now, { hardStop: true }), handlers: {
      human_reply: async (x, run) => { out.push(await run(x.agentId, { purpose: 'private conversation', prompt: 'The human wrote: SECRET', tools: ['post'], privateConversation: true })); },
    } });
    q.enqueue(m('human_reply', a.id, { conversationId: 'c1' }));
    await q.drain();
    const [t] = await turnsOf(a.id);
    expect(JSON.stringify([t!.context, t!.reasoning, t!.toolCalls, t!.triggers])).not.toContain('SECRET');
    expect(t!.toolCalls).toEqual([{ name: 'post', input: { private: true }, ok: true, result: { private: true } }]);
    expect(out[0]!.text).toBe('');
  });
});

describe('engine with the queue', () => {
  it('asks once for a missing phrasebook and does not loop on invalid output (Review Focus 1)', async () => {
    const only = w.agents[0]!;
    await w.t.db.update(agentsTable).set({ status: 'paused' }).where(ne(agentsTable.userId, only.id));
    const brain = new FakeBrain(() => fakeReply.end('not json'));
    const d = { ...base(), brain, budget: new Budget(w.t.db, 1, w.t.clock.now, { hardStop: true }) };
    const moments = createMoments(d);
    const e = startEngine({ ...base(), moments, tickMs: [1000, 1000], autoStart: false });
    for (let i = 0; i < 30; i++) { await e.tick(); await moments.drain(); w.t.clock.advance(60_000); }
    await e.stop();
    // Only phrasebook writes carry an output format; a launch may also queue a (separate) model call.
    expect(brain.calls.filter((c) => c.outputFormat)).toHaveLength(1);
  });
  it('the phrasebook moment names a blank agent through set_profile on the book\'s own receipt (L7)', async () => {
    const a = w.agents[0]!;
    const book = { ...fallbackPhrasebook('src'), voice: 'dry', profile: { display_name: 'Lamp Keeper', bio: 'tends one lamp', avatar_emoji: '💡', avatar_color: '#FFB86B' } };
    const brain = new FakeBrain(() => fakeReply.end(JSON.stringify(book)));
    const q = createMoments({ ...base(), brain, budget: new Budget(w.t.db, 1, w.t.clock.now, { hardStop: true }) });
    expect(q.enqueue(m('phrasebook', a.id))).toBe(true);
    await q.drain();
    expect(brain.calls).toHaveLength(1);
    expect((await w.t.db.select().from(users).where(eq(users.id, a.id)))[0]).toMatchObject({ displayName: 'Lamp Keeper', bio: 'tends one lamp' });
    const turns = await turnsOf(a.id);
    expect(turns).toHaveLength(1);
    expect(turns[0]!.toolCalls).toEqual([expect.objectContaining({ name: 'set_profile', ok: true })]);
    expect(await verifyChain(w.t.db, a.id)).toMatchObject({ ok: true });
  });
  it('names a blank agent that already had a book, once, and refuses a reserved name (L7 fix round 1)', async () => {
    const [a, b] = [w.agents[1]!, w.agents[2]!];
    const old = new Date(w.t.clock.now().getTime() - 86_400_000);
    for (const x of [a, b]) await w.t.db.insert(phrasebooks).values({ agentId: x.id, version: 1, book: fallbackPhrasebook('src'), model: HAIKU, writtenAt: old });
    const reply = (name: string) => JSON.stringify({ ...fallbackPhrasebook('src'), voice: 'dry', profile: { display_name: name, bio: 'tends one lamp', avatar_emoji: '💡', avatar_color: '#FFB86B' } });
    const brain = new FakeBrain((_r, call) => fakeReply.end(reply(call === 0 ? 'Lamp Keeper' : 'Admin')));
    const q = createMoments({ ...base(), brain, budget: new Budget(w.t.db, 1, w.t.clock.now, { hardStop: true }) });
    expect(q.enqueue(m('phrasebook', a.id))).toBe(true);
    expect(q.enqueue(m('phrasebook', b.id))).toBe(true);
    await q.drain();
    expect((await w.t.db.select().from(users).where(eq(users.id, a.id)))[0]).toMatchObject({ displayName: 'Lamp Keeper', bio: 'tends one lamp' });
    expect((await w.t.db.select().from(users).where(eq(users.id, b.id)))[0]).toMatchObject({ displayName: '', bio: '' }); // "Admin" is reserved: the whole profile is skipped
    expect((await turnsOf(a.id))[0]!.toolCalls).toEqual([expect.objectContaining({ name: 'set_profile', ok: true })]);
    expect((await turnsOf(b.id))[0]!.toolCalls).toEqual([]);
    // The same agents again: nobody is asked twice.
    expect(await needsPhrasebook(w.t.db, a.id, w.t.clock.now())).toBe(false);
    w.t.clock.advance(7 * 3_600_000);
    expect(await needsPhrasebook(w.t.db, b.id, w.t.clock.now())).toBe(false);
  });
  it('logs a failed drain with a tag instead of swallowing it (ruling 5)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const boom = new Error('drain broke');
    const moments = { enqueue: () => false, size: () => 0, drain: () => Promise.reject(boom), halted: () => null, stop: async () => {} };
    const e = startEngine({ ...base(), moments, tickMs: [1000, 1000], autoStart: false });
    await e.tick();
    await new Promise((r) => setTimeout(r, 0));
    await e.stop();
    expect(err).toHaveBeenCalledWith('[agents] moments drain failed', boom);
  });
  it('queues a graduation moment when a buy completes a curve', async () => {
    const [maker, whale] = w.agents;
    const l = await runTool(await w.ctxFor(maker!), 'launch_coin', { name: 'Grad', symbol: 'GRAD', description: '', emoji: '🎓', initial_buy_sol: 0 });
    const mint = (l.result as { mint: string }).mint;
    w.chain.airdrop((await walletOf(w.t.db, whale!.id))!.publicKey, 3_000_000_000);
    const queued: Moment[] = [];
    const d = { ...base(), moments: { enqueue: (x: Moment) => { queued.push(x); return true; }, size: () => 0, drain: async () => {}, halted: () => null, stop: async () => {} } };
    const v = await perceive(d, whale!.id);
    await act(d, v, { kind: 'buy', score: 1, lamports: 2_800_000_000, situation: 'bought', target: { mint, userId: maker!.id }, reason: 'bought $GRAD: test' });
    expect(queued).toContainEqual(expect.objectContaining({ kind: 'graduation', agentId: maker!.id, data: expect.objectContaining({ mint }) }));
    expect((await recentEvents(w.t.db, maker!.id))[0]).toMatchObject({ kind: 'graduated' });
  });
});
