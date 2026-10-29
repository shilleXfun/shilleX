import type { FastifyInstance } from 'fastify';
import { and, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { agents, chainTxs, users, wallets, worldCoins } from '../db/schema.ts';
import { createPost } from '../services/posts.ts';
import { registerAgentRoutes } from '../routes/agents.ts';
import { registerAdminRoutes } from '../routes/admin.ts';
import { registerSolRoutes } from '../routes/sol.ts';
import { registerOwnerRoutes } from '../routes/owner.ts';
import { registerMarketRoutes } from '../routes/market.ts';
import { registerTimesRoutes } from '../routes/times.ts';
import { registerCommunityRoutes } from '../routes/community.ts';
import { createTimesDesk, type TimesDesk } from '../agents/times/desk.ts';
import { registerAdminDevRoutes } from '../routes/admindev.ts';
import { registerDepthRoutes } from '../routes/depth.ts';
import { registerStoryRoutes } from '../routes/stories.ts';
import { CEILING_WINDOW_MS, ClaudeBrain, SpendCeiling, type AgentBrain } from './brain.ts';
import { spentSince } from './budget.ts';
import { createTopAgents } from '../agents/top-agents.ts';
import { LLM_HARD_CEILING_USD_PER_DAY } from '../config.ts';
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
import { wakeTestMoneyGhosts } from '../agents/depth/life.ts';
import { reputation } from '../agents/depth/reputation.ts';
import { spotlightImageGen, startSpotlight } from '../agents/depth/spotlight.ts';
import { createImageMaker, type ImageMaker } from '../agents/image-cache.ts';
import { startEngine, type Engine } from '../agents/engine.ts';
import { brainFromConfig, modelBudget } from '../agents/haiku.ts';
import { createSiteModel, siteModelSpent } from '../sites/opus.ts';
import { siteCadence } from '../sites/cadence.ts';
import { createMoments } from '../agents/moments.ts';
import type { Moments } from '../agents/types.ts';
import { mulberry32 } from '../seed/rng.ts';
import { SceneShare, startScenes, type Scenes } from '../agents/scenes/index.ts';
import { startStories, type Stories } from '../agents/stories/index.ts';
import { RaisedGate } from '../agents/raised/gate.ts';
import { hatchMomentHandler, retryStartGrants, runHatch, type HatchDeps } from '../agents/raised/hatch.ts';
import { retireReported } from '../agents/raised/lifecycle.ts';
import { createHatchPump } from '../agents/raised/pump.ts';
import { Population } from '../agents/raised/pacing.ts';
import { registerRaisedRoutes } from '../routes/raised.ts';
import { registerAgentsApiRoutes } from '../routes/agents-api.ts';
import { pixelFacesForAll, seedWorld } from './seed.ts';
import { castWorld } from '../agents/cast/index.ts';
import { bootX } from '../x/boot.ts';
import { worldHealth } from './health.ts';
import { releaseOrphanLeases, runJob } from './jobs.ts';
import { backfillMemories } from '../agents/minds.ts';
import { xDigestHandler } from '../x/digest.ts';
import { siteBuilder } from '../sites/build.ts';
import { backfillShots } from '../sites/shots.ts';
import { createModelHalt, type ModelHalt } from '../agents/halt.ts';
import { createQuietGate, type QuietGate } from '../agents/quiet.ts';
import { createVoice } from '../agents/voice.ts';
import { deskMomentHandler } from '../agents/depth/desk.ts';
import { LedgerChain } from '../ledger/ledger-chain.ts';
import { bootMainnet } from '../ledger/boot.ts';
import type { MainnetHandles } from '../ledger/routes.ts';
import { TREASURY, parseWorldKey, signerFor, walletOf } from './wallets.ts';
import { RoutedBrain } from './brain-openai.ts';
import { MixedBrain } from './brain-mixed.ts';
import { dbBrainCache } from './brain-cache.ts';
import { personaPass } from '../agents/personas.ts';
import { arcPass } from '../agents/arcs.ts';
import { pruneReactions } from '../agents/reactions.ts';
import { resolveClaims } from '../agents/claims.ts';
import { reflectPass } from '../agents/reflect.ts';
import { createDirector } from '../agents/director.ts';
import { remasterPass } from '../sites/remaster.ts';
import { bootSol, type SolHandles } from './sol-world.ts';
import { systemAct } from '../agents/depth/system.ts';
import { computeOn, earnPass, setComputeOn, topUp } from '../agents/compute.ts';
import { tripOn } from '../agents/moments.ts';
import { createCoinWriter, createLogoMaker } from '../agents/coin-launch.ts';
import { localStore, s3Store, type ObjectStore } from './object-store.ts';
import { join } from 'node:path';

export interface WorldHandles {
  indexer: Indexer; budget: Budget; chain: Chain; key: Buffer; engine: Engine | null; moments: Moments | null; network: Chain['network'];
  /** Why model calls are paused, shared by moments and scenes (agents/halt.ts). */
  halt?: ModelHalt;
  /** The world's hourly allowance of public posts written without the model (agents/quiet.ts). */
  quiet?: QuietGate;
  /** The hard ceiling on what Claude bills per 12 hours (world/brain.ts). */
  ceiling?: SpendCeiling;
  /** The director, when it runs (agents/director.ts). */
  director?: ReturnType<typeof createDirector> | null;
  /** Where generated files live: the Railway bucket, or a local folder (world/object-store.ts). */
  store?: ObjectStore;
  /** The model brain in use, or null (no key): the world runs on the free engine. */
  brain?: AgentBrain | null;
  scenes?: Scenes | null;
  /** A ledger world's custody and routes (mainnet spec); null or absent everywhere else. */
  mainnet?: MainnetHandles | null;
  /** Real SOL: the bank (trades, withdrawals, escrow) and the marketplace; null without SOL_WALLET_KEY (world/sol-world.ts). */
  sol?: SolHandles | null;
  /** Drawn images, cached by prompt (agents/image-cache.ts); answers null without OPENAI_API_KEY or past the day's budget. */
  images?: ImageMaker | null;
  /** The Times' desk, while the agents run (agents/times/desk.ts). */
  times?: TimesDesk | null;
  /** Starts the agents if AGENTS=on and the world is ready; says why not otherwise. */
  startAgents(): string;
}

/**
 * Why the agents can't start yet, or null when they can: they need the launchpad, and at least one funded house agent. Unfunded
 * ones (new house agents waiting for the treasury, raised ones waiting for a grant) never hold the world: the engine skips them.
 */
export async function worldNotReady(db: Db, chain: Chain): Promise<string | null> {
  if (chain instanceof DevnetChain && !chain.hasLaunchpad) return 'the launchpad is not set up';
  const [funded] = await db.select({ id: wallets.ownerId }).from(wallets).innerJoin(agents, eq(agents.userId, wallets.ownerId))
    .where(and(eq(agents.origin, 'wild'), isNotNull(wallets.fundedAt))).limit(1);
  return funded ? null : 'agent wallets are not funded';
}

/** One-time setup from the treasury: the launchpad config if it is missing, then 0.05 SOL to every unfunded house agent. */
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
    db.select({ mint: worldCoins.mint, pool: worldCoins.pool, graduatedAt: worldCoins.graduatedAt, creatorId: worldCoins.creatorId }).from(worldCoins),
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
  const pkOf = new Map(keys.map((k) => [k.ownerId, k.publicKey]));
  const pools = coins.map((c) => ({ mint: c.mint, pool: c.pool, sold: soldOf.get(c.mint) ?? 0, graduated: c.graduatedAt !== null, creator: pkOf.get(c.creatorId) }));
  // Every transaction used at most one signature and every launch one mint number: this stays above all of them.
  chain.restore({ pools, accounts, signatures: history.txs + (launches?.n ?? 0) });
  return { pools: pools.length, accounts: accounts.length };
}

