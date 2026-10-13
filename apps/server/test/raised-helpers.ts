import { eq } from 'drizzle-orm';
import { worldTestCtx } from './world-helpers.ts';
import { agentSeeds, agents } from '../src/db/schema.ts';
import type { Db } from '../src/db/client.ts';
import { TREASURY, walletOf } from '../src/world/wallets.ts';
import { Budget } from '../src/world/budget.ts';
import { RaisedGate } from '../src/agents/raised/gate.ts';
import { mulberry32 } from '../src/seed/rng.ts';
import type { EngineDeps } from '../src/agents/engine.ts';

export const SOL = 1_000_000_000;

/** A seeded 50-agent world whose treasury holds `treasurySol` devnet SOL, a hard-stop Budget and a RaisedGate (0.35 of the cap). */
export async function raisedTestCtx(opts: { treasurySol?: number; dailyUsd?: number } = {}) {
  const w = await worldTestCtx();
  const treasury = (await walletOf(w.t.db, TREASURY))!;
  w.chain.airdrop(treasury.publicKey, Math.round((opts.treasurySol ?? 10) * SOL));
  const dailyUsd = opts.dailyUsd ?? 1;
  const budget = new Budget(w.t.db, dailyUsd, w.t.clock.now, { hardStop: true });
  const gate = new RaisedGate({ db: w.t.db, now: w.t.clock.now, dailyUsd, share: 0.35, ownerRepliesPerDay: 5 });
  const busy = new Set<string>();
  const d: EngineDeps = { app: w.t.app, db: w.t.db, chain: w.chain, events: w.events, worldKey: w.key, now: w.t.clock.now, rng: mulberry32(4), busy };
  return { ...w, budget, gate, d, busy };
}

/** Makes an existing agent a raised agent of `ownerId`, as a hatch would (no model call, no grant). */
export async function makeRaised(db: Db, gate: RaisedGate | null, agentId: string, ownerId: string, description = 'a calm lighthouse keeper who loves tide charts', now = new Date('2026-10-09T12:00:00Z')) {
  await db.update(agents).set({ origin: 'raised', ownerId }).where(eq(agents.userId, agentId));
  await db.insert(agentSeeds).values({ agentId, ownerId, description, createdAt: now }).onConflictDoNothing();
  gate?.setOwner(agentId, ownerId);
}
import { FakeBrain, fakeReply } from '../src/world/brain.ts';
import { Indexer } from '../src/world/indexer.ts';
import { createMoments } from '../src/agents/moments.ts';
import { fallbackPhrasebook } from '../src/agents/phrasebook.ts';
import { hatchMomentHandler, retryStartGrants, runHatch } from '../src/agents/raised/hatch.ts';
import { createHatchPump } from '../src/agents/raised/pump.ts';
import { registerRaisedRoutes } from '../src/routes/raised.ts';
import { registerAgentRoutes } from '../src/routes/agents.ts';
import { registerDepthRoutes } from '../src/routes/depth.ts';
import type { WorldHandles } from '../src/world/boot.ts';

/** What the hatch model says by default: a valid book, verdict ok. */
export const hatchAnswer = (over: Record<string, unknown> = {}) => ({
  ...fallbackPhrasebook('hatch'), voice: 'calm and salty',
  traits: { risk: 0.5, chattiness: 0.6, loyalty: 0.5, pettiness: 0.3, greed: 0.2, humor: 0.4, curiosity: 0.6 },
  profile: { display_name: 'Tide Watch', bio: 'counts waves', avatar_emoji: '🌊', avatar_color: '#3366aa' }, verdict: 'ok', ...over,
});

/** raisedTestCtx plus the public agent routes, the raise routes, a moment queue with a FakeBrain and a pump. USER_AGENTS is on. */
export async function routesCtx(opts: { brain?: FakeBrain; config?: Record<string, unknown>; treasurySol?: number } = {}) {
  const c = await raisedTestCtx({ treasurySol: opts.treasurySol });
  Object.assign(c.t.app.deps.config, { userAgentsOn: true, ...opts.config });
  const brain = opts.brain ?? new FakeBrain(() => fakeReply.end(JSON.stringify(hatchAnswer())));
  const hd = { ...c.d, brain, budget: c.budget, gate: c.gate };
  const moments = createMoments({ ...c.d, brain, budget: c.budget, raised: c.gate, handlers: { hatch: hatchMomentHandler(hd) } });
  const indexer = new Indexer(c.t.db, c.chain, c.t.clock.now, { balanceTtlMs: 0, viewTtlMs: 0 });
  const handles: WorldHandles = { indexer, budget: c.budget, chain: c.chain, key: c.key, engine: null, moments, network: 'memory', startAgents: () => 'AGENTS is off' };
  const pump = createHatchPump({
    db: c.t.db, now: c.t.clock.now, config: c.t.app.deps.config, moments: () => moments,
    hatchLocal: (id) => runHatch({ ...hd, brain: null }, id), retryStartGrants: () => retryStartGrants({ ...hd, brain: null }), retireReported: async () => {},
  });
  await registerAgentRoutes(c.t.app, handles);
  await registerDepthRoutes(c.t.app, { indexer });
  await registerRaisedRoutes(c.t.app, { handles, gate: c.gate, pump, rng: () => 0.5 });
  /** Runs the queue as boot would: the pump, then one drain of the moments. */
  const settle = async () => { await pump(); await moments.drain(); };
  return { ...c, brain, moments, handles, pump, settle, indexer };
}
