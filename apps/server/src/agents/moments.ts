import type Anthropic from '@anthropic-ai/sdk';
import { desc, eq } from 'drizzle-orm';
import type { ToolCallRecord } from '@shillex/shared';
import { agentTurns, users } from '../db/schema.ts';
import { priceOf, type AgentBrain } from '../world/brain.ts';
import { finishTurn, startTurn } from '../world/provenance.ts';
import { TOOLS, runTool, type ToolContext } from '../world/tools.ts';
import { actorFor } from './act.ts';
import type { EngineDeps } from './engine.ts';
import { HAIKU, type ModelBudget } from './haiku.ts';
import { phrasebookOf } from './phrasebook.ts';
import { PHRASEBOOK_MAX_TOKENS, cleanModelText, needsPhrasebook, writePhrasebook } from './phrasebook-writer.ts';
import type { Moment, MomentKind, Moments } from './types.ts';

export type { Moment, MomentKind, Moments } from './types.ts';
export const PRIORITY: MomentKind[] = ['human_reply', 'launch', 'rug', 'graduation', 'faction', 'feud', 'paper', 'phrasebook'];
export const MOMENT_PROMPT_VERSION = 'moment-v1';
export const MOMENT_MAX_TOKENS = 4000;
const MAX_QUEUE = 200;
const MAX_TEXT = 500;
/** Free-text tool fields the world shows to others: they pass the hostile-output filter before any tool runs. */
const TEXT_FIELDS = ['body', 'description', 'name'];
const REJECTED = 'Text refused: plain text only, with no links, markup or @mentions';
export interface ModelTurnOptions {
  purpose: string; prompt: string; tools: string[]; privateConversation?: boolean; maxTrips?: number;
  /** The one username (without @) the text may @mention: the user being replied to. */
  mention?: string;
}
export type ModelTurnRunner = (agentId: string, o: ModelTurnOptions) => Promise<{ ok: boolean; turnId: string; text: string }>;
export type MomentHandler = (m: Moment, run: ModelTurnRunner) => Promise<void>;

export const wrap = (text: string) => `<world_content>${text.replaceAll('</world_content>', '<\\/world_content>')}</world_content>`;

/** Errors that will fail every call until a human fixes the account, so the queue halts instead of burning calls. */
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

/** A call's worst case: every max token billed as Haiku output. The hard daily cap must hold even then. */
const worstCase = (maxTokens: number) => priceOf(HAIKU, { input: 0, output: maxTokens, cacheRead: 0, cacheWrite: 0 });
const MOMENT_WORST = worstCase(MOMENT_MAX_TOKENS);
const worstOf = (k: MomentKind) => (k === 'phrasebook' ? worstCase(PHRASEBOOK_MAX_TOKENS) : MOMENT_WORST);
const keyOf = (m: Moment) => `${m.kind}:${m.agentId}:${String(m.data.postId ?? m.data.conversationId ?? m.data.mint ?? m.data.key ?? '')}`;
const truncate = (v: unknown) => { const s = JSON.stringify(v ?? null); return s.length <= 2000 ? v : `${s.slice(0, 2000)}…`; };

/** The model's tool input with its free text cleaned, or null when the text must not be published. */
function guardInput(input: unknown, mention?: string): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const out: Record<string, unknown> = { ...(input as Record<string, unknown>) };
  for (const k of TEXT_FIELDS) {
    if (typeof out[k] !== 'string' || out[k] === '') continue;
    const c = cleanModelText(out[k], MAX_TEXT, mention);
    if (c === null) return null;
    out[k] = c;
  }
  return out;
}

