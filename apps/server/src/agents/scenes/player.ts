import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { LAMPORTS_PER_SOL, type SceneMessageEvent, type ToolCallRecord } from '@shillex/shared';
import { posts, sceneMessages, scenes, users, worldCoins, type SceneRow } from '../../db/schema.ts';
import { RAW_PER_TOKEN } from '../../world/chain.ts';
import { finishTurn, startTurn } from '../../world/provenance.ts';
import { runTool, type ToolContext, type ToolOutcome } from '../../world/tools.ts';
import { BUY_MOOD, actorFor } from '../act.ts';
import { COOLDOWN_MS, MIN_TRADE, RESERVE } from '../decide.ts';
import { depthToolRecord } from '../depth/receipt.ts';
import { HAIKU } from '../haiku.ts';
import { exclusiveTurn } from '../moments.ts';
import { LIVE_ROOM } from '../pulse.ts';
import { buyFeelings, sellFeelings } from '../social.ts';
import { adjustAffinity, applyFeelings, loadState, saveState } from '../state.ts';
import type { ActionKind } from '../types.ts';
import { type SceneDeps, walletNow } from './cast.ts';
import { PHRASEBOOK_MODEL, type PlannedMessage } from './types.ts';
import { messageView } from './views.ts';
import { SCENE_PROMPT_VERSION } from './writer.ts';

/** A busy speaker is asked again this soon; after this many failed tries the line is skipped. */
export const RETRY_MS: [number, number] = [3000, 6000];
export const MAX_TRIES = 3;
const MIN_FEE = 10_000;
const ZERO = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

type Turn = { status: 'posted'; postId: string; at: Date } | { status: 'busy' } | { status: 'failed'; error: string };

/** The pause before the next line: longer when there is more to type, never outside SCENE_GAP_MS. */
export function gapFor(next: PlannedMessage | undefined, [lo, hi]: [number, number], rng: () => number): number {
  const typing = Math.min(1, [...(next?.text ?? '')].length / 450);
  return Math.round(lo + (hi - lo) * (0.5 * rng() + 0.5 * typing));
}

/**
 * A scene's action, under the engine's money rules: RESERVE stays in the wallet, a buy is at least MIN_TRADE and within the
 * ledger's trade cap, cooldowns hold, a frozen ledger takes no money action, nobody buys or dumps its own coin (no rugs from a
 * scene). A disallowed action is skipped and noted on the receipt, never forced. Runs inside the speaker's sealed turn.
 */
async function sceneAction(d: SceneDeps, ctx: ToolContext, m: PlannedMessage): Promise<{ record: ToolCallRecord | null; note: string }> {
  const a = m.action!;
  const agentId = m.speakerId, now = d.now();
  const kind: ActionKind = a.type;
  const state = await loadState(d.db, agentId, now);
  const last = state.cooldowns[kind];
  if (last && now.getTime() - Date.parse(last) < COOLDOWN_MS[kind]) return { record: null, note: `${kind} skipped: on cooldown` };
  const money = kind === 'buy' || kind === 'sell';
  if (money && d.chain.limits?.frozen) return { record: null, note: `${kind} skipped: the books are frozen` };
  let name: string, input: Record<string, unknown>;
  let after: ((out: ToolOutcome) => Promise<void>) | null = null;
  if (kind === 'buy') {
    const [coin] = await d.db.select().from(worldCoins).where(eq(worldCoins.mint, a.mint!));
    if (!coin || coin.graduatedAt || coin.archivedAt || coin.creatorId === agentId) return { record: null, note: 'buy skipped: not a coin it can buy' };
    const w = await walletNow(d, agentId);
    const spendable = w.lamports - RESERVE;
    if (spendable < MIN_TRADE) return { record: null, note: 'buy skipped: not enough SOL' };
    const size = Math.floor(spendable * (0.1 + 0.3 * (state.traits.risk ?? 0.5)));
    const lamports = Math.min(spendable, Math.max(MIN_TRADE, size), d.chain.limits?.maxTradeLamports ?? Infinity);
    name = 'buy'; input = { mint: coin.mint, sol: lamports / LAMPORTS_PER_SOL, slippage_pct: 10 };
    after = async () => { state.mood += BUY_MOOD; await applyFeelings(d.db, buyFeelings(agentId, coin.creatorId), now); };
  } else if (kind === 'sell') {
    const w = await walletNow(d, agentId);
    const pos = w.positions.find((p) => p.mint === a.mint);
    if (!pos || pos.createdByMe) return { record: null, note: 'sell skipped: nothing it may sell' };
    const free = pos.raw - pos.lockedRaw;
    if (free < RAW_PER_TOKEN || w.lamports < MIN_FEE) return { record: null, note: 'sell skipped: nothing free to sell' };
    name = 'sell'; input = pos.lockedRaw ? { mint: pos.mint, tokens: free / RAW_PER_TOKEN, all: false, slippage_pct: 10 } : { mint: pos.mint, tokens: null, all: true, slippage_pct: 10 };
    const pnl = pos.costLamports > 0 ? pos.valueLamports / pos.costLamports - 1 : 0;
    after = async () => { await applyFeelings(d.db, sellFeelings(agentId, pos.creatorId, pnl), now); };
  } else {
    const [t] = a.targetId ? await d.db.select({ username: users.username, kind: users.kind }).from(users).where(eq(users.id, a.targetId)) : [];
    if (!t || t.kind !== 'agent' || a.targetId === agentId) return { record: null, note: `${kind} skipped: no such agent` };
    name = 'follow'; input = { username: t.username, follow: kind === 'follow' };
  }
  const out = await runTool(ctx, name, input);
  const { record } = await depthToolRecord(d.db, name, input, out);
  if (out.ok) {
    state.cooldowns = { ...state.cooldowns, [kind]: now.toISOString() };
    await after?.(out);
    await saveState(d.db, agentId, state, d.now());
  }
  return { record, note: out.ok ? '' : `${kind} failed` };
}

