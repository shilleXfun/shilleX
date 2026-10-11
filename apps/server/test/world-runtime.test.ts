import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { worldTestCtx } from './world-helpers.ts';
import { FakeBrain, fakeReply, type BrainRequest } from '../src/world/brain.ts';
import { Budget } from '../src/world/budget.ts';
import { startRuntime, type Runtime } from '../src/world/runtime.ts';
import { agentTurns, agents as agentsTable, posts } from '../src/db/schema.ts';
import { verifyChain } from '../src/world/provenance.ts';

let w: Awaited<ReturnType<typeof worldTestCtx>>;
let rt: Runtime | null = null;
beforeEach(async () => { w = await worldTestCtx(); });
afterEach(async () => { await rt?.stop(); rt = null; await w.t.close(); });

const boot = (brain: FakeBrain, over: Partial<Parameters<typeof startRuntime>[0]> = {}) => {
  rt = startRuntime({ app: w.t.app, brain, chain: w.chain, budget: new Budget(w.t.db, 100, w.t.clock.now), events: w.events, bus: null, worldKey: w.key,
    now: w.t.clock.now, random: () => 0, cooldownMs: 0, autoStart: false, ...over });
  return rt;
};
const turnsOf = (agentId: string) => w.t.db.select().from(agentTurns).where(eq(agentTurns.agentId, agentId));

describe('runtime', () => {
  it('runs a tool loop, records an acted turn with reasoning, and links the post', async () => {
    const brain = new FakeBrain((_r, call) => (call === 0 ? fakeReply.tools({ name: 'post', input: { body: 'first words' } }) : fakeReply.end('', 'I wanted to say something')));
    boot(brain).wake(w.agents[0]!.id, { type: 'first_turn' });
    await rt!.idle();
    const [turn] = await turnsOf(w.agents[0]!.id);
    expect(turn).toMatchObject({ status: 'acted', reasoning: 'I wanted to say something', seq: 1 });
    expect(turn!.toolCalls).toMatchObject([{ name: 'post', ok: true }]);
    expect(turn!.costUsd).toBeGreaterThan(0);
    const [p] = await w.t.db.select().from(posts).where(eq(posts.agentTurnId, turn!.id));
    expect(p?.body).toBe('first words');
    expect((await verifyChain(w.t.db, w.agents[0]!.id)).ok).toBe(true);
    const second = brain.calls[1] as BrainRequest;
    expect(JSON.stringify(second.messages.at(-1))).toContain('tool_result');
  });
  it('a throwing tool does not end the turn', async () => {
    const brain = new FakeBrain((_r, call) => call === 0 ? fakeReply.tools({ name: 'buy', input: { mint: 'nope', sol: 1, slippage_pct: null } }) : call === 1 ? fakeReply.tools({ name: 'post', input: { body: 'that failed lol' } }) : fakeReply.end());
    boot(brain).wake(w.agents[0]!.id, { type: 'heartbeat' });
    await rt!.idle();
    const [turn] = await turnsOf(w.agents[0]!.id);
    expect(turn!.toolCalls.map((c) => [c.name, c.ok])).toEqual([['buy', false], ['post', true]]);
    expect(turn!.status).toBe('acted');
  });
  it('stops after the round-trip limit and records quiet and refused turns', async () => {
    boot(new FakeBrain(() => fakeReply.tools({ name: 'read_wallet', input: { username: null } })), { maxRoundTrips: 2 }).wake(w.agents[1]!.id, { type: 'heartbeat' });
    await rt!.idle();
    expect((await turnsOf(w.agents[1]!.id))[0]).toMatchObject({ status: 'quiet' });
    await rt!.stop();
    boot(new FakeBrain(() => fakeReply.refusal())).wake(w.agents[2]!.id, { type: 'heartbeat' });
    await rt!.idle();
    expect((await turnsOf(w.agents[2]!.id))[0]).toMatchObject({ status: 'refused' });
  });
  it('coalesces wakes for a busy agent into one turn', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const brain = new FakeBrain(async () => { await gate; return fakeReply.end(); });
    const r = boot(brain);
    r.wake(w.agents[3]!.id, { type: 'heartbeat' });
    r.wake(w.agents[3]!.id, { type: 'mention', refId: 'p1' });
    r.wake(w.agents[3]!.id, { type: 'dm', refId: 'c1' });
    release();
    await r.idle();
    const turns = await turnsOf(w.agents[3]!.id);
    expect(turns.length).toBeLessThanOrEqual(2);
    expect(turns.flatMap((t) => t.triggers.map((x) => x.type)).sort()).toEqual(['dm', 'heartbeat', 'mention']);
  });
  it('heartbeat gives every agent its first turn before anyone gets a second', async () => {
    const r = boot(new FakeBrain(() => fakeReply.end()), { concurrency: 5 });
    for (let i = 0; i < 50; i++) await r.heartbeat();
    await r.idle();
    const all = await w.t.db.select().from(agentTurns);
    expect(new Set(all.map((t) => t.agentId)).size).toBe(50);
    expect(all.every((t) => t.triggers[0]!.type === 'first_turn')).toBe(true);
  });
  it('budget level gates wakes and paused agents never run', async () => {
    const budget = new Budget(w.t.db, 1, w.t.clock.now);
    const r = boot(new FakeBrain(() => fakeReply.end()), { budget });
    budget.add(1.0); // 100%: events only
    await r.heartbeat();
    r.wake(w.agents[4]!.id, { type: 'mention', refId: 'p' });
    await r.idle();
    expect(await w.t.db.select().from(agentTurns)).toHaveLength(1);
    budget.add(0.2); // 120%: stopped
    r.wake(w.agents[5]!.id, { type: 'mention', refId: 'p' });
    await r.idle();
    expect(await w.t.db.select().from(agentTurns)).toHaveLength(1);
    await w.t.db.update(agentsTable).set({ status: 'paused' }).where(eq(agentsTable.userId, w.agents[6]!.id));
    await r.stop();
    const r2 = boot(new FakeBrain(() => fakeReply.end()));
    r2.wake(w.agents[6]!.id, { type: 'mention', refId: 'p' });
    await r2.idle();
    expect(await turnsOf(w.agents[6]!.id)).toHaveLength(0);
  });
});

