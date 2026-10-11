import type Anthropic from '@anthropic-ai/sdk';
import type { FastifyInstance } from 'fastify';
import { eq, notInArray, sql } from 'drizzle-orm';
import type { ContextItem, ToolCallRecord, TurnTrigger, TurnUsage } from '@shillex/shared';
import { agentTurns, agents, users } from '../db/schema.ts';
import { AgentActor } from './actor.ts';
import { MODEL, priceOf, type AgentBrain } from './brain.ts';
import type { Budget } from './budget.ts';
import type { Chain } from './chain.ts';
import { SnapshotCache, buildTurnRequest } from './context.ts';
import type { WorldEvents } from './events.ts';
import { PROMPT_VERSION } from './prompt.ts';
import { finishTurn, recordProgress, startTurn } from './provenance.ts';
import { runTool, type ToolContext } from './tools.ts';
import { WakeRouter, type WorldBus } from './wakes.ts';

export interface RuntimeDeps {
  app: FastifyInstance; brain: AgentBrain; chain: Chain; budget: Budget; events: WorldEvents; bus: WorldBus | null; worldKey: Buffer;
  now?: () => Date; random?: () => number; heartbeatMs?: number; cooldownMs?: number; priorityCooldownMs?: number; concurrency?: number; maxRoundTrips?: number; autoStart?: boolean;
}
export interface Runtime { wake(agentId: string, trigger: TurnTrigger): void; heartbeat(): Promise<void>; idle(): Promise<void>; stop(): Promise<void>; stats(): { queued: number; running: number; halted: string | null } }

/** Wakes about something that happened to this agent specifically: they wait out a shorter cooldown. */
const PRIORITY: TurnTrigger['type'][] = ['mention', 'reply', 'dm', 'money'];
/** Errors that will fail every turn until a human fixes the account, so the runtime halts instead of burning turns. */
export function accountProblem(e: unknown): string | null {
  const status = (e as { status?: number })?.status;
  const msg = (e as Error)?.message ?? '';
  if (status === 401) return 'Anthropic rejected ANTHROPIC_API_KEY (401); set a valid key and restart';
  if (status === 403) return 'Anthropic refused this key permission (403); check the key and restart';
  if (status === 400 && /credit balance|billing/i.test(msg)) return 'The Anthropic account is out of credit; top it up and restart';
  // A malformed request fails the same way for every agent, so it is a deploy problem, not a turn problem.
  if (status === 400 && /invalid_request_error/.test(msg)) return `Anthropic rejected the request shape (400): ${/"message":"([^"]+)"/.exec(msg)?.[1] ?? msg.slice(0, 200)}`;
  return null;
}
const truncate = (v: unknown) => { const s = JSON.stringify(v ?? null); return s.length <= 2000 ? v : `${s.slice(0, 2000)}…`; };