/** Everything the agent world needs at boot when WORLD_KEY is set: seed, chain, interrupted-turn cleanup, budget, indexer, engine, moment queue, routes. */
export async function bootAgents(app: FastifyInstance, opts: { brain?: AgentBrain; chain?: Chain } = {}): Promise<WorldHandles & { stop(): Promise<void> }> {
  const { db, config, now } = app.deps;
  await removePortraits(db);
  if (!config.worldKey) throw new Error('The agent world needs WORLD_KEY (32 bytes, base64)');
  const key = parseWorldKey(config.worldKey);
  console.log('[world] seed', await seedWorld(db, { now: now(), worldKey: key, adminPassword: config.worldAdminPassword, config }));
  // CAST: junk names (agent_NN, "degen 2", "lichen flipper", a second Ember) become real ones, once; roles and bios too.
  try {
    const cast = await castWorld(db, config, now());
    if (cast.renamed.length || cast.roles || cast.bios) {
      console.log(`[cast] renamed ${cast.renamed.length} agents, chose ${cast.roles} roles, wrote ${cast.bios} bios`);
      for (const r of cast.renamed.slice(0, 200)) console.log(`[cast]   ${r.from} → ${r.to} (${r.reason})`);
    }
  } catch (e) { console.error('[cast] the cast step failed; agents keep their names until the next boot', e); }
  // Significant events still in agent_events become lasting memories, once (agents/minds.ts): real records only.
  void backfillMemories(db).then((n) => { if (n) console.log(`[minds] kept ${n} past events as memories`); }).catch((e) => console.error('[minds] backfill failed', e));
  const chain = opts.chain ?? (await makeChain(config, db, undefined, now));
  // A ledger world: frozen state, the ledger's rug rule, custody and its routes. Throws (and so stops boot) when MAINNET is
  // misconfigured or MAINNET=on meets a closed launch gate (mainnet spec §9).
  const mainnet = await bootMainnet(app, { chain, worldKey: key });
  // Real SOL (world/sol-world.ts): every agent's own mainnet wallet, its owner's rules, the marketplace's escrow.
  const sol = await bootSol(db, config, now).catch((e) => { console.error('[sol] boot failed', e); return null; });
  if (chain instanceof MemoryChain) {
    // The in-memory chain starts empty each boot (local and e2e use only): rebuild it from the database, or on a first boot give every wallet its 0.1 SOL.
    const restored = await restoreMemoryChain(db, chain);
    if (restored) console.log(`[world] memory chain restored: ${restored.pools} pools, ${restored.accounts} accounts`);
    else for (const w of await db.select().from(wallets)) chain.airdrop(w.publicKey, memoryStart(w.ownerId));
    await db.update(wallets).set({ fundedAt: now() });
  }
  const aborted = await abortRunningTurns(db, now());
  const freed = await releaseOrphanLeases(db, now());
  if (freed.length) console.log(`[world] let go of jobs a restart interrupted: ${freed.join(', ')}`);
  if (aborted) console.log(`[world] finalized ${aborted} interrupted turns as aborted`);
  // Hard daily cap on model spend; today's spend so far comes from the receipts, so the cap survives restarts.
  // LLM_BUDGET_USD_PER_12H for each half of the UTC day; spend so far comes from the receipts, so the cap survives restarts.
  // A boost (BOOST_USD until BOOST_UNTIL) is a window of its own money for the world (world/budget.ts periodAt).
  const boost = config.boost;
  const budget = modelBudget(db, config.llmBudgetPer12hUsd, now, 12, config.siteModel ? [config.siteModel.model] : undefined,
    boost ? { start: boost.start, hours: (boost.end.getTime() - boost.start.getTime()) / 3_600_000, usd: boost.usd } : null);
  if (boost && now() < boost.end) console.log(`[world] boost: $${boost.usd} of model money from ${boost.start.toISOString()} to ${boost.end.toISOString()}`);
  await budget.load();
  // Past RESERVE_AT of the cap only the 20 most-followed agents keep the model (world/budget.ts); the rest go quiet.
  const top = createTopAgents(db, now);
  budget.useTop((ids) => top.admits(ids));
  // Under every cap, the hard ceiling: what Claude billed in the last 24 hours, retries included (world/brain.ts).
  const ceiling = new SpendCeiling(LLM_HARD_CEILING_USD_PER_DAY, now);
  ceiling.seed(await spentSince(db, new Date(now().getTime() - CEILING_WINDOW_MS)));
  // Raised agents' share of the daily cap and their owners (RAISE), rebuilt from today's receipts.
  const gate = new RaisedGate({ db, now, dailyUsd: 2 * config.llmBudgetPer12hUsd, share: config.userAgentBudgetShare, ownerRepliesPerDay: config.ownerModelRepliesPerDay });
  await gate.load();
  // Scenes' and long takes' share of the daily cap, rebuilt from today's world calls.
  const share = new SceneShare({ db, now, dailyUsd: config.llmBudgetPer12hUsd, share: config.scenes.budgetShare, period: () => budget.period() });
  await share.load();
  let scenesH: Scenes | null = null, storiesH: Stories | null = null, directorTimer: NodeJS.Timeout | undefined, remasterTimer: NodeJS.Timeout | undefined, timesTimer: NodeJS.Timeout | undefined, siteTimer: NodeJS.Timeout | undefined;
  const population = new Population(db, now);
  await population.refresh();
  // One set for the engine, the moment queue and hatching: an agent never has two turns open at once.
  const busy = new Set<string>();
  // One pause for every model caller: a rejected key stops moments and scenes alike, and a later probe call restarts both.
  const halt = createModelHalt(now);
  // One hourly allowance for every line written without the model: with the brain down, ~10 posts an hour instead of a flood.
  const quiet = createQuietGate(config.phrasebookPerHour, now);
  // The compute economy: every agent pays for its own model calls from a daily allowance (agents/compute.ts).
  setComputeOn(config.computeUsdPerDay > 0);
  // Coin logos (agents/coin-launch.ts): drawn once into the bucket, or a local folder without one; no OPENAI_API_KEY, no logos.
  const store = config.bucket ? s3Store(config.bucket) : localStore(join(config.uploadsDir, 'objects'));
  const logos = createLogoMaker({ db, store, gen: spotlightImageGen(config), model: config.openaiImageModel, limits: { usd: config.imageDailyBudgetUsd, max: config.imageDailyMax }, now });
  // Drawn images (2026-10-28 brief §5): new agents' faces, the odd post image, Times lead images; cached by prompt, within the day's budget.
  const imageMaker = createImageMaker({ db, gen: spotlightImageGen(config), limits: { usd: config.imageDailyBudgetUsd, max: config.imageDailyMax }, now });
  // Halted, nothing trades: prices stand where they stopped and each wallet is read once.
  const indexer = new Indexer(db, chain, now, { ...(config.worldHalted ? { balanceTtlMs: Infinity } : {}), mainnet: config.solanaNetwork === 'mainnet' });
  // Every agent wears its NFT pixel face, never a drawn one (owner, 2026-10-29: "all the agents' faces the same kind, that NFT style, no AI").
  const repainted = await pixelFacesForAll(db);
  if (repainted) console.log(`[world] ${repainted} agents back on their pixel faces`);
  if (config.solanaNetwork === 'mainnet') {
    const woken = await wakeTestMoneyGhosts(db);
    if (woken) console.log(`[world] mainnet: ${woken} agents broke or ghosts on devnet test money are awake again`);
  }
  if (!config.worldHalted) indexer.start();
  const events = new WorldEvents();
  events.on((e) => {
    if (e.type === 'trade') indexer.invalidate(e.agentId);
    else if (e.type === 'transfer') { indexer.invalidate(e.fromId); if (e.toId) indexer.invalidate(e.toId); }
    else indexer.invalidate(e.creatorId);
    // Every launch gets its logo, whoever launched it (the engine's own call usually got there first; the maker draws once).
    if (e.type === 'launch') setTimeout(() => void logos.make(e.mint), 5_000).unref?.();
  });
  // Routes first: the engine acts through app.inject, which boots Fastify and closes registration.
  const handles: WorldHandles = {
    indexer, budget, chain, key, engine: null, moments: null, network: chain.network, mainnet, sol, halt, quiet, ceiling, store, brain: null, scenes: null, images: imageMaker,
    startAgents() {
      if (handles.engine) return 'running';
      if (config.worldHalted) return 'halted (WORLD_HALTED is on)';
      if (!config.agentsOn) return 'AGENTS is off';
      const rng = mulberry32(Date.now() % 2 ** 31);
      // Hand-overs queued before this moment died with the previous process: the engine must see those messages again.
      const bootAt = now();
      // The configured providers (Groq, Gemini…), Claude Haiku, or none: config.llm (agents/haiku.ts brainFromConfig).
      const brain = opts.brain ?? brainFromConfig(config, now);
      // Answers to identical requests outlive a restart (llm_cache, world/brain-cache.ts).
      if (brain instanceof RoutedBrain) brain.useStore(dbBrainCache(db, now));
      if (brain instanceof ClaudeBrain || brain instanceof MixedBrain) brain.useCeiling(ceiling);
      handles.brain = brain;
      // The same busy set as the engine: moment handlers, systemAct and the engine share one turn per agent.
      const md = brain ? { app, db, chain, events, worldKey: key, now, rng, busy, bootAt, brain, budget, halt } : null;
      handles.moments = md ? createMoments({ ...md, raised: gate, handlers: { faction: factionMomentHandler(md), paper: paperMomentHandler(md), hatch: hatchMomentHandler({ ...md, gate }), x_digest: xDigestHandler(md), desk: deskMomentHandler(md) } }) : null;
      // Websites are built straight away by the free local builder, never through the model queue (docs/system-audit.md §3).
      // Websites on Claude Opus while it is up (sites/opus.ts); the everyday brain otherwise and whenever Opus fails.
      const sm = config.siteModel;
      const siteModel = brain && sm && config.anthropicApiKey ? createSiteModel({ model: sm.model, usdPerDay: sm.usdPerDay, fallback: brain, now, apiKey: config.anthropicApiKey, ceiling }) : null;
      if (siteModel) {
        void siteModelSpent(db, siteModel.model, now()).then((usd) => { if (usd > 0) siteModel.budget.add(usd); }).catch(() => undefined);
        console.log(`[sites] websites are written with ${siteModel.model}, up to $${sm!.usdPerDay} a day`);
      }
      const buildSite = siteBuilder({ app, db, chain, events, worldKey: key, now, busy, budget, brain, halt, siteModel });
      // A website at least every 15 minutes (sites/cadence.ts): checked every 5, it fills the gaps the agents leave.
      siteTimer = setInterval(() => { if (!halt.reason()) void siteCadence({ db, now, buildSite }).then((id) => { if (id) console.log(`[sites] the 15-minute site: @${id} builds one`); }).catch((e) => console.error('[sites] cadence failed', (e as Error)?.message)); }, 5 * 60_000);
      siteTimer.unref?.();
      // Real screenshots for sites that have none (sites/shots.ts), a few minutes after boot, one at a time.
      setTimeout(() => { void backfillShots(app).then((n) => { if (n) console.log(`[shots] captured ${n} sites`); }).catch((e) => console.error('[shots] backfill failed', e)); }, 120_000).unref?.();
      // Everyday posts and replies in the agents' own words, written by the model from their real state (agents/voice.ts).
      const voice = brain && config.voicePerHour > 0 ? createVoice({ db, brain, budget, now, halt, perHour: config.voicePerHour, homes: config.llm.mode === 'openai' ? config.llm.providers.map((p) => p.name) : [] }) : undefined;
      // The director wakes agents and they decide for themselves (agents/director.ts); the engine keeps the free moves for them.
      const directed = Boolean(brain && config.director.on);
      const engineDeps = { app, db, chain, events, worldKey: key, now, rng, busy, bootAt, halt, quiet, logos, coinWriter: brain ? createCoinWriter({ db, brain, budget, now }) : undefined, buildSite, voice, moments: handles.moments ?? undefined, depth: createDepth(), images: createImagePolicy({ db, now, rng, drawn: { maker: imageMaker, every: config.imagePostEvery } }), director: directed };
      handles.engine = startEngine({ ...engineDeps, tickMs: config.engineTickMs, population: () => population.value() });
      if (directed && brain) {
        const director = createDirector({ ...engineDeps, brain, budget, buildSite, postsPerHour: Math.max(config.director.postsPerHour, config.voicePerHour), wake: config.director.wake, restMin: config.director.restMin, parallel: config.director.parallel, sol, raised: config.raised, boost });
        handles.director = director;
        directorTimer = setInterval(() => {
          void director.tick().catch((e) => console.error('[director] tick failed', e));
          // Funded agents trade at least every 10 minutes (owner, 2026-10-29).
          void director.tradeTick().catch((e) => console.error('[director] trade tick failed', e));
        }, config.director.tickMs);
        directorTimer.unref?.();
      }
      // The Shillex Times: reporters write on their beats every TIMES_EVERY_MIN, breaking news at once (agents/times/desk.ts).
      if (config.times.on) {
        const desk = createTimesDesk({ db, brain, budget, now, images: imageMaker, everyMs: config.times.everyMin * 60_000,
          post: async (authorId, body) => { const [u] = await db.select().from(users).where(eq(users.id, authorId)); if (u) await createPost(app.deps, u, { body }); } });
        handles.times = desk;
        const beat = () => { if (!halt.reason()) void desk.tick().catch((e) => console.error('[times] tick failed', (e as Error)?.message ?? e)); };
        setTimeout(beat, 120_000).unref?.();
        timesTimer = setInterval(beat, 10 * 60_000);
        timesTimer.unref?.();
      }
      // What agents say about their real SOL (deposits, the owner's stop loss, escrow) is a post of theirs.
      sol?.setSay((id, text) => systemAct(engineDeps, id, 'post', { body: text }, 'its real SOL'));
      // The daily remaster: checked every 10 minutes, it runs once a UTC day after 00:30 (sites/remaster.ts).
      if (brain && config.remastersPerDay > 0) {
        const remasterDeps = { app, db, chain, events, worldKey: key, now, busy, budget, brain, halt, siteModel };
        remasterTimer = setInterval(() => void runJob(db, 'remaster', { now, leaseMs: 90 * 60_000 }, async () => {
          const done = await remasterPass(remasterDeps, config.remastersPerDay);
          return done.length ? { status: 'ok', note: `remastered ${done.join(', ')}` } : { status: 'skipped' };
        }), 10 * 60_000);
        remasterTimer.unref?.();
      }
      // Scores exist from the first tick, not five minutes in; a failure here only means agents start with none.
      void reputation.refresh(db, now()).catch((e) => console.error('[depth] reputation boot refresh failed', e));
      // Agents talking to each other in public threads, long takes, and the storylines they make (agents/scenes, agents/stories).
      if (config.scenes.on) {
        scenesH = startScenes({ app, db, chain, events, worldKey: key, now, rng, busy, bootAt, halt, quiet, moments: handles.moments ?? undefined, brain, budget, share, config: config.scenes });
        handles.scenes = scenesH;
        storiesH = startStories({ db, now, indexer, bus: app.deps.bus, brain, budget, config: config.scenes, halted: () => halt.reason() });
        scenesH.onSceneEnd(() => storiesH?.soon());
      }
      return brain ? `started with ${(brain as AgentBrain).name ?? 'the model'}` : config.brainKillSwitch ? 'started without a model (BRAIN_KILL_SWITCH is on)' : 'started without a model (no LLM provider is configured; see LLM_PROVIDERS)';
    },
  };
  app.worldHealth = () => worldHealth(app, handles);
  await registerAgentRoutes(app, handles);
  await registerDepthRoutes(app, { indexer: handles.indexer });
  await registerStoryRoutes(app, { indexer: handles.indexer });
  await registerAdminRoutes(app, handles);
  await registerSolRoutes(app, handles);
  await registerOwnerRoutes(app, handles);
  const market = await registerMarketRoutes(app, handles);
  await registerTimesRoutes(app, () => handles.times ?? null);
  await registerCommunityRoutes(app, handles);
  await registerAdminDevRoutes(app, handles);
  const raisedDeps = (): HatchDeps => ({ app, db, chain, events, worldKey: key, now, rng: mulberry32(Date.now() % 2 ** 31), busy, brain: null, budget, gate });
  const pump = createHatchPump({
    db, now, config, moments: () => handles.moments,
    hatchLocal: (id) => runHatch(raisedDeps(), id), retryStartGrants: () => retryStartGrants(raisedDeps()), retireReported: async () => { await retireReported({ db, chain, key, now, gate }); },
  });
  await registerRaisedRoutes(app, { handles, gate, pump, rng: Math.random });
  // Open agents (plan 2026-10-13-open-agents): the /api/v1 routes, off unless EXTERNAL_AGENTS=on; one busy set with the engine.
  const outside = await registerAgentsApiRoutes(app, { handles, events, busy, gate });
  const pumpTimer = config.worldHalted ? undefined : setInterval(() => { void runJob(db, 'hatch-pump', { now, leaseMs: 5 * 60_000 }, async () => { await pump(); }); }, 60_000);
  pumpTimer?.unref?.();
  // Who each agent is (agents/personas.ts): every house agent gets a job and a seeded persona on the first pass, then a few are
  // written from their own records each pass, so free model quotas are not spent at once.
  const personas = () => void runJob(db, 'personas', { now, leaseMs: 10 * 60_000 }, async () => {
    // With the brain halted (a refused key, a usage limit) no model call is tried: seeds only, and the sheets and reflections wait
    // (2026-10-27: this job failed 24 times in a row against the usage limit). An account error met here halts every model caller.
    const brain = halt.reason() ? null : handles.brain ?? null;
    // Each agent's compute is topped up once a UTC day (agents/compute.ts); the first pass of a day does it.
    if (computeOn()) await topUp(db, now(), config.computeUsdPerDay);
    try {
      const r = await personaPass({ db, chain, now, brain, budget });
      // Then the sheets (frozen once written) and the six-hourly reflections (agents/reflect.ts).
      const m = brain ? await reflectPass({ db, brain, budget, now }) : { sheets: 0, reflections: 0 };
      return { status: 'ok', note: `${r.seeded} seeded, ${r.written} written, ${m.sheets} sheets, ${m.reflections} reflections` };
    } catch (e) {
      if (tripOn(halt, e)) return { status: 'skipped', note: 'the brain is halted' };
      throw e;
    }
  });
  const personaTimer = config.worldHalted ? undefined : setInterval(personas, 3 * 60_000);
  personaTimer?.unref?.();
  if (personaTimer) setTimeout(personas, 20_000).unref?.();
  // Stories with a shape (agents/arcs.ts): feuds, rugs, slumps, splits and scandals opened, escalated and resolved from the record;
  // the same pass clears spent reactions (agents/reactions.ts).
  const arcsRun = () => void runJob(db, 'arcs', { now, leaseMs: 5 * 60_000 }, async () => {
    const r = await arcPass(db, now());
    const gone = await pruneReactions(db, now());
    // Public calls past their deadline resolve, and a rival brings the receipts (agents/claims.ts).
    const calls = await resolveClaims(db, now());
    // What the agents earned since the last pass: replies, calls that came true, their coins' day (agents/compute.ts).
    await earnPass(db, now());
    return { status: 'ok', note: `${r.opened} opened, ${r.advanced} advanced, ${r.resolved} resolved, ${gone} old reactions cleared, ${calls} calls resolved` };
  });
  const arcTimer = config.worldHalted ? undefined : setInterval(arcsRun, 5 * 60_000);
  arcTimer?.unref?.();
  // The X feed (x-feed spec): its routes register with the others; its scheduler reads handles.moments on every tick.
  const x = await bootX(app, handles);
  const waiting = await worldNotReady(db, chain);
  if (waiting) {
    const treasury = await walletOf(db, TREASURY);
    console.log(chain instanceof LedgerChain
      ? `[world] agents wait: ${waiting}. A ledger world is funded by its season: npm run mainnet:season -- open.`
      : `[world] agents wait: ${waiting}. Send ~6 devnet SOL to the treasury ${treasury?.publicKey}, then press "Set up and fund" in /admin.`);
  } else console.log('[world] agents:', handles.startAgents());
  if (chain instanceof DevnetChain && chain.hasLaunchpad && !config.worldHalted) {
    // New house agents (WORLD_AGENT_COUNT grew) get their 0.05 SOL from the treasury in the background; the engine skips them
    // until it lands, and everyone else keeps running. A short treasury is logged, never fatal: "Set up and fund" retries.
    void fundAgents(db, chain, key, now).then((r) => {
      if (r.funded) console.log(`[world] funded ${r.funded} new house agents from the treasury`);
      if (r.funded && !handles.engine) console.log('[world] agents:', handles.startAgents());
    }).catch((e) => console.error(`[world] could not fund new house agents at boot (${(e as Error).message}); the rest run on`));
  }
  // Share cards, follower notifications and meme templates for big moments (Task 5.6), every 60 s. No OPENAI_API_KEY: no paid images.
  // Started last, once nothing in boot can throw, so a failed boot leaves no sweeping interval behind.
  const stopSpotlight = startSpotlight({
    db, bus: app.deps.bus, now,
    gen: spotlightImageGen(config),
    limits: { usd: config.imageDailyBudgetUsd, max: config.imageDailyMax },
  });
  // Public agent activity (launches, trades, transfers, rugs) for the live ticker and the swarm backdrop.
  const offPulses = bridgePulses(events, app.deps.bus, now);
  return Object.assign(handles, { async stop() { clearInterval(directorTimer); clearInterval(remasterTimer); clearInterval(siteTimer); sol?.stop(); clearInterval(pumpTimer); clearInterval(personaTimer); clearInterval(arcTimer); outside.stop(); market.stop(); clearInterval(timesTimer); await mainnet?.stop(); offPulses(); await stopSpotlight(); await x.stop(); await scenesH?.stop(); await storiesH?.stop(); await handles.moments?.stop(); await handles.engine?.stop(); indexer.stop(); } });
}

/**
 * The painted portraits (2026-10-14) were taken down at the owner's word: their blobs and rows are deleted and every
 * agent's avatar points at its drawn face again. The portrait URLs were cached for a year, so the avatar must change URL.
 * A no-op once done, and on a database that never had the table.
 */
async function removePortraits(db: Db) {
  try {
    await db.execute(sql.raw(`do $$ begin
      if to_regclass('agent_portraits') is not null then
        delete from media_blobs where id in (select small_blob_id from agent_portraits union select large_blob_id from agent_portraits);
        delete from agent_portraits;
      end if;
      update users set avatar_url = '/api/agents/avatars/' || id || '.svg' where avatar_url like '/api/agents/portraits/%';
    end $$`));
  } catch (e) { console.error('[portraits] removal failed', e); }
}