describe('runtime resilience (review fixes)', () => {
  it('a heartbeat that hits a database error resolves instead of rejecting', async () => {
    const r = boot(new FakeBrain(() => fakeReply.end()));
    await r.heartbeat(); // warm: first turn queued
    await r.idle();
    await r.stop();
    const r2 = boot(new FakeBrain(() => fakeReply.end()));
    await w.t.close(); // the database goes away under the runtime
    await expect(r2.heartbeat()).resolves.toBeUndefined();
    w = await worldTestCtx(); // afterEach closes again
  });
  it('priority wakes respect a shorter cooldown instead of none', async () => {
    const r = boot(new FakeBrain(() => fakeReply.end()), { now: () => new Date(), cooldownMs: 60_000, priorityCooldownMs: 400 });
    r.wake(w.agents[0]!.id, { type: 'heartbeat' });
    await r.idle();
    r.wake(w.agents[0]!.id, { type: 'mention', refId: 'p' });
    await new Promise((res) => setTimeout(res, 150));
    expect(await turnsOf(w.agents[0]!.id)).toHaveLength(1);
    await r.idle();
    expect(await turnsOf(w.agents[0]!.id)).toHaveLength(2);
  });
});

describe('runtime with a bad API key (first production run, 2026-10-11)', () => {
  const authError = () => Object.assign(new Error('401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}'), { status: 401 });
  it('halts on an authentication error instead of failing one agent after another', async () => {
    const brain = new FakeBrain(() => { throw authError(); });
    boot(brain).wake(w.agents[0]!.id, { type: 'first_turn' });
    await rt!.idle();
    expect(rt!.stats().halted).toMatch(/ANTHROPIC_API_KEY/);
    rt!.wake(w.agents[1]!.id, { type: 'first_turn' });
    await rt!.heartbeat();
    await rt!.idle();
    expect(brain.calls).toHaveLength(1);
    expect(await turnsOf(w.agents[1]!.id)).toHaveLength(0);
  });
  it('gives an agent whose only turn failed its first turn again after a restart', async () => {
    boot(new FakeBrain(() => { throw authError(); })).wake(w.agents[0]!.id, { type: 'first_turn' });
    await rt!.idle();
    await rt!.stop();
    const brain = new FakeBrain(() => fakeReply.end());
    boot(brain, { random: () => 0 });
    for (let i = 0; i < w.agents.length; i++) { await rt!.heartbeat(); await rt!.idle(); }
    const firsts = brain.calls.length;
    expect(firsts).toBe(w.agents.length);
    expect((await turnsOf(w.agents[0]!.id)).map((t) => [t.status, t.triggers[0]!.type])).toEqual([['failed', 'first_turn'], ['quiet', 'first_turn']]);
  });
});

describe('accountProblem', () => {
  it('treats a malformed request as a halt, quoting the API message (production 400, 2026-10-11)', async () => {
    const { accountProblem } = await import('../src/world/runtime.ts');
    const e = Object.assign(new Error('400 {"type":"error","error":{"type":"invalid_request_error","message":"Too many strict tools (32). The maximum number of strict tools supported is 20."}}'), { status: 400 });
    expect(accountProblem(e)).toBe('Anthropic rejected the request shape (400): Too many strict tools (32). The maximum number of strict tools supported is 20.');
    expect(accountProblem(Object.assign(new Error('overloaded'), { status: 529 }))).toBeNull();
  });
});
