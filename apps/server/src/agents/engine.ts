import type { FastifyInstance } from 'fastify';
import { and, eq, gte, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { agentState, agents, notifications } from '../db/schema.ts';
import type { Chain } from '../world/chain.ts';
import type { WorldEvents } from '../world/events.ts';
import { act } from './act.ts';
import { candidates, choose } from './decide.ts';
import { SWEEP_MS, type DepthRegistry } from './depth/registry.ts';
import { perceive } from './perceive.ts';
import { needsPhrasebook } from './phrasebook-writer.ts';
import type { ImagePolicy, Moments } from './types.ts';

export interface EngineDeps { app: FastifyInstance; db: Db; chain: Chain; events: WorldEvents; worldKey: Buffer; now: () => Date; rng: () => number; moments?: Moments; images?: ImagePolicy;
  /** Agents mid-turn, shared with the moment queue so one agent never has two turns open (defaults to one set per app). */
  busy?: Set<string>;
  /** When this process started: hand-over markers older than this belong to a queue that no longer exists. */
  bootAt?: Date;
  /** Phase 4 depth systems (beliefs, factions, drift…); absent means the plain Phase 2 engine. */
  depth?: DepthRegistry }
export interface Engine { tick(): Promise<void>; stop(): Promise<void>; stats(): { ticks: number; actions: Record<string, number>; lastError: string | null } }

export async function pickAgent(d: EngineDeps): Promise<string | null> {
  const rows = await d.db.select({ id: agents.userId, traits: agentState.traits, energy: agentState.energy })
    .from(agents).leftJoin(agentState, eq(agentState.agentId, agents.userId)).where(eq(agents.status, 'active'));
  if (!rows.length) return null;
  const since = new Date(d.now().getTime() - 30 * 60_000);
  const hot = new Set((await d.db.selectDistinct({ u: notifications.userId }).from(notifications)
    .where(and(gte(notifications.createdAt, since), inArray(notifications.type, ['mention', 'reply', 'quote', 'dm'])))).map((r) => r.u));
  const weights = rows.map((r) => 0.2 + (r.traits?.chattiness ?? 0.5) + (r.energy ?? 1) + (hot.has(r.id) ? 2 : 0));
  let x = d.rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < rows.length; i++) { x -= weights[i]!; if (x <= 0) return rows[i]!.id; }
  return rows.at(-1)!.id;
}

export function startEngine(d: EngineDeps & { tickMs: [number, number]; autoStart?: boolean }): Engine {
  let ticks = 0, lastError: string | null = null, stopped = false;
  let timer: NodeJS.Timeout | null = null;
  // Every tick, scheduled or manual, runs after the previous one: one agent acts at a time.
  let queue: Promise<void> = Promise.resolve();
  const actions: Record<string, number> = {};

  async function runTick() {
    if (stopped) return;
    try {
      const id = await pickAgent(d);
      if (!id) return;
      if (d.moments && (await needsPhrasebook(d.db, id, d.now()))) d.moments.enqueue({ kind: 'phrasebook', agentId: id, data: {}, at: d.now() });
      const v = await perceive(d, id);
      const base = candidates(v, d.rng);
      const cs = d.depth ? d.depth.modify(v, [...base, ...d.depth.candidates(v, d.rng)]) : base;
      const c = choose(cs, d.rng);
      const r = await act(d, v, c);
      // No turn id means act skipped (previous turn still running) or could not open one: a no-op tick.
      if (r.ok || r.turnId) {
        actions[c.kind] = (actions[c.kind] ?? 0) + 1;
        if (r.error) actions.failed = (actions.failed ?? 0) + 1;
      }
      // Model moments run beside the free engine; a failed drain is logged, never silent.
      void Promise.resolve(d.moments?.drain()).catch((e) => console.error('[agents] moments drain failed', e));
    } catch (e) {
      lastError = (e as Error)?.message ?? String(e);
      console.error('[agents] tick failed', e);
    } finally { ticks++; }
  }

  function tick(): Promise<void> {
    const next = queue.then(runTick);
    queue = next.catch(() => {});
    return next;
  }

  function schedule() {
    if (stopped) return;
    const [lo, hi] = d.tickMs;
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
    const next = queue.then(() => (stopped ? undefined : d.depth!.sweep(d))).finally(() => { sweepPending = false; });
    queue = next.catch((e) => console.error('[depth] sweep failed', e));
  }, SWEEP_MS) : null;
  sweepTimer?.unref?.();

  return {
    tick,
    async stop() { stopped = true; if (timer) clearTimeout(timer); offDepth(); if (sweepTimer) clearInterval(sweepTimer); await queue; },
    stats: () => ({ ticks, actions: { ...actions }, lastError }),
  };
}