/** One line, posted as its speaker in a sealed turn of its own (with the line's action, if any), like systemAct. */
async function speak(d: SceneDeps, scene: SceneRow, m: PlannedMessage, parentId: string | null): Promise<Turn> {
  const reason = `scene ${scene.id}: ${scene.premise.why}`.slice(0, 600);
  const phrasebook = scene.model === PHRASEBOOK_MODEL;
  const r = await exclusiveTurn(d, m.speakerId, async (): Promise<Turn> => {
    const [agent] = await d.db.select().from(users).where(eq(users.id, m.speakerId));
    if (!agent) return { status: 'failed', error: 'no such agent' };
    const { id: turnId } = await startTurn(d.db, { agentId: m.speakerId, triggers: [{ type: 'heartbeat', note: `scene ${scene.id}` }], model: phrasebook ? 'engine' : HAIKU, effort: phrasebook ? 'none' : 'low', promptVersion: SCENE_PROMPT_VERSION, snapshotId: null, now: d.now() });
    const toolCalls: ToolCallRecord[] = [];
    let status: 'acted' | 'failed' = 'failed', note = '', result: Turn = { status: 'failed', error: 'not run' };
    try {
      const ctx: ToolContext = { app: d.app, db: d.db, actor: actorFor(d.app), chain: d.chain, events: d.events, agent, turnId, worldKey: d.worldKey, now: d.now, publicUrl: d.app.deps.config.publicUrl };
      const name = parentId ? 'reply' : 'post';
      const input = parentId ? { post_id: parentId, body: m.text } : { body: m.text };
      const out = await runTool(ctx, name, input);
      toolCalls.push((await depthToolRecord(d.db, name, input, out)).record);
      if (!out.ok) {
        const error = String((out.result as { error?: string })?.error ?? 'post failed');
        note = `failed: ${error}`;
        result = { status: 'failed', error };
      } else {
        status = 'acted';
        result = { status: 'posted', postId: (out.result as { post_id: string }).post_id, at: d.now() };
        if (m.action) {
          const a = await sceneAction(d, ctx, m).catch((e: unknown) => ({ record: null, note: `${m.action!.type} failed: ${(e as Error)?.message ?? String(e)}` }));
          if (a.record) toolCalls.push(a.record);
          if (a.note) note = a.note;
        }
      }
    } catch (e) {
      note = `failed: ${(e as Error)?.message ?? String(e)}`;
      if (result.status !== 'posted') result = { status: 'failed', error: note };
    } finally {
      // A receipt is always sealed, so the speaker's hash chain is never left blocked. The scene's model cost is on its
      // world_model_calls row; each line's receipt costs nothing.
      const record = { status, context: [{ kind: 'scene', ref: scene.id, text: scene.title }], reasoning: note ? `${reason}; ${note}` : reason, toolCalls, usage: ZERO, costUsd: 0, finishedAt: d.now() };
      await finishTurn(d.db, turnId, record).catch(async (e) => {
        console.error('[scenes] sealing a scene turn failed, retrying', turnId, e);
        await finishTurn(d.db, turnId, record).catch((err) => console.error('[scenes] scene turn left unsealed until restart', turnId, err));
      });
    }
    return result;
  });
  if (r.ran) return r.value;
  return r.reason === 'busy' ? { status: 'busy' } : { status: 'failed', error: `agent ${r.reason}` };
}

/** Where a line goes: under the line it answers (or the nearest one posted before it), or for the first line under its anchor post, or on its own. */
async function parentFor(d: SceneDeps, scene: SceneRow, m: PlannedMessage): Promise<string | null> {
  const done = await d.db.select({ idx: sceneMessages.idx, postId: sceneMessages.postId }).from(sceneMessages).where(eq(sceneMessages.sceneId, scene.id)).orderBy(asc(sceneMessages.idx));
  if (!done.length) {
    const a = scene.premise.anchorPostId;
    if (!a) return null;
    const [p] = await d.db.select({ authorId: posts.authorId, deletedAt: posts.deletedAt }).from(posts).where(eq(posts.id, a));
    return p && !p.deletedAt && p.authorId !== m.speakerId ? a : null;
  }
  const want = m.replyTo ?? Infinity;
  return [...done].reverse().find((x) => x.idx <= want)?.postId ?? done.at(-1)!.postId;
}

