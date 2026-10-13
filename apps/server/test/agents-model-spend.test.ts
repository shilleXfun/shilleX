import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { worldTestCtx } from './world-helpers.ts';
import { agentTurns, posts } from '../src/db/schema.ts';
import { FakeBrain, fakeReply, priceOf, type BrainResponse } from '../src/world/brain.ts';
import { Budget } from '../src/world/budget.ts';
import { abortRunningTurns } from '../src/world/provenance.ts';
import { mulberry32 } from '../src/seed/rng.ts';
import { HAIKU, haikuBrain } from '../src/agents/haiku.ts';
import { MOMENT_MAX_TOKENS, createMoments, type Moment } from '../src/agents/moments.ts';
import { PHRASEBOOK_MAX_TOKENS, writePhrasebook } from '../src/agents/phrasebook-writer.ts';
import { fallbackPhrasebook } from '../src/agents/phrasebook.ts';
import { oneShotTool } from '../src/agents/depth/system.ts';
import type { EngineDeps } from '../src/agents/engine.ts';

// The $1/day cap must hold across errors and crashes (engine M1, server-rest M5): every model call's cost is on the books
// before anything else happens, a call that throws counts its worst case, and a restart reads both back.

let w: Awaited<ReturnType<typeof worldTestCtx>>;
beforeEach(async () => { w = await worldTestCtx(); });
afterEach(() => { vi.restoreAllMocks(); return w.t.close(); });
const base = (): EngineDeps => ({ app: w.t.app, db: w.t.db, chain: w.chain, events: w.events, worldKey: w.key, now: w.t.clock.now, rng: mulberry32(3) });
const budget = () => new Budget(w.t.db, 1, w.t.clock.now, { hardStop: true });
const worst = (maxTokens: number) => priceOf(HAIKU, { input: 0, output: maxTokens, cacheRead: 0, cacheWrite: 0 });
const MOMENT_WORST = worst(MOMENT_MAX_TOKENS), BOOK_WORST = worst(PHRASEBOOK_MAX_TOKENS);
const priced = (r: BrainResponse) => priceOf(HAIKU, r.usage);
const launch = (agentId: string): Moment => ({ kind: 'launch', agentId, data: { mint: 'M1', symbol: 'MOTH', name: 'Moth Coin' }, at: w.t.clock.now() });
/** What the next boot would count: running turns aborted (as boot does first), then a fresh budget loaded from the receipts. */
const afterRestart = async () => {
  await abortRunningTurns(w.t.db, w.t.clock.now());
  const b = budget();
  await b.load();
  return b.spentToday();
};
const until = async (ok: () => boolean | Promise<boolean>) => { for (let i = 0; i < 200 && !(await ok()); i++) await new Promise((r) => setTimeout(r, 10)); };
const never = () => new Promise<BrainResponse>(() => {});
const quietErrors = () => vi.spyOn(console, 'error').mockImplementation(() => {});

describe('moment calls', () => {
  it('a call that throws counts its worst case, on the receipt and in the budget', async () => {
    quietErrors();
    const a = w.agents[0]!;
    const b = budget();
    const q = createMoments({ ...base(), brain: new FakeBrain(() => { throw new Error('socket hang up'); }), budget: b });
    expect(q.enqueue(launch(a.id))).toBe(true);
    await q.drain();
    const [t] = await w.t.db.select().from(agentTurns).where(eq(agentTurns.agentId, a.id));
    expect(t).toMatchObject({ status: 'failed', model: HAIKU });
    expect(t!.costUsd).toBeCloseTo(MOMENT_WORST, 12);
    expect(b.spentToday()).toBeCloseTo(MOMENT_WORST, 12);
    expect(await afterRestart()).toBeCloseTo(MOMENT_WORST, 12);
  });
  it('a crash after a call keeps its cost: the paid trip, and the trip still in flight at its worst case', async () => {
    const a = w.agents[1]!;
    const first = fakeReply.tools({ name: 'post', input: { body: 'introducing $MOTH. lamps only.' } });
    const brain = new FakeBrain((_r, call) => (call === 0 ? first : never()));
    const q = createMoments({ ...base(), brain, budget: budget() });
    q.enqueue(launch(a.id));
    void q.drain(); // never finishes: the process "dies" during the second call
    await until(() => brain.calls.length === 2);
    expect(await w.t.db.select().from(posts).where(eq(posts.authorId, a.id))).toHaveLength(1); // the paid trip's tool ran
    const [running] = await w.t.db.select().from(agentTurns).where(and(eq(agentTurns.agentId, a.id), eq(agentTurns.status, 'running')));
    expect(running!.costUsd).toBeCloseTo(priced(first) + MOMENT_WORST, 12);
    expect(await afterRestart()).toBeCloseTo(priced(first) + MOMENT_WORST, 12);
    const [aborted] = await w.t.db.select().from(agentTurns).where(eq(agentTurns.id, running!.id));
    expect(aborted).toMatchObject({ status: 'aborted' });
    expect(aborted!.costUsd).toBeCloseTo(priced(first) + MOMENT_WORST, 12);
  });
  it('a finished call settles to what it cost', async () => {
    const a = w.agents[2]!;
    const reply = fakeReply.tools({ name: 'post', input: { body: 'introducing $MOTH. lamps only.' } });
    const end = fakeReply.end();
    const b = budget();
    const q = createMoments({ ...base(), brain: new FakeBrain((_r, call) => (call === 0 ? reply : end)), budget: b });
    q.enqueue(launch(a.id));
    await q.drain();
    const [t] = await w.t.db.select().from(agentTurns).where(eq(agentTurns.agentId, a.id));
    expect(t!.costUsd).toBeCloseTo(priced(reply) + priced(end), 12);
    expect(b.spentToday()).toBeCloseTo(t!.costUsd, 12);
    expect(await afterRestart()).toBeCloseTo(t!.costUsd, 12);
  });
});

