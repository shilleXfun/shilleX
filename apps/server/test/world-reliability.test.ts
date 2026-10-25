import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { worldTestCtx } from './world-helpers.ts';
import { testDb } from './helpers.ts';
import { wallets, worldJobs } from '../src/db/schema.ts';
import { ChainError, MemoryChain } from '../src/world/chain.ts';
import { mulberry32 } from '../src/seed/rng.ts';
import { startEngine, type Engine, type EngineDeps } from '../src/agents/engine.ts';
import type { Moments } from '../src/agents/types.ts';
import { planSites, type SiteJob } from '../src/sites/plan.ts';
import { HALT_BACKOFF_MS, createModelHalt } from '../src/agents/halt.ts';
import { PermanentJobError, redact, runJob } from '../src/world/jobs.ts';
import { Budget } from '../src/world/budget.ts';
import { BudgetClosed, billedCall } from '../src/agents/haiku.ts';
import type { BrainResponse } from '../src/world/brain.ts';

/** A model queue that refuses everything, as it did with a revoked key: halted, enqueue false. */
const haltedQueue = (drains: { n: number }): Moments => ({
  enqueue: () => false, size: () => 0, drain: async () => { drains.n++; }, halted: () => 'Anthropic rejected ANTHROPIC_API_KEY (401)', stop: async () => {},
});

describe('world engine reliability (docs/system-audit.md §3)', () => {
  let w: Awaited<ReturnType<typeof worldTestCtx>>;
  let e: Engine | null = null;
  beforeEach(async () => { w = await worldTestCtx(); });
  afterEach(async () => { await e?.stop(); e = null; await w.t.close(); });
  const deps = (over: Partial<EngineDeps> = {}): EngineDeps => ({ app: w.t.app, db: w.t.db, chain: w.chain, events: w.events, worldKey: w.key, now: w.t.clock.now, rng: mulberry32(5), ...over });

  it('starts a website build while the model queue is halted (the latent stall)', async () => {
    const asked: [string, SiteJob][] = [];
    const agent = w.agents[0]!;
    await planSites(deps({ moments: haltedQueue({ n: 0 }), buildSite: (id, job) => { asked.push([id, job]); return true; } }), agent.id);
    expect(asked).toEqual([[agent.id, { site: 'personal' }]]);
  });

  it('drains queued model moments even when every tick fails (the RPC outage of 2026-10-17)', async () => {
    // Every turn dies in perceive, as it did on the exhausted RPC.
    const down = new MemoryChain();
    Object.defineProperty(down, 'limits', { get() { throw new ChainError('RPC_DOWN', '429 max usage reached'); } });
    await w.t.db.update(wallets).set({ fundedAt: w.t.clock.now() });
    const drains = { n: 0 };
    e = startEngine({ ...deps({ chain: down, moments: haltedQueue(drains) }), tickMs: [1000, 1000], autoStart: false });
    for (let i = 0; i < 5; i++) { await e.tick(); w.t.clock.advance(60_000); }
    expect(e.stats().failing).toBe(5);
    expect(drains.n).toBe(5);
  });
});