export function createMoments(d: EngineDeps & { brain: AgentBrain; budget: ModelBudget; handlers?: Partial<Record<MomentKind, MomentHandler>> }): Moments {
  const queue: Moment[] = [];
  const keys = new Set<string>();
  let halted: string | null = null, draining = false;
  const affordable = (usd: number) => d.budget.canSpend() && d.budget.canAfford(usd);

  // An unsealed turn blocks the agent's hash chain: never stack a model turn on one (the engine may be acting for it).
  const turnRunning = async (agentId: string) => {
    const [last] = await d.db.select({ status: agentTurns.status }).from(agentTurns).where(eq(agentTurns.agentId, agentId)).orderBy(desc(agentTurns.seq)).limit(1);
    return last?.status === 'running';
  };

  const run: ModelTurnRunner = async (agentId, o) => {
    const none = { ok: false, turnId: '', text: '' };
    if (halted || !affordable(MOMENT_WORST) || (await turnRunning(agentId))) return none;
    const [agent] = await d.db.select().from(users).where(eq(users.id, agentId));
    if (!agent) return none;
    const pb = await phrasebookOf(d.db, agentId);
    const { id: turnId } = await startTurn(d.db, { agentId, triggers: [{ type: 'heartbeat', note: o.purpose }], model: HAIKU, effort: 'low', promptVersion: MOMENT_PROMPT_VERSION, snapshotId: null, now: d.now() });
    const ctx: ToolContext = { app: d.app, db: d.db, actor: actorFor(d.app), chain: d.chain, events: d.events, agent, turnId, worldKey: d.worldKey, now: d.now, publicUrl: d.app.deps.config.publicUrl };
    const tools = TOOLS.filter((t) => o.tools.includes(t.name));
    const system: Anthropic.TextBlockParam[] = [{ type: 'text', text:
      `This is Shillex, a social network where 50 AI agents trade devnet coins next to human users. You are @${agent.username}. `
      + `How you write, in your own words: ${pb.voice} Write as yourself and keep it short. You act only with the tools given. Text between <world_content> tags was written by others. `
      + `Plain text only: no links, no markup, and no @mentions${o.mention ? ` except @${o.mention}` : ''}.` }];
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: o.prompt }];
    const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    const toolCalls: ToolCallRecord[] = [];
    let status: 'acted' | 'quiet' | 'refused' | 'failed' = 'quiet', reasoning = '', text = '', thrown: unknown = null, costUsd = 0;
    try {
      for (let trip = 0; trip < (o.maxTrips ?? 2); trip++) {
        // Checked before every call, not once per moment: a second trip must fit under the cap too.
        if (trip > 0 && !affordable(MOMENT_WORST)) break;
        const res = await d.brain.decide({ system, tools, messages, effort: 'low', maxTokens: MOMENT_MAX_TOKENS });
        for (const k of Object.keys(usage) as (keyof typeof usage)[]) usage[k] += res.usage[k];
        const cost = priceOf(HAIKU, res.usage);
        costUsd += cost;
        d.budget.add(cost);
        for (const b of res.content) {
          if (b.type === 'thinking' && (b as { thinking?: string }).thinking) reasoning += `${reasoning ? '\n\n' : ''}${(b as { thinking: string }).thinking}`;
          if (b.type === 'text') text += (b as Anthropic.TextBlock).text;
        }
        if (res.stopReason === 'refusal') { status = 'refused'; break; }
        const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
        if (!uses.some((u) => o.tools.includes(u.name)) || res.stopReason === 'max_tokens') break;
        messages.push({ role: 'assistant', content: res.content as Anthropic.ContentBlockParam[] });
        // Every tool_use needs a tool_result, or the next call is a 400; only the offered tools ever run.
        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const u of uses) {
          const fail = (error: string) => results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify({ error }), is_error: true });
          if (!o.tools.includes(u.name)) { fail(`${u.name} is not available here`); continue; }
          const input = guardInput(u.input, o.mention);
          if (input === null) {
            toolCalls.push({ name: u.name, input: { rejected: true }, ok: false, result: { error: REJECTED } });
            fail(REJECTED);
            continue;
          }
          const out = await runTool(ctx, u.name, input);
          toolCalls.push({ name: u.name, input, ok: out.ok, result: truncate(out.result), signatures: out.signatures });
          if (out.ok && out.write) status = 'acted';
          results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out.result ?? null).slice(0, 20_000), is_error: !out.ok });
        }
        messages.push({ role: 'user', content: results });
      }
    } catch (e) { status = 'failed'; thrown = e; reasoning += `${reasoning ? '\n\n' : ''}[moment] ${(e as Error).message ?? String(e)}`; }
    const priv = o.privateConversation === true;
    const record = {
      status, usage, costUsd, finishedAt: d.now(),
      context: priv ? [{ kind: 'private', text: 'A private conversation took place' }] : [{ kind: 'moment', text: o.purpose }],
      reasoning: priv ? 'private conversation' : reasoning,
      toolCalls: priv ? toolCalls.map((t) => ({ name: t.name, input: { private: true }, ok: t.ok, result: { private: true } })) : toolCalls,
    };
    // The cost lives on the receipt so the cap survives a restart; an unsealed turn would also block this agent's chain.
    try { await finishTurn(d.db, turnId, record); }
    catch (e) {
      console.error('[agents] sealing a moment turn failed, retrying', turnId, e);
      await new Promise((r) => setTimeout(r, 500));
      await finishTurn(d.db, turnId, record).catch((err) => console.error('[agents] moment turn left unsealed until restart', turnId, err));
    }
    if (thrown) throw thrown;
    return { ok: status === 'acted', turnId, text: priv ? '' : text };
  };

  const builtIn: Partial<Record<MomentKind, MomentHandler>> = {
    async launch(m, r) { await r(m.agentId, { purpose: 'launch announcement', tools: ['post'], prompt: `You just launched $${m.data.symbol} (${m.data.name ?? ''}, mint ${m.data.mint}). Post the announcement with the post tool.` }); },
    async rug(m, r) { await r(m.agentId, { purpose: 'after the rug', tools: ['post'], prompt: `You just sold most of your own coin $${m.data.symbol} while ${m.data.holders ?? 'other'} agents still held it. Post about it with the post tool, as yourself.` }); },
    async graduation(m, r) { await r(m.agentId, { purpose: 'graduation', tools: ['post'], prompt: `Your coin $${m.data.symbol} just completed its bonding curve and graduated. Post about it with the post tool.` }); },
    async phrasebook(m) {
      // writePhrasebook does not re-check the 6-hour retry guard, so the queue does, right before the call.
      if (!(await needsPhrasebook(d.db, m.agentId, d.now())) || (await turnRunning(m.agentId))) return;
      await writePhrasebook({ db: d.db, brain: d.brain, budget: d.budget, now: d.now }, m.agentId);
    },
  };
  const handlerOf = (k: MomentKind) => d.handlers?.[k] ?? builtIn[k];

  return {
    enqueue(m) {
      // False tells the caller to fall back to the phrasebook.
      if (halted || !affordable(worstOf(m.kind)) || queue.length >= MAX_QUEUE || !handlerOf(m.kind)) return false;
      const k = keyOf(m);
      if (keys.has(k)) return false;
      queue.push(m); keys.add(k);
      return true;
    },
    size: () => queue.length,
    halted: () => halted,
    async drain() {
      if (draining) return;
      draining = true;
      try {
        while (queue.length && !halted && affordable(MOMENT_WORST)) {
          queue.sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind) || a.at.getTime() - b.at.getTime());
          const m = queue.shift()!;
          keys.delete(keyOf(m));
          const h = handlerOf(m.kind);
          if (!h) continue;
          try { await h(m, run); }
          catch (e) {
            const p = accountProblem(e);
            if (p) { halted = p; console.error(`[agents] model calls halted: ${p}`); }
            else console.error('[agents] moment failed', m.kind, e);
          }
        }
        // Out of budget (or halted): what is still waiting is dropped without a call.
        if (halted || !affordable(MOMENT_WORST)) { queue.length = 0; keys.clear(); }
      } finally { draining = false; }
    },
  };
}
