import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { worldTestCtx } from './world-helpers.ts';
import { Indexer } from '../src/world/indexer.ts';
import { Budget } from '../src/world/budget.ts';
import { registerAgentRoutes } from '../src/routes/agents.ts';
import { finishTurn, startTurn } from '../src/world/provenance.ts';
import { agentTurns } from '../src/db/schema.ts';

type W = Awaited<ReturnType<typeof worldTestCtx>>;
async function world(): Promise<W> {
  const w = await worldTestCtx();
  await registerAgentRoutes(w.t.app, { indexer: new Indexer(w.t.db, w.chain, w.t.clock.now), budget: new Budget(w.t.db, 1, w.t.clock.now), chain: w.chain, key: w.key, engine: null, moments: null, network: 'memory', startAgents: () => 'AGENTS is off' });
  return w;
}
/** `n` sealed turns for the agent, as the engine leaves them. */
async function turns(w: W, agentId: string, n: number) {
  for (let i = 0; i < n; i++) {
    const t = await startTurn(w.t.db, { agentId, triggers: [{ type: 'heartbeat' }], model: 'engine', effort: 'none', promptVersion: 'engine-v1', snapshotId: null, now: w.t.clock.now() });
    await finishTurn(w.t.db, t.id, { status: 'acted', context: [], reasoning: `turn ${i + 1}`, toolCalls: [], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: 0, finishedAt: w.t.clock.now() });
  }
}
const verify = (w: W, username: string) => w.t.app.inject({ method: 'GET', url: `/api/agents/${username}/chain/verify` });

describe('GET /api/agents/:username/chain/verify', () => {
  let w: W;
  beforeAll(async () => { w = await world(); });
  afterAll(() => w.t.close());

  it('answers from a 60 s cache per agent, then walks the chain again and still catches a tampered turn', async () => {
    const [a, b] = w.agents;
    await turns(w, a!.id, 3);
    await turns(w, b!.id, 1);
    const first = await verify(w, a!.username);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ ok: true, count: 3, head: expect.stringMatching(/^[0-9a-f]{64}$/), brokenAtSeq: null });
    // Someone rewrites turn 2. Within 60 s the cached result stands: the request did not walk the chain again.
    await w.t.db.update(agentTurns).set({ reasoning: 'rewritten history' }).where(and(eq(agentTurns.agentId, a!.id), eq(agentTurns.seq, 2)));
    w.t.clock.advance(59_000);
    expect((await verify(w, a!.username)).json()).toEqual(first.json());
    // The cache is per agent: another agent's chain is walked on its own.
    expect((await verify(w, b!.username)).json()).toMatchObject({ ok: true, count: 1 });
    w.t.clock.advance(1_000);
    expect((await verify(w, a!.username)).json()).toMatchObject({ ok: false, count: 3, brokenAtSeq: 2 });
  });
});

describe('chain/verify rate limit', () => {
  let w: W;
  beforeAll(async () => { w = await world(); });
  afterAll(() => w.t.close());

  it('answers 429 to an address that asks more than 20 times a minute', async () => {
    const name = w.agents[0]!.username;
    for (let i = 0; i < 20; i++) expect((await verify(w, name)).statusCode).toBe(200);
    const limited = await verify(w, name);
    expect(limited.statusCode).toBe(429);
  });
});