export interface Player { step(): Promise<void>; resume(): Promise<void>; onEnd(fn: (sceneId: string) => void): void }

/**
 * Posts running scenes over time: one due line per step, as its speaker, threaded to the line it answers; a busy speaker is
 * asked again a few seconds later and the line skipped after three failed tries. Each posted line goes to the public live
 * room as `scene:message`. When the last line is handled the scene's feelings apply and it ends. State lives in the scenes
 * row (posted, next_at), so a restart resumes where it stopped.
 */
export function createPlayer(d: SceneDeps): Player {
  const tries = new Map<string, number>();
  const ends: ((sceneId: string) => void)[] = [];
  const at = (ms: number) => new Date(d.now().getTime() + ms);

  async function finish(scene: SceneRow) {
    const now = d.now();
    const spoke = new Set((await d.db.select({ a: sceneMessages.authorId }).from(sceneMessages).where(eq(sceneMessages.sceneId, scene.id))).map((r) => r.a));
    // Feelings move only between agents who actually spoke; each step is already bounded to ±0.2 and adjustAffinity clamps to ±1.
    for (const f of scene.affinity) if (spoke.has(f.fromId) && spoke.has(f.toId)) await adjustAffinity(d.db, f.fromId, f.toId, f.delta, now);
    await d.db.update(scenes).set({ endedAt: now, nextAt: null }).where(eq(scenes.id, scene.id));
    for (const fn of ends) { try { fn(scene.id); } catch (e) { console.error('[scenes] end hook failed', e); } }
  }

  async function advance(scene: SceneRow) {
    const i = scene.posted;
    const m = scene.planned[i];
    if (!m) { await finish(scene); return; }
    const key = `${scene.id}:${i}`;
    const turn = await speak(d, scene, m, await parentFor(d, scene, m));
    if (turn.status === 'posted') {
      tries.delete(key);
      await d.db.insert(sceneMessages).values({ sceneId: scene.id, idx: i, postId: turn.postId, authorId: m.speakerId, at: turn.at }).onConflictDoNothing();
      await d.db.update(scenes).set({ posted: i + 1, nextAt: at(gapFor(scene.planned[i + 1], d.config.gapMs, d.rng)), rootPostId: sql`coalesce(${scenes.rootPostId}, ${turn.postId})` }).where(eq(scenes.id, scene.id));
      const message = await messageView(d.db, scene.id, i, turn.postId, m.speakerId, m.text, turn.at);
      if (message) {
        const ev: SceneMessageEvent = { sceneId: scene.id, message };
        try { d.app.deps.bus.toRoom(LIVE_ROOM, 'scene:message', ev); } catch (e) { console.error('[scenes] live event failed', e); }
      }
      if (i + 1 >= scene.planned.length) await finish({ ...scene, posted: i + 1 });
      return;
    }
    const n = (tries.get(key) ?? 0) + 1;
    if (n < MAX_TRIES) {
      tries.set(key, n);
      await d.db.update(scenes).set({ nextAt: at(RETRY_MS[0] + d.rng() * (RETRY_MS[1] - RETRY_MS[0])) }).where(eq(scenes.id, scene.id));
      return;
    }
    // Three strikes: the line is skipped, and later replies thread past it.
    tries.delete(key);
    const planned = scene.planned.map((x, j) => (j === i ? { ...x, skipped: true } : x));
    await d.db.update(scenes).set({ planned, posted: i + 1, nextAt: at(2000) }).where(eq(scenes.id, scene.id));
    if (i + 1 >= scene.planned.length) await finish({ ...scene, planned, posted: i + 1 });
  }

  return {
    async step() {
      const now = d.now();
      const due = await d.db.select().from(scenes).where(and(isNull(scenes.endedAt), sql`${scenes.nextAt} <= ${now.toISOString()}::timestamptz`)).orderBy(asc(scenes.nextAt)).limit(4);
      for (const s of due) {
        try { await advance(s); }
        catch (e) {
          console.error('[scenes] a scene step failed', s.id, e);
          await d.db.update(scenes).set({ nextAt: at(10_000) }).where(eq(scenes.id, s.id)).catch(() => {});
        }
      }
    },
    async resume() {
      // A scene whose lines were never written (the process died mid-write) is closed; the rest pick up where they stopped.
      const open = await d.db.select().from(scenes).where(isNull(scenes.endedAt));
      for (const s of open) {
        if (!s.planned.length) await d.db.update(scenes).set({ endedAt: d.now(), nextAt: null }).where(eq(scenes.id, s.id));
        else await d.db.update(scenes).set({ nextAt: at(2000 + d.rng() * 4000) }).where(eq(scenes.id, s.id));
      }
      if (open.length) console.log(`[scenes] resumed ${open.filter((s) => s.planned.length).length} running scenes`);
    },
    onEnd(fn) { ends.push(fn); },
  };
}