describe('phrasebook calls', () => {
  const book = () => JSON.stringify({ ...fallbackPhrasebook('src'), voice: 'dry', profile: { display_name: 'Lamp Keeper', bio: 'tends one lamp', avatar_emoji: '💡', avatar_color: '#FFB86B' } });
  it('a crash between the call and its receipt keeps the cost after a restart', async () => {
    const a = w.agents[3]!;
    const reply = fakeReply.end(book());
    // The profile is applied after the call, inside the same turn: it never returns, as if the process died there.
    void writePhrasebook({ db: w.t.db, brain: new FakeBrain(() => reply), budget: budget(), now: w.t.clock.now, tool: () => new Promise(() => {}) }, a.id);
    await until(async () => Math.abs(((await w.t.db.select().from(agentTurns).where(eq(agentTurns.agentId, a.id)))[0]?.costUsd ?? 0) - priced(reply)) < 1e-12);
    expect(await afterRestart()).toBeCloseTo(priced(reply), 12);
  });
  it('a call that throws counts its worst case', async () => {
    const a = w.agents[4]!;
    const b = budget();
    await expect(writePhrasebook({ db: w.t.db, brain: new FakeBrain(() => { throw new Error('socket hang up'); }), budget: b, now: w.t.clock.now }, a.id)).rejects.toThrow('socket hang up');
    const [t] = await w.t.db.select().from(agentTurns).where(eq(agentTurns.agentId, a.id));
    expect(t).toMatchObject({ status: 'failed' });
    expect(t!.costUsd).toBeCloseTo(BOOK_WORST, 12);
    expect(b.spentToday()).toBeCloseTo(BOOK_WORST, 12);
    expect(await afterRestart()).toBeCloseTo(BOOK_WORST, 12);
  });
});

describe('one-shot depth calls (faction names, the paper)', () => {
  const req = { system: [], tools: [], messages: [{ role: 'user' as const, content: 'name it' }] };
  it('a call that throws counts its worst case on a sealed receipt', async () => {
    const a = w.agents[5]!;
    const b = budget();
    await expect(oneShotTool({ ...base(), brain: new FakeBrain(() => { throw new Error('socket hang up'); }), budget: b }, a.id, 'naming a faction', req, 'name')).rejects.toThrow('socket hang up');
    const [t] = await w.t.db.select().from(agentTurns).where(eq(agentTurns.agentId, a.id));
    expect(t).toMatchObject({ status: 'failed', model: HAIKU });
    expect(t!.hash).toBeTruthy();
    expect(t!.costUsd).toBeCloseTo(MOMENT_WORST, 12);
    expect(b.spentToday()).toBeCloseTo(MOMENT_WORST, 12);
    expect(await afterRestart()).toBeCloseTo(MOMENT_WORST, 12);
  });
  it('a crash during the call keeps its worst case after a restart; a finished call settles to its cost', async () => {
    const [a, c] = [w.agents[6]!, w.agents[7]!];
    const brain = new FakeBrain(() => never());
    void oneShotTool({ ...base(), brain, budget: budget() }, a.id, 'naming a faction', req, 'name');
    await until(() => brain.calls.length === 1);
    expect(await afterRestart()).toBeCloseTo(MOMENT_WORST, 12);
    const answer = fakeReply.tools({ name: 'name', input: { name: 'The Lodge' } });
    const b = budget();
    expect(await oneShotTool({ ...base(), brain: new FakeBrain(() => answer), budget: b }, c.id, 'naming a faction', req, 'name')).toEqual({ name: 'The Lodge' });
    const [t] = await w.t.db.select().from(agentTurns).where(eq(agentTurns.agentId, c.id));
    expect(t).toMatchObject({ status: 'quiet' });
    expect(t!.costUsd).toBeCloseTo(priced(answer), 12);
    expect(b.spentToday()).toBeCloseTo(priced(answer), 12);
  });
});

describe('the Haiku client', () => {
  it('never retries on its own: a retried attempt could be billed without the ledger seeing it', () => {
    const client = (haikuBrain('k') as unknown as { client: { maxRetries: number } }).client;
    expect(client.maxRetries).toBe(0);
  });
});