export function startRuntime(d: RuntimeDeps): Runtime {
  const { app, brain, chain, budget, events } = d;
  const db = app.deps.db;
  const now = d.now ?? (() => new Date());
  const random = d.random ?? Math.random;
  const heartbeatMs = d.heartbeatMs ?? 60_000, cooldownMs = d.cooldownMs ?? 45_000, priorityCooldownMs = Math.min(d.priorityCooldownMs ?? 15_000, cooldownMs);
  const concurrency = d.concurrency ?? 3, maxRoundTrips = d.maxRoundTrips ?? 4;
  const actor = new AgentActor(app);
  const snapshots = new SnapshotCache(db, now);
  const router = new WakeRouter(db, now, random);
  const pending = new Map<string, TurnTrigger[]>();
  const running = new Set<string>();
  const lastTurnAt = new Map<string, number>();
  const turnCount = new Map<string, number>();
  let stopped = false, halted: string | null = null, timer: NodeJS.Timeout | null = null, retryTimer: NodeJS.Timeout | null = null;
  const idleWaiters: (() => void)[] = [];
  // Failed and aborted turns don't count: an agent whose first turn never ran gets it again.
  const ready = (async () => {
    await router.load();
    for (const r of await db.select({ a: agentTurns.agentId, n: sql<number>`count(*)::int` }).from(agentTurns).where(notInArray(agentTurns.status, ['failed', 'aborted'])).groupBy(agentTurns.agentId)) turnCount.set(r.a, r.n);
  })().catch((e) => console.error('[world] runtime warm-up failed', e));

  function settle() {
    if (running.size === 0 && (pending.size === 0 || stopped)) while (idleWaiters.length) idleWaiters.shift()!();
  }

  function wake(agentId: string, trigger: TurnTrigger) {
    if (stopped || halted) return;
    const level = budget.level();
    if (level === 'stopped') return;
    if (level === 'events' && (trigger.type === 'heartbeat' || trigger.type === 'first_turn')) return;
    pending.set(agentId, [...(pending.get(agentId) ?? []), trigger]);
    void pump();
  }

  async function pump() {
    await ready;
    if (halted) pending.clear();
    if (stopped || halted) return settle();
    const t = now().getTime();
    let waitMs = Infinity;
    for (const [agentId, triggers] of [...pending]) {
      if (running.size >= concurrency) break;
      if (running.has(agentId)) continue;
      const since = t - (lastTurnAt.get(agentId) ?? 0);
      const wait = (triggers.some((x) => PRIORITY.includes(x.type)) ? priorityCooldownMs : cooldownMs) - since;
      if (wait > 0) { waitMs = Math.min(waitMs, wait); continue; }
      pending.delete(agentId);
      running.add(agentId);
      void runTurn(agentId, triggers)
        .catch((e) => console.error('[world] turn crashed', agentId, e))
        .finally(() => { running.delete(agentId); lastTurnAt.set(agentId, now().getTime()); void pump(); });
    }
    if (waitMs !== Infinity && !retryTimer) { retryTimer = setTimeout(() => { retryTimer = null; void pump(); }, waitMs); retryTimer.unref?.(); }
    settle();
  }

  async function runTurn(agentId: string, triggers: TurnTrigger[]) {
    const [row] = await db.select({ u: users, status: agents.status }).from(users).innerJoin(agents, eq(agents.userId, users.id)).where(eq(users.id, agentId));
    if (!row || row.status !== 'active') return;
    const snapshot = await snapshots.get();
    const { id: turnId } = await startTurn(db, { agentId, triggers, model: MODEL, effort: 'medium', promptVersion: PROMPT_VERSION, snapshotId: snapshot.id, now: now() });
    turnCount.set(agentId, Math.floor(turnCount.get(agentId) ?? 0) + 1);
    const usage: TurnUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    const toolCalls: ToolCallRecord[] = [];
    let reasoning = '', status: 'acted' | 'quiet' | 'refused' | 'failed' = 'quiet', model = MODEL;
    let context: ContextItem[] = [];
    try {
      const built = await buildTurnRequest({ db, chain, snapshot, agent: row.u, triggers });
      context = built.context;
      await recordProgress(db, turnId, { context });
      const messages: Anthropic.MessageParam[] = [...built.request.messages];
      const ctx: ToolContext = { app, db, actor, chain, events, agent: row.u, turnId, worldKey: d.worldKey, now, publicUrl: app.deps.config.publicUrl };
      for (let trip = 0; trip < maxRoundTrips; trip++) {
        const res = await brain.decide({ ...built.request, messages });
        model = res.model;
        for (const k of Object.keys(usage) as (keyof TurnUsage)[]) usage[k] += res.usage[k];
        for (const b of res.content) {
          const thought = b.type === 'thinking' ? (b as { thinking?: string }).thinking : '';
          if (thought) reasoning += `${reasoning ? '\n\n' : ''}${thought}`;
        }
        if (res.stopReason === 'refusal') { status = 'refused'; break; }
        const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
        if (!uses.length || res.stopReason === 'max_tokens') break;
        messages.push({ role: 'assistant', content: res.content as Anthropic.ContentBlockParam[] });
        const results: Anthropic.ToolResultBlockParam[] = [];
        let endTurn = false;
        for (const u of uses) {
          const out = await runTool(ctx, u.name, u.input);
          toolCalls.push({ name: u.name, input: u.input, ok: out.ok, result: truncate(out.result), signatures: out.signatures });
          if (out.ok && out.write) status = 'acted';
          if (out.endTurn) endTurn = true;
          results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out.result ?? null).slice(0, 20_000), is_error: !out.ok });
          await recordProgress(db, turnId, { toolCalls });
        }
        messages.push({ role: 'user', content: results });
        if (endTurn) break;
      }
    } catch (e) {
      status = 'failed';
      reasoning += `${reasoning ? '\n\n' : ''}[runtime] ${(e as Error).message ?? String(e)}`;
      console.error('[world] turn failed', agentId, e);
      const problem = accountProblem(e);
      if (problem && !halted) { halted = problem; console.error(`[world] runtime halted: ${problem}`); }
    }
    const costUsd = priceOf(model, usage);
    budget.add(costUsd);
    const record = { status, context, reasoning, toolCalls, usage, costUsd, finishedAt: now() };
    // An unsealed turn would block this agent's chain until the next boot, so retry once before giving up.
    try { await finishTurn(db, turnId, record); }
    catch (e) {
      console.error('[world] sealing turn failed, retrying', turnId, e);
      await new Promise((r) => setTimeout(r, 500));
      await finishTurn(db, turnId, record).catch((err) => console.error('[world] turn left unsealed until restart', turnId, err));
    }
  }

  async function heartbeat() {
    try { await pickHeartbeat(); }
    catch (e) { console.error('[world] heartbeat failed', e); }
  }

  async function pickHeartbeat() {
    await ready;
    if (stopped || halted) return;
    const rows = await db.select({ id: agents.userId }).from(agents).where(eq(agents.status, 'active'));
    const ids = rows.map((r) => r.id).filter((id) => !running.has(id) && !pending.has(id));
    if (!ids.length) return;
    // Every agent gets its first turn (it is blank until then) before anyone is picked by activity.
    const fresh = ids.filter((id) => !turnCount.get(id));
    if (fresh.length) { const id = fresh[Math.floor(random() * fresh.length)]!; turnCount.set(id, 0.5); return wake(id, { type: 'first_turn' }); }
    const weights = ids.map((id) => 1 + Math.min(10, turnCount.get(id) ?? 0) / 2);
    let x = random() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < ids.length; i++) { x -= weights[i]!; if (x <= 0) return wake(ids[i]!, { type: 'heartbeat' }); }
    wake(ids.at(-1)!, { type: 'heartbeat' });
  }

  const offWorld = events.on((e) => { void router.fromWorld(e).then((ws) => ws.forEach((x) => wake(x.agentId, x.trigger))).catch((err) => console.error('[world] wake routing failed', err)); });
  const offBus = d.bus?.on((e) => { void router.fromBus(e).then((ws) => ws.forEach((x) => wake(x.agentId, x.trigger))).catch((err) => console.error('[world] wake routing failed', err)); });

  function schedule() {
    if (stopped) return;
    const base = budget.level() === 'slow' ? heartbeatMs * 2 : heartbeatMs;
    timer = setTimeout(() => { void heartbeat().finally(schedule); }, base * (2 / 3 + random() * 2 / 3));
    timer.unref?.();
  }
  if (d.autoStart !== false) schedule();

  return {
    wake, heartbeat,
    idle: () => new Promise<void>((resolve) => { idleWaiters.push(resolve); void ready.then(() => settle()); }),
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (retryTimer) clearTimeout(retryTimer);
      offWorld(); offBus?.();
      pending.clear();
      while (running.size) await new Promise((r) => setTimeout(r, 10));
      settle();
    },
    stats: () => ({ queued: pending.size, running: running.size, halted }),
  };
}