describe('job leases', () => {
  it('runs a job once across two processes, takes over an expired lease, and backs off after a failure', async () => {
    const h = await testDb();
    let t = new Date('2026-10-25T12:00:00Z');
    const now = () => t;
    try {
      let release!: () => void;
      const held = new Promise<void>((r) => { release = r; });
      const first = runJob(h.db, 'site-build', { now, leaseMs: 60_000, owner: 'a' }, async () => { await held; return { note: 'built' }; });
      await new Promise((r) => setTimeout(r, 20));
      expect(await runJob(h.db, 'site-build', { now, leaseMs: 60_000, owner: 'b' }, async () => { throw new Error('must not run'); })).toEqual({ ran: false, reason: 'leased' });
      release();
      expect(await first).toEqual({ ran: true, status: 'ok' });

      // A process that died mid-run: its lease expires and the next one takes the job over.
      await h.db.update(worldJobs).set({ leaseOwner: 'dead', leaseUntil: new Date(t.getTime() + 60_000), lastStatus: 'running' }).where(eq(worldJobs.name, 'site-build'));
      expect((await runJob(h.db, 'site-build', { now, leaseMs: 60_000, owner: 'b' }, async () => {})).ran).toBe(false);
      t = new Date(t.getTime() + 61_000);
      expect(await runJob(h.db, 'site-build', { now, leaseMs: 60_000, owner: 'b' }, async () => {})).toEqual({ ran: true, status: 'ok' });

      // A transient failure backs off; a permanent one is recorded without a retry time.
      const fail = await runJob(h.db, 'site-build', { now, leaseMs: 60_000, owner: 'b', rng: () => 0.5 }, async () => { throw Object.assign(new Error('socket hang up'), {}); });
      expect(fail.ran && fail.status).toBe('failed');
      expect(await runJob(h.db, 'site-build', { now, leaseMs: 60_000, owner: 'b' }, async () => {})).toEqual({ ran: false, reason: 'backoff' });
      let [row] = await h.db.select().from(worldJobs).where(eq(worldJobs.name, 'site-build'));
      expect(row).toMatchObject({ failures: 1, errorCategory: 'transient', lastStatus: 'failed', leaseOwner: null });
      t = new Date(row!.retryAt!.getTime() + 1);
      await runJob(h.db, 'site-build', { now, leaseMs: 60_000, owner: 'b' }, async () => { throw new PermanentJobError('the page was over 200 KB'); });
      [row] = await h.db.select().from(worldJobs).where(eq(worldJobs.name, 'site-build'));
      expect(row).toMatchObject({ failures: 2, errorCategory: 'permanent', retryAt: null });
    } finally { await h.close(); }
  });

  it('never stores a key from an error message', () => {
    expect(redact('401 bad key gsk_abcdefghijklmnop1234 and sk-or-v1-0123456789abcdef and Bearer xyz')).not.toMatch(/gsk_|sk-or|xyz/);
  });
});

describe('model pause', () => {
  it('pauses 15 min, then an hour, then six, and forgets after a call works', () => {
    let t = 0;
    const halt = createModelHalt(() => new Date(t), () => {});
    halt.trip('401');
    expect(halt.reason()).toBe('401');
    t += HALT_BACKOFF_MS[0] - 1;
    expect(halt.reason()).toBe('401');
    t += 1;
    expect(halt.reason()).toBeNull();
    halt.trip('401 again');
    expect(halt.state().until).toBe(new Date(t + HALT_BACKOFF_MS[1]).toISOString());
    halt.ok();
    halt.trip('401 later');
    expect(halt.state().until).toBe(new Date(t + HALT_BACKOFF_MS[0]).toISOString());
  });
});

describe('budget reservation', () => {
  it('lets concurrent calls spend no more than the cap', async () => {
    const h = await testDb();
    try {
      const now = () => new Date('2026-10-25T23:59:00Z');
      const budget = new Budget(h.db, 0.05, now, { hardStop: true });
      const reply: BrainResponse = { content: [], stopReason: 'end_turn', model: 'claude-haiku-5-5', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
      let sent = 0;
      const calls = Array.from({ length: 6 }, () => billedCall({ db: h.db, budget, worldCallId: 'none', worstUsd: 0.02, spent: { usd: 0 } }, async () => {
        sent++;
        await new Promise((r) => setTimeout(r, 30));
        return { ...reply, usage: { ...reply.usage, output: 40_000 } };
      }));
      const results = await Promise.allSettled(calls);
      expect(sent).toBe(2);
      expect(results.filter((r) => r.status === 'rejected' && r.reason instanceof BudgetClosed)).toHaveLength(4);
      expect(budget.spentToday()).toBeLessThanOrEqual(0.05);
    } finally { await h.close(); }
  });
});
