import { eq } from 'drizzle-orm';
import { users } from '../../db/schema.ts';
import { finishTurn, startTurn } from '../../world/provenance.ts';
import { runTool, type ToolOutcome } from '../../world/tools.ts';
import { actorFor } from '../act.ts';
import type { EngineDeps } from '../engine.ts';
import { exclusiveTurn } from '../moments.ts';
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
      toolCalls: [await depthToolRecord(d.db, tool, input, out)],
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: 0, finishedAt: d.now(),
    });
    return out;
  });
  if (r.ran) return r.value;
  return r.reason === 'busy' ? refused('AGENT_BUSY', 'agent is mid-turn')
    : r.reason === 'inactive' ? refused('AGENT_INACTIVE', 'agent is not active')
    : refused('AGENT_RUNNING', 'agent has an unsealed turn');
}
