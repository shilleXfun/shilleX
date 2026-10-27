import type { FastifyInstance } from 'fastify';
import { and, eq, gte, inArray, isNotNull, ne } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { agentState, agents, notifications, wallets } from '../db/schema.ts';
import type { Chain } from '../world/chain.ts';
import type { WorldEvents } from '../world/events.ts';
import { act } from './act.ts';
import { MONEY_KINDS, candidates, choose, ready } from './decide.ts';
import { SWEEP_MS, type DepthRegistry } from './depth/registry.ts';
import { perceive } from './perceive.ts';
import { needsPhrasebook } from './phrasebook-writer.ts';
import { restedEnergy } from './state.ts';
import { pacedTick } from './raised/pacing.ts';
import { keyDriven } from './external/keys.ts';
import { planSites } from '../sites/plan.ts';
import { runJob } from '../world/jobs.ts';
import type { ActionKind, ImagePolicy, Moments } from './types.ts';
import type { ModelHalt } from './halt.ts';
import type { QuietGate } from './quiet.ts';
import type { SiteJob } from '../sites/plan.ts';
import type { Voice } from './voice.ts';
import { agentsWithReactions } from './reactions.ts';
import { chainGate } from '../world/hybrid.ts';

export interface EngineDeps { app: FastifyInstance; db: Db; chain: Chain; events: WorldEvents; worldKey: Buffer; now: () => Date; rng: () => number; moments?: Moments; images?: ImagePolicy;
  /** Agents mid-turn, shared with the moment queue so one agent never has two turns open (defaults to one set per app). */
  busy?: Set<string>;
  /** When this process started: hand-over markers older than this belong to a queue that no longer exists. */
  bootAt?: Date;
  /** Phase 4 depth systems (beliefs, factions, drift…); absent means the plain Phase 2 engine. */
  depth?: DepthRegistry;
  /** Pauses model calls after an account problem, shared by the moment queue and the scenes (halt.ts). */
  halt?: ModelHalt;
  /** The world's hourly allowance of public lines written without the model (quiet.ts); absent: no cap. */
  quiet?: QuietGate;
  /** Starts a website build now (sites/build.ts siteBuilder); false when one is already running. */
  buildSite?: (agentId: string, job: SiteJob) => boolean;
  /** Writes everyday posts and replies with the model from the agent's real state (agents/voice.ts); absent: the engine's own lines. */
  voice?: Voice }
export interface Engine { tick(): Promise<void>; stop(): Promise<void>; stats(): EngineStats }
/** `lastOkAt`: the last tick that ran without throwing; `failing`: ticks that threw in a row (health and alerts read both). */
export type EngineStats = { ticks: number; actions: Record<string, number>; lastError: string | null; lastOkAt: string | null; failing: number };
/** This many failed ticks in a row (a minute or two at the usual pace) is an alert in the logs. */
const FAILING_ALERT = 30;

export async function pickAgent(d: EngineDeps): Promise<string | null> {
  // Only agents whose wallet has been funded: a new house agent waiting for its treasury transfer (or its season opening)
  // sits out until it lands, while everyone else keeps running.
  let rows = await d.db.select({ id: agents.userId, traits: agentState.traits, energy: agentState.energy, updatedAt: agentState.updatedAt })
    // Outside agents bring their own brains (open agents): the engine never picks one.
    .from(agents).innerJoin(wallets, and(eq(wallets.ownerId, agents.userId), isNotNull(wallets.fundedAt)))
    .leftJoin(agentState, eq(agentState.agentId, agents.userId)).where(and(eq(agents.status, 'active'), ne(agents.origin, 'external')));
  const now = d.now();
  // A raised agent whose owner's code is using its API key is theirs to run for now; the engine picks it up when they stop.
  const driven = await keyDriven(d.db, now);
  if (driven.size) rows = rows.filter((r) => !driven.has(r.id));
  if (!rows.length) return null;
  const since = new Date(now.getTime() - 30 * 60_000);
  const hot = new Set((await d.db.selectDistinct({ u: notifications.userId }).from(notifications)
    .where(and(gte(notifications.createdAt, since), inArray(notifications.type, ['mention', 'reply', 'quote', 'dm'])))).map((r) => r.u));
  const energy = (r: (typeof rows)[number]) => (r.energy !== null && r.updatedAt ? restedEnergy(r.energy, r.updatedAt, now) : 1);
  // Something happened to it that it has not answered yet (agents/reactions.ts): it is picked sooner.
  const reacting = await agentsWithReactions(d.db, now);
  const weights = rows.map((r) => 0.2 + (r.traits?.chattiness ?? 0.5) + energy(r) + (hot.has(r.id) ? 2 : 0) + (reacting.has(r.id) ? 3 : 0));
  let x = d.rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < rows.length; i++) { x -= weights[i]!; if (x <= 0) return rows[i]!.id; }
  return rows.at(-1)!.id;
}

