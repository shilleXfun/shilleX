import type Anthropic from '@anthropic-ai/sdk';
import { eq } from 'drizzle-orm';
import type { TurnUsage } from '@shillex/shared';
import { users } from '../../db/schema.ts';
import type { AgentBrain, BrainRequest, BrainResponse } from '../../world/brain.ts';
import { finishTurn, startTurn } from '../../world/provenance.ts';
import { runTool, type ToolOutcome } from '../../world/tools.ts';
import { actorFor } from '../act.ts';
import type { EngineDeps } from '../engine.ts';
import { HAIKU, billedCall, type ModelBudget } from '../haiku.ts';
import { MOMENT_MAX_TOKENS, MOMENT_PROMPT_VERSION, MOMENT_WORST, exclusiveTurn } from '../moments.ts';
import { cleanModelText } from '../phrasebook-writer.ts';
import { depthToolRecord } from './receipt.ts';

const refused = (code: string, error: string): ToolOutcome => ({ ok: false, write: false, result: { code, error } });

/**
 * Runs one tool as an agent outside a chosen action (faction chats, splits), in its own sealed receipt (model 'engine').
 * Goes through exclusiveTurn like every other turn: a busy, paused or mid-turn agent is refused, never given a second turn.
 * Callers pass engine-composed input only; model text must be cleaned before it gets here.
 */
export async function systemAct(d: EngineDeps, agentId: string, tool: string, input: Record<string, unknown>, reason: string): Promise<ToolOutcome> {
  const r = await exclusiveTurn(d, agentId, async (): Promise<ToolOutcome> => {
    const [agent] = await d.db.select().from(users).where(eq(users.id, agentId));
    if (!agent) return refused('NO_AGENT', `No agent ${agentId}`);
    const { id: turnId } = await startTurn(d.db, { agentId, triggers: [{ type: 'heartbeat', note: reason }], model: 'engine', effort: 'none', promptVersion: 'engine-v1', snapshotId: null, now: d.now() });
    let out: ToolOutcome;
    try {
      out = await runTool({ app: d.app, db: d.db, actor: actorFor(d.app), chain: d.chain, events: d.events, agent, turnId, worldKey: d.worldKey, now: d.now, publicUrl: d.app.deps.config.publicUrl }, tool, input);
    } catch (e) {
      out = refused('TOOL_THREW', (e as Error)?.message ?? String(e));
    }
    // A receipt is always sealed, even when the tool failed, so the agent's hash chain is never left blocked.
    await finishTurn(d.db, turnId, {
      status: out.ok ? (out.write ? 'acted' : 'quiet') : 'failed', context: [], reasoning: reason,
      toolCalls: [(await depthToolRecord(d.db, tool, input, out)).record],
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: 0, finishedAt: d.now(),
    });
    return out;
  });
  if (r.ran) return r.value;
  return r.reason === 'busy' ? refused('AGENT_BUSY', 'agent is mid-turn')
    : r.reason === 'inactive' ? refused('AGENT_INACTIVE', 'agent is not active')
    : refused('AGENT_RUNNING', 'agent has an unsealed turn');
}

/** Deps of a Phase 4 handler that makes its own model call (a moment handler: faction naming, the daily paper). */
export type ModelDeps = EngineDeps & { brain: AgentBrain; budget: ModelBudget };
/** What a one-shot call sends; the effort ('low') and the token cap (MOMENT_MAX_TOKENS) are fixed by oneShotTool. */
export type OneShotRequest = Pick<BrainRequest, 'system' | 'tools' | 'messages'>;
/** The default longest string oneShotTool passes back, for a field the caller gave no length. */
export const ONE_SHOT_MAX_TEXT = 500;
/**
 * How oneShotTool cleans the tool input. `fields` maps a property name (at any depth: `body` covers every `stories[].body`)
 * to its longest length in code points; other strings get `maxText` (default ONE_SHOT_MAX_TEXT). `mentions` are the
 * usernames (without @) the text may @mention; every other `@` drops the string.
 */
export interface OneShotClean { fields?: Record<string, number>; maxText?: number; mentions?: readonly string[] }

/** Every string run through cleanModelText: one that must not be published becomes null, so callers fall back field by field. */
function cleanStrings(v: unknown, key: string | undefined, o: OneShotClean): unknown {
  if (typeof v === 'string') return cleanModelText(v, (key !== undefined ? o.fields?.[key] : undefined) ?? o.maxText ?? ONE_SHOT_MAX_TEXT, o.mentions);
  // An array's items inherit its field's length.
  if (Array.isArray(v)) return v.map((x) => cleanStrings(x, key, o));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cleanStrings(x, k, o)]));
  return v;
}

/**
 * One Haiku call offering one structured tool, for an agent, under the daily cap: gated on the call's worst case, capped at
 * MOMENT_MAX_TOKENS, run inside exclusiveTurn (with its sealed receipt, so the cost survives a restart) and billed to the budget.
 * Returns the tool's input with every string cleaned and cut as `clean` says (null where it must not be published), or null when no call could be
 * made (no budget, the agent busy, paused or mid-turn) or the model did not use `toolName`: the caller then uses its local
 * fallback. Never publishes anything itself; call systemAct after it returns (the lock is released by then). A failed call throws.
 */
export async function oneShotTool(d: ModelDeps, agentId: string, purpose: string, req: OneShotRequest, toolName: string, clean: OneShotClean = {}): Promise<Record<string, unknown> | null> {
  const r = await exclusiveTurn(d, agentId, async () => {
    if (!d.budget.canSpend() || !d.budget.canAfford(MOMENT_WORST)) return null;
    // The receipt opens before the call and billedCall books the cost on it, so Budget.load() counts the call after a crash.
    const { id: turnId } = await startTurn(d.db, { agentId, triggers: [{ type: 'heartbeat', note: purpose }], model: HAIKU, effort: 'low', promptVersion: MOMENT_PROMPT_VERSION, snapshotId: null, now: d.now() });
    const spent = { usd: 0 };
    const seal = (status: 'quiet' | 'failed', usage: TurnUsage) =>
      finishTurn(d.db, turnId, { status, context: [{ kind: 'moment', text: purpose }], reasoning: purpose, toolCalls: [], usage, costUsd: spent.usd, finishedAt: d.now() });
    let res: BrainResponse;
    try { res = await billedCall({ db: d.db, budget: d.budget, turnId, worstUsd: MOMENT_WORST, spent }, () => d.brain.decide({ ...req, effort: 'low', maxTokens: MOMENT_MAX_TOKENS })); }
    catch (e) {
      await seal('failed', { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }).catch((err) => console.error('[agents] model receipt left unsealed until restart', turnId, err));
      throw e;
    }
    await seal('quiet', res.usage);
    // A cut-off tool call is not trusted, and a refusal has none.
    if (res.stopReason === 'max_tokens' || res.stopReason === 'refusal') return null;
    const use = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === toolName);
    const input = use ? cleanStrings(use.input, undefined, clean) : null;
    return input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : null;
  });
  return r.ran ? r.value : null;
}
