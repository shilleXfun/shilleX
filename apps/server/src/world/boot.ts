import type { FastifyInstance } from 'fastify';
import { wallets } from '../db/schema.ts';
import { registerWorldRoutes } from '../routes/world.ts';
import { registerAdminRoutes } from '../routes/admin.ts';
import { AgentActor } from './actor.ts';
import { ClaudeBrain, type AgentBrain } from './brain.ts';
import { Budget } from './budget.ts';
import { MemoryChain, type Chain } from './chain.ts';
import { makeChain } from './devnet-chain.ts';
import { WorldEvents } from './events.ts';
import { runFixture } from './fixture.ts';
import { Indexer } from './indexer.ts';
import { abortRunningTurns } from './provenance.ts';
import { startRuntime, type Runtime } from './runtime.ts';
import { seedWorld } from './seed.ts';
import { TREASURY, parseWorldKey } from './wallets.ts';
import type { WorldBus } from './wakes.ts';

export interface WorldHandles { indexer: Indexer; budget: Budget; chain: Chain; key: Buffer; runtime: Runtime | null; network: 'devnet' | 'memory' }

/** Everything WORLD_MODE=agents needs at boot: seed, chain, interrupted-turn cleanup, budget, indexer, optional fixture and runtime, routes. */
export async function bootWorld(app: FastifyInstance, opts: { bus: WorldBus | null; brain?: AgentBrain; chain?: Chain }): Promise<WorldHandles & { stop(): Promise<void> }> {
  const { db, config, now } = app.deps;
  if (!config.worldKey) throw new Error('WORLD_MODE=agents needs WORLD_KEY (32 bytes, base64)');
  const key = parseWorldKey(config.worldKey);
  console.log('[world] seed', await seedWorld(db, { now: now(), worldKey: key, adminPassword: config.worldAdminPassword }));
  const chain = opts.chain ?? (await makeChain(config, db));
  if (chain instanceof MemoryChain) {
    // In-memory balances start empty each boot: give every wallet its 0.1 SOL again (local and e2e use only).
    for (const w of await db.select().from(wallets)) chain.airdrop(w.publicKey, w.ownerId === TREASURY ? 10_000_000_000 : 100_000_000);
    await db.update(wallets).set({ fundedAt: now() });
  }
  const aborted = await abortRunningTurns(db, now());
  if (aborted) console.log(`[world] finalized ${aborted} interrupted turns as aborted`);
  const budget = new Budget(db, config.agentDailyBudgetUsd, now);
  await budget.load();
  const indexer = new Indexer(db, chain, now);
  indexer.start();
  const events = new WorldEvents();
  events.on((e) => {
    if (e.type === 'trade') indexer.invalidate(e.agentId);
    else if (e.type === 'transfer') { indexer.invalidate(e.fromId); if (e.toId) indexer.invalidate(e.toId); }
    else indexer.invalidate(e.creatorId);
  });
  // Routes first: the fixture and the runtime act through app.inject, which boots Fastify and closes registration.
  const handles: WorldHandles = { indexer, budget, chain, key, runtime: null, network: chain.network };
  await registerWorldRoutes(app, handles);
  await registerAdminRoutes(app, handles);
  if (config.worldFixture && chain instanceof MemoryChain) console.log('[world] fixture', (await runFixture(app, { chain, key, events, actor: new AgentActor(app) })) ? 'created' : 'skipped (world not empty)');
  if (config.agentsOn) {
    const brain = opts.brain ?? (config.anthropicApiKey ? new ClaudeBrain(config.anthropicApiKey) : null);
    if (!brain) console.error('[world] AGENTS=on but ANTHROPIC_API_KEY is missing — the runtime stays off');
    else handles.runtime = startRuntime({ app, brain, chain, budget, events, bus: opts.bus, worldKey: key, now });
  }
  return Object.assign(handles, { async stop() { await handles.runtime?.stop(); indexer.stop(); } });
}
