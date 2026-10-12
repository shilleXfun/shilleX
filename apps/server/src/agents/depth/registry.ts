import type { ToolOutcome } from '../../world/tools.ts';
import type { WorldEvent } from '../../world/events.ts';
import type { AgentView, Candidate, DepthView, Situation } from '../types.ts';
import type { EngineDeps } from '../engine.ts';

export const SWEEP_MS = 5 * 60_000;

/**
 * What an execute hook reports; act() adds the turn id and seals the receipt. `ok: false` with `quiet: true` is a turn that had
 * nothing to say (not a failure, so no mood penalty); `error` then becomes the receipt's note.
 */
export interface ExecResult { ok: boolean; postId?: string; error?: string; quiet?: boolean; text?: string; line?: { key: string; template: string; situation: Situation } }
export type ActDone = ExecResult & { turnId: string };
/** Runs one tool inside the current action's receipt. */
export type RunTool = (name: string, input: Record<string, unknown>) => Promise<ToolOutcome>;

/**
 * One depth system. Every hook is optional. perceive may fill v.depth but must never mutate v.coins or v.rooms
 * (or their objects): those come from a cache shared by every agent — copy first.
 */
export interface DepthModule {
  name: string;
  perceive?(d: EngineDeps, v: AgentView): Promise<void>;
  candidates?(v: AgentView, rng: () => number): Candidate[];
  modify?(v: AgentView, cs: Candidate[]): Candidate[];
  /** Return null when this module does not handle the candidate's kind. */
  execute?(d: EngineDeps, v: AgentView, c: Candidate, tool: RunTool): Promise<ExecResult | null>;
  afterAct?(d: EngineDeps, v: AgentView, c: Candidate, r: ActDone): Promise<void>;
  onEvent?(d: EngineDeps, e: WorldEvent): Promise<void>;
  sweep?(d: EngineDeps): Promise<void>;
}

export function emptyDepth(): DepthView {
  return { reputation: {}, beliefs: {}, faction: null, leakable: [], borrowed: [], debts: { owedToMe: [], iOwe: [] }, begging: [], pastEvents: [], callbackEvents: [], moodBias: 0, feudsWith: [], lastCallbackAt: null };
}

/** Calls every module in order. A failing module is logged and skipped: depth never stops the engine. */
export class DepthRegistry {
  constructor(readonly modules: DepthModule[]) {}
  private warn(m: DepthModule, hook: string, e: unknown) { console.error(`[depth] ${m.name}.${hook} failed`, e); }

  async perceive(d: EngineDeps, v: AgentView) {
    for (const m of this.modules) if (m.perceive) { try { await m.perceive(d, v); } catch (e) { this.warn(m, 'perceive', e); } }
  }
  candidates(v: AgentView, rng: () => number): Candidate[] {
    const out: Candidate[] = [];
    for (const m of this.modules) if (m.candidates) { try { out.push(...m.candidates(v, rng)); } catch (e) { this.warn(m, 'candidates', e); } }
    return out;
  }
  modify(v: AgentView, cs: Candidate[]): Candidate[] {
    let cur = cs;
    for (const m of this.modules) if (m.modify) { try { cur = m.modify(v, cur); } catch (e) { this.warn(m, 'modify', e); } }
    return cur.map((c) => ({ ...c, score: Number.isFinite(c.score) ? Math.max(0, c.score) : 0 }));
  }
  async execute(d: EngineDeps, v: AgentView, c: Candidate, tool: RunTool): Promise<ExecResult | null> {
    for (const m of this.modules) if (m.execute) {
      try { const r = await m.execute(d, v, c, tool); if (r) return r; }
      catch (e) { this.warn(m, 'execute', e); return { ok: false, error: (e as Error)?.message ?? String(e) }; }
    }
    return null;
  }
  async afterAct(d: EngineDeps, v: AgentView, c: Candidate, r: ActDone) {
    for (const m of this.modules) if (m.afterAct) { try { await m.afterAct(d, v, c, r); } catch (e) { this.warn(m, 'afterAct', e); } }
  }
  async onEvent(d: EngineDeps, e: WorldEvent) {
    for (const m of this.modules) if (m.onEvent) { try { await m.onEvent(d, e); } catch (err) { this.warn(m, 'onEvent', err); } }
  }
  async sweep(d: EngineDeps) {
    for (const m of this.modules) if (m.sweep) { try { await m.sweep(d); } catch (e) { this.warn(m, 'sweep', e); } }
  }
}
