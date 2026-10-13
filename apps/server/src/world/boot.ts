import type { FastifyInstance } from 'fastify';
import { and, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { agents, chainTxs, wallets, worldCoins } from '../db/schema.ts';
import { registerAgentRoutes } from '../routes/agents.ts';
import { registerAdminRoutes } from '../routes/admin.ts';
import { registerAdminDevRoutes } from '../routes/admindev.ts';
import { registerDepthRoutes } from '../routes/depth.ts';
import { type AgentBrain } from './brain.ts';
import { Budget } from './budget.ts';
import { MemoryChain, type Chain } from './chain.ts';
import { DevnetChain, makeChain } from './devnet-chain.ts';
import { createLaunchpad, DBC_CONFIG, setSetting } from './launchpad.ts';
import { START_LAMPORTS, TreasuryEmpty, fundAgents } from './ledger.ts';
import { WorldEvents } from './events.ts';
import { Indexer } from './indexer.ts';
import { abortRunningTurns } from './provenance.ts';
import { bridgePulses } from '../agents/pulse.ts';
import { createDepth } from '../agents/depth/index.ts';
import { createImagePolicy } from '../agents/image-policy.ts';
import { factionMomentHandler } from '../agents/depth/factions.ts';
import { paperMomentHandler } from '../agents/depth/paper.ts';
import { reputation } from '../agents/depth/reputation.ts';
import { spotlightImageGen, startSpotlight } from '../agents/depth/spotlight.ts';
import { startEngine, type Engine } from '../agents/engine.ts';
import { haikuBrain, modelBudget } from '../agents/haiku.ts';
import { createMoments } from '../agents/moments.ts';
import type { Moments } from '../agents/types.ts';
import { mulberry32 } from '../seed/rng.ts';
import { RaisedGate } from '../agents/raised/gate.ts';
import { hatchMomentHandler, retryStartGrants, runHatch, type HatchDeps } from '../agents/raised/hatch.ts';
import { retireReported } from '../agents/raised/lifecycle.ts';
import { createHatchPump } from '../agents/raised/pump.ts';
import { Population } from '../agents/raised/pacing.ts';
import { registerRaisedRoutes } from '../routes/raised.ts';
import { seedWorld } from './seed.ts';
import { bootX } from '../x/boot.ts';
import { xDigestHandler } from '../x/digest.ts';
import { LedgerChain } from '../ledger/ledger-chain.ts';
import { bootMainnet } from '../ledger/boot.ts';
import type { MainnetHandles } from '../ledger/routes.ts';
import { TREASURY, parseWorldKey, signerFor, walletOf } from './wallets.ts';

export interface WorldHandles {
  indexer: Indexer; budget: Budget; chain: Chain; key: Buffer; engine: Engine | null; moments: Moments | null; network: Chain['network'];
  /** A ledger world's custody and routes (mainnet spec); null or absent everywhere else. */
  mainnet?: MainnetHandles | null;
  /** Starts the agents if AGENTS=on and the world is ready; says why not otherwise. */
  startAgents(): string;
}

/** Why the agents can't start yet, or null when they can: they need the launchpad and their 0.1 SOL first. */
export async function worldNotReady(db: Db, chain: Chain): Promise<string | null> {
  if (chain instanceof DevnetChain && !chain.hasLaunchpad) return 'the launchpad is not set up';
  // Wild agents only: a raised agent waiting for its start grant stays paused (RAISE) and must not keep the 50 from starting.
  const [unfunded] = await db.select({ id: wallets.ownerId }).from(wallets).innerJoin(agents, eq(agents.userId, wallets.ownerId))
    .where(and(eq(agents.origin, 'wild'), isNull(wallets.fundedAt))).limit(1);
  return unfunded ? 'agent wallets are not funded' : null;
}

/** One-time setup from the treasury: the launchpad config if it is missing, then 0.1 SOL to every unfunded agent. */
export async function setUpWorld(db: Db, chain: Chain, key: Buffer, now: () => Date) {
  if (chain instanceof LedgerChain) throw new TreasuryEmpty('A ledger world is funded by its season (npm run mainnet:season), not by the devnet treasury');
  let launchpad: string | null = null;
  if (chain instanceof DevnetChain && !chain.hasLaunchpad) {
    // The launchpad transaction is signed outside DevnetChain's send, so it checks the network itself.
    await chain.assertNotMainnet();
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

/** What a memory-chain wallet holds before any transaction: the same funding the boot airdrop gives. */
const memoryStart = (ownerId: string) => (ownerId === TREASURY ? 10_000_000_000 : START_LAMPORTS);

/**
 * Rebuilds an empty MemoryChain from the database (local and e2e use): every coin's pool from the tokens its trades sold,
 * every wallet's SOL and tokens from the transactions the world recorded. Null when the database has no chain history yet,
 * so a first boot is funded by the plain airdrop instead.
 */
export async function restoreMemoryChain(db: Db, chain: MemoryChain): Promise<{ pools: number; accounts: number } | null> {
  const [history] = await db.select({ txs: sql<number>`count(*)::int` }).from(chainTxs);
  if (!history?.txs) return null;
  const total = (col: typeof chainTxs.tokenDelta | typeof chainTxs.lamportsDelta) => sql<number>`coalesce(sum(${col}), 0)::float8`;
  const [coins, keys, sold, lamports, bags, [launches]] = await Promise.all([
    db.select({ mint: worldCoins.mint, pool: worldCoins.pool, graduatedAt: worldCoins.graduatedAt }).from(worldCoins),
    db.select({ ownerId: wallets.ownerId, publicKey: wallets.publicKey }).from(wallets),
    db.select({ mint: chainTxs.mint, sold: total(chainTxs.tokenDelta) }).from(chainTxs).where(isNotNull(chainTxs.mint)).groupBy(chainTxs.mint),
    // A 'fund' row is the 0.1 SOL a treasury transfer gave the wallet: it is already the starting balance, not a change to it.
    db.select({ ownerId: chainTxs.agentId, lamports: total(chainTxs.lamportsDelta) }).from(chainTxs).where(and(isNotNull(chainTxs.agentId), ne(chainTxs.kind, 'fund'))).groupBy(chainTxs.agentId),
    db.select({ ownerId: chainTxs.agentId, mint: chainTxs.mint, raw: total(chainTxs.tokenDelta) }).from(chainTxs)
      .where(and(isNotNull(chainTxs.agentId), isNotNull(chainTxs.mint))).groupBy(chainTxs.agentId, chainTxs.mint).having(sql`sum(${chainTxs.tokenDelta}) > 0`),
    db.select({ n: sql<number>`count(*)::int` }).from(worldCoins),
  ]);
  const soldOf = new Map(sold.map((r) => [r.mint, r.sold]));
  const spent = new Map(lamports.map((r) => [r.ownerId, r.lamports]));
  const accounts = keys.map((w) => ({
    publicKey: w.publicKey,
    lamports: Math.max(0, memoryStart(w.ownerId) + (spent.get(w.ownerId) ?? 0)),
    tokens: bags.filter((b) => b.ownerId === w.ownerId).map((b) => ({ mint: b.mint!, raw: b.raw })),
  }));
  const pools = coins.map((c) => ({ mint: c.mint, pool: c.pool, sold: soldOf.get(c.mint) ?? 0, graduated: c.graduatedAt !== null }));
  // Every transaction used at most one signature and every launch one mint number: this stays above all of them.
  chain.restore({ pools, accounts, signatures: history.txs + (launches?.n ?? 0) });
  return { pools: pools.length, accounts: accounts.length };
}

/** Everything the agent world needs at boot when WORLD_KEY is set: seed, chain, interrupted-turn cleanup, budget, indexer, engine, moment queue, routes. */
export async function bootAgents(app: FastifyInstance, opts: { brain?: AgentBrain; chain?: Chain } = {}): Promise<WorldHandles & { stop(): Promise<void> }> {
  const { db, config, now } = app.deps;
  if (!config.worldKey) throw new Error('The agent world needs WORLD_KEY (32 bytes, base64)');
  const key = parseWorldKey(config.worldKey);
  console.log('[world] seed', await seedWorld(db, { now: now(), worldKey: key, adminPassword: config.worldAdminPassword }));
  const chain = opts.chain ?? (await makeChain(config, db, undefined, now));
  // A ledger world: frozen state, the ledger's rug rule, custody and its routes. Throws (and so stops boot) when MAINNET is
  // misconfigured or MAINNET=on meets a closed launch gate (mainnet spec §9).
  const mainnet = await bootMainnet(app, { chain, worldKey: key });
  if (chain instanceof MemoryChain) {
    // The in-memory chain starts empty each boot (local and e2e use only): rebuild it from the database, or on a first boot give every wallet its 0.1 SOL.
    const restored = await restoreMemoryChain(db, chain);
    if (restored) console.log(`[world] memory chain restored: ${restored.pools} pools, ${restored.accounts} accounts`);
    else for (const w of await db.select().from(wallets)) chain.airdrop(w.publicKey, memoryStart(w.ownerId));
    await db.update(wallets).set({ fundedAt: now() });
  }
  const aborted = await abortRunningTurns(db, now());
  if (aborted) console.log(`[world] finalized ${aborted} interrupted turns as aborted`);
  // Hard daily cap on model spend; today's spend so far comes from the receipts, so the cap survives restarts.
  const budget = modelBudget(db, config.agentDailyBudgetUsd, now);
  await budget.load();
  // Raised agents' share of the daily cap and their owners (RAISE), rebuilt from today's receipts.
  const gate = new RaisedGate({ db, now, dailyUsd: config.agentDailyBudgetUsd, share: config.userAgentBudgetShare, ownerRepliesPerDay: config.ownerModelRepliesPerDay });
  await gate.load();
  const population = new Population(db, now);
  await population.refresh();
  // One set for the engine, the moment queue and hatching: an agent never has two turns open at once.
  const busy = new Set<string>();
  const indexer = new Indexer(db, chain, now);
  indexer.start();
  const events = new WorldEvents();
  events.on((e) => {
    if (e.type === 'trade') indexer.invalidate(e.agentId);
    else if (e.type === 'transfer') { indexer.invalidate(e.fromId); if (e.toId) indexer.invalidate(e.toId); }
    else indexer.invalidate(e.creatorId);
  });
  // Routes first: the engine acts through app.inject, which boots Fastify and closes registration.
  const handles: WorldHandles = {
    indexer, budget, chain, key, engine: null, moments: null, network: chain.network, mainnet,
    startAgents() {
      if (handles.engine) return 'running';
      if (!config.agentsOn) return 'AGENTS is off';
      const rng = mulberry32(Date.now() % 2 ** 31);
      // Hand-overs queued before this moment died with the previous process: the engine must see those messages again.
      const bootAt = now();
      const brain = opts.brain ?? (config.anthropicApiKey ? haikuBrain(config.anthropicApiKey) : null);
      // The same busy set as the engine: moment handlers, systemAct and the engine share one turn per agent.
      const md = brain ? { app, db, chain, events, worldKey: key, now, rng, busy, bootAt, brain, budget } : null;
      handles.moments = md ? createMoments({ ...md, raised: gate, handlers: { faction: factionMomentHandler(md), paper: paperMomentHandler(md), hatch: hatchMomentHandler({ ...md, gate }), x_digest: xDigestHandler(md) } }) : null;
      handles.engine = startEngine({ app, db, chain, events, worldKey: key, now, rng, busy, bootAt, moments: handles.moments ?? undefined, depth: createDepth(), images: createImagePolicy({ db, now, rng }), tickMs: config.engineTickMs, population: () => population.value() });
      // Scores exist from the first tick, not five minutes in; a failure here only means agents start with none.
      void reputation.refresh(db, now()).catch((e) => console.error('[depth] reputation boot refresh failed', e));
      return brain ? 'started' : 'started without the model (ANTHROPIC_API_KEY is missing)';
    },
  };
  await registerAgentRoutes(app, handles);
  await registerDepthRoutes(app, { indexer: handles.indexer });
  await registerAdminRoutes(app, handles);
  await registerAdminDevRoutes(app, handles);
  const raisedDeps = (): HatchDeps => ({ app, db, chain, events, worldKey: key, now, rng: mulberry32(Date.now() % 2 ** 31), busy, brain: null, budget, gate });
  const pump = createHatchPump({
    db, now, config, moments: () => handles.moments,
    hatchLocal: (id) => runHatch(raisedDeps(), id), retryStartGrants: () => retryStartGrants(raisedDeps()), retireReported: async () => { await retireReported({ db, chain, key, now, gate }); },
  });
  await registerRaisedRoutes(app, { handles, gate, pump, rng: Math.random });
  const pumpTimer = setInterval(() => { void pump().catch((e) => console.error('[raised] pump failed', e)); }, 60_000);
  pumpTimer.unref?.();
  // The X feed (x-feed spec): its routes register with the others; its scheduler reads handles.moments on every tick.
  const x = await bootX(app, handles);
  const waiting = await worldNotReady(db, chain);
  if (waiting) {
    const treasury = await walletOf(db, TREASURY);
    console.log(`[world] agents wait: ${waiting}. Send ~6 devnet SOL to the treasury ${treasury?.publicKey}, then press "Set up and fund" in /admin.`);
  } else console.log('[world] agents:', handles.startAgents());
  // Share cards, follower notifications and meme templates for big moments (Task 5.6), every 60 s. No OPENAI_API_KEY: no paid images.
  // Started last, once nothing in boot can throw, so a failed boot leaves no sweeping interval behind.
  const stopSpotlight = startSpotlight({
    db, bus: app.deps.bus, now,
    gen: spotlightImageGen(config),
    limits: { usd: config.imageDailyBudgetUsd, max: config.imageDailyMax },
  });
  // Public agent activity (launches, trades, transfers, rugs) for the live ticker and the swarm backdrop.
  const offPulses = bridgePulses(events, app.deps.bus, now);
  return Object.assign(handles, { async stop() { clearInterval(pumpTimer); await mainnet?.stop(); offPulses(); await stopSpotlight(); await x.stop(); await handles.moments?.stop(); await handles.engine?.stop(); indexer.stop(); } });
}
