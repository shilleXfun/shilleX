import type { FastifyInstance } from 'fastify';
import { and, isNull, ne } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { wallets } from '../db/schema.ts';
import { registerAgentRoutes } from '../routes/agents.ts';
import { registerAdminRoutes } from '../routes/admin.ts';
import { type AgentBrain } from './brain.ts';
import { Budget } from './budget.ts';
import { MemoryChain, type Chain } from './chain.ts';
import { DevnetChain, makeChain } from './devnet-chain.ts';
import { createLaunchpad, DBC_CONFIG, setSetting } from './launchpad.ts';
import { TreasuryEmpty, fundAgents } from './ledger.ts';
import { WorldEvents } from './events.ts';
import { Indexer } from './indexer.ts';
import { abortRunningTurns } from './provenance.ts';
import type { Runtime } from './runtime.ts';
import { startEngine, type Engine } from '../agents/engine.ts';
import { mulberry32 } from '../seed/rng.ts';
import { seedWorld } from './seed.ts';
import { TREASURY, parseWorldKey, signerFor, walletOf } from './wallets.ts';
import type { WorldBus } from './wakes.ts';

export interface WorldHandles {
  indexer: Indexer; budget: Budget; chain: Chain; key: Buffer; runtime: Runtime | null; engine: Engine | null; network: 'devnet' | 'memory';
  /** Starts the agents if AGENTS=on and the world is ready; says why not otherwise. */
  startAgents(): string;
}

/** Why the agents can't start yet, or null when they can: they need the launchpad and their 0.1 SOL first. */
export async function worldNotReady(db: Db, chain: Chain): Promise<string | null> {
  if (chain instanceof DevnetChain && !chain.hasLaunchpad) return 'the launchpad is not set up';
  const [unfunded] = await db.select({ id: wallets.ownerId }).from(wallets).where(and(ne(wallets.ownerId, TREASURY), isNull(wallets.fundedAt))).limit(1);
  return unfunded ? 'agent wallets are not funded' : null;
}

/** One-time setup from the treasury: the launchpad config if it is missing, then 0.1 SOL to every unfunded agent. */
export async function setUpWorld(db: Db, chain: Chain, key: Buffer, now: () => Date) {
  let launchpad: string | null = null;
  if (chain instanceof DevnetChain && !chain.hasLaunchpad) {
    try { launchpad = await createLaunchpad(chain.conn, await signerFor(db, TREASURY, key)); }
    catch (e) {
      if (/insufficient|no record of a prior credit/i.test((e as Error).message ?? '')) throw new TreasuryEmpty('The treasury has no devnet SOL to create the launchpad; send it ~6 devnet SOL and run this again');
      throw e;
    }
    await setSetting(db, DBC_CONFIG, launchpad);
    chain.setLaunchpad(launchpad);
  }
  return { launchpad, ...(await fundAgents(db, chain, key, now)) };
}

/** Everything the agent world needs at boot when WORLD_KEY is set: seed, chain, interrupted-turn cleanup, budget, indexer, runtime, routes. */
export async function bootAgents(app: FastifyInstance, opts: { bus: WorldBus | null; brain?: AgentBrain; chain?: Chain }): Promise<WorldHandles & { stop(): Promise<void> }> {
  const { db, config, now } = app.deps;
  if (!config.worldKey) throw new Error('The agent world needs WORLD_KEY (32 bytes, base64)');
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
  // Routes first: the runtime acts through app.inject, which boots Fastify and closes registration.
  const handles: WorldHandles = {
    indexer, budget, chain, key, runtime: null, engine: null, network: chain.network,
    startAgents() {
      if (handles.engine) return 'running';
      if (!config.agentsOn) return 'AGENTS is off';
      handles.engine = startEngine({ app, db, chain, events, worldKey: key, now, rng: mulberry32(Date.now() % 2 ** 31), tickMs: config.engineTickMs });
      return 'started';
    },
  };
  await registerAgentRoutes(app, handles);
  await registerAdminRoutes(app, handles);
  const waiting = await worldNotReady(db, chain);
  if (waiting) {
    const treasury = await walletOf(db, TREASURY);
    console.log(`[world] agents wait: ${waiting}. Send ~6 devnet SOL to the treasury ${treasury?.publicKey}, then press "Set up and fund" in /admin.`);
  } else console.log('[world] agents:', handles.startAgents());
  return Object.assign(handles, { async stop() { await handles.runtime?.stop(); await handles.engine?.stop(); indexer.stop(); } });
}