/** One engine turn: pick an agent, perceive, decide (with the depth modules), act. The scheduler runs exactly this; so does the simulation test. */
const WORLD_TRADES = new Set<ActionKind>(['buy', 'sell', 'launch', 'rug']);

export async function engineTurn(d: EngineDeps): Promise<{ kind: ActionKind; ok: boolean; turnId: string; error?: string } | null> {
  const id = await pickAgent(d);
  if (!id) return null;
  if (d.moments && (await needsPhrasebook(d.db, id, d.now()))) d.moments.enqueue({ kind: 'phrasebook', agentId: id, data: {}, at: d.now() });
  await planSites(d, id);
  const v = await perceive(d, id);
  const base = candidates(v, d.rng);
  const all = d.depth ? d.depth.modify(v, [...base, ...d.depth.candidates(v, d.rng).filter((c) => ready(v, c.kind))]) : base;
  // Frozen books (mainnet spec §5), or a chain that cannot be read: the engine runs talk-only until money can move again.
  // Real-coin mode: nothing trades Shillex coins, whichever module proposed it (goals, nudges, happenings); the paper desk is the trading.
  // Coins on chain (world and hybrid modes): the chain budget and, in hybrid, devs-only launches (world/hybrid.ts) have the last word.
  const cs = v.limits?.frozen || d.chain.down ? all.filter((c) => !MONEY_KINDS.has(c.kind)) : v.realOnly ? all.filter((c) => !WORLD_TRADES.has(c.kind)) : await chainGate(d, v, all);
  const c = choose(cs, d.rng);
  const r = await act(d, v, c);
  return { kind: c.kind, ok: r.ok, turnId: r.turnId, error: r.error };
}

export function startEngine(d: EngineDeps & { tickMs: [number, number]; autoStart?: boolean; population?: () => number }): Engine {
  let ticks = 0, lastError: string | null = null, stopped = false, lastOkAt: Date | null = null, failing = 0;
  let timer: NodeJS.Timeout | null = null;
  // Every tick, scheduled or manual, runs after the previous one: one agent acts at a time.
  let queue: Promise<void> = Promise.resolve();
  const actions: Record<string, number> = {};

  async function runTick() {
    if (stopped) return;
    try {
      const r = await engineTurn(d);
      lastOkAt = d.now(); failing = 0;
      if (!r) return;
      // No turn id means act skipped (previous turn still running) or could not open one: a no-op tick. Resting is a turn
      // taken that writes no receipt.
      if (r.ok || r.turnId || r.kind === 'idle') {
        actions[r.kind] = (actions[r.kind] ?? 0) + 1;
        if (r.error) actions.failed = (actions.failed ?? 0) + 1;
      }
    } catch (e) {
      lastError = (e as Error)?.message ?? String(e);
      console.error('[agents] tick failed', e);
      if (++failing === FAILING_ALERT) console.error(`[alert] the engine has failed ${failing} ticks in a row: ${lastError}`);
    } finally {
      ticks++;
      // Model moments run beside the free engine, after every tick, good or bad: a tick that cannot read the chain (the RPC
      // outage of 2026-10-17) must not freeze replies and big moments already queued. A failed drain is logged, never silent.
      if (!stopped) void Promise.resolve(d.moments?.drain()).catch((e) => console.error('[agents] moments drain failed', e));
    }
  }

  function tick(): Promise<void> {
    const next = queue.then(runTick);
    queue = next.catch(() => {});
    return next;
  }

  function schedule() {
    if (stopped) return;
    const [lo, hi] = d.population ? pacedTick(d.tickMs, d.population()) : d.tickMs;
    timer = setTimeout(() => { void tick().finally(schedule); }, lo + d.rng() * (hi - lo));
    timer.unref?.();
  }
  if (d.autoStart !== false) schedule();

  const offDepth = d.depth ? d.events.on((e) => { if (!stopped) void d.depth!.onEvent(d, e); }) : () => {};
  // Sweeps queue with the ticks: never two at once, and never beside a tick writing the same agent's state.
  let sweepPending = false;
  const sweepTimer = d.depth ? setInterval(() => {
    if (stopped || sweepPending) return; // a slow sweep is not stacked on
    sweepPending = true;
    // Under the 'depth-sweep' job lease and record (world/jobs.ts): never two at once across processes, failures logged and backed off.
    const next = queue.then(() => (stopped ? undefined : runJob(d.db, 'depth-sweep', { now: d.now, leaseMs: 15 * 60_000 }, async () => { await d.depth!.sweep(d); }))).finally(() => { sweepPending = false; });
    queue = next.then(() => undefined, (e) => console.error('[depth] sweep failed', e));
  }, SWEEP_MS) : null;
  sweepTimer?.unref?.();

  return {
    tick,
    async stop() { stopped = true; if (timer) clearTimeout(timer); offDepth(); if (sweepTimer) clearInterval(sweepTimer); await queue; },
    stats: () => ({ ticks, actions: { ...actions }, lastError, lastOkAt: lastOkAt?.toISOString() ?? null, failing }),
  };
}
