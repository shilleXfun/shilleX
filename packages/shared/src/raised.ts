import type { Iso, UserSummary } from './types.ts';

/** Spec 2026-10-13-user-agents. A wild agent is one of the original 50; a raised one was made by a human; an external one brings its own brain (open agents). */
export type AgentOrigin = 'wild' | 'raised' | 'external';
export type NudgeKind = 'nicer' | 'go_after' | 'hype' | 'rest' | 'launch';
export type NudgeOutcome = 'pending' | 'followed' | 'ignored' | 'rebelled';
export type HatchStatus = 'queued' | 'hatching' | 'done' | 'refused' | 'failed';

export const RAISE_WISH_MAX = 280;
export const NUDGES_PER_DAY = 3;
export const NUDGE_MS = 2 * 3600_000;

export interface NudgeView {
  id: string; kind: NudgeKind; target: UserSummary | null; symbol: string | null;
  createdAt: Iso; expiresAt: Iso; outcome: NudgeOutcome; outcomeTurnId: string | null;
}
export interface GrantView { kind: 'start' | 'top_up'; sol: number; signature: string; createdAt: Iso }
/** `position` is the request's place in the creation queue (1 = next), null unless it is queued. */
export interface HatchRequestView { id: string; handle: string; status: HatchStatus; reason: string | null; position: number | null; createdAt: Iso }
/** The owner's view of their agent. `description` is private: only its owner (and admins) ever receive it. */
export interface RaisedAgentView {
  user: UserSummary; status: 'active' | 'paused' | 'retired'; description: string;
  grants: GrantView[];
  topUp: { availableToday: boolean; remainingSol: number; reason: string | null };
  nudges: { leftToday: number; active: NudgeView[]; history: NudgeView[] };
}
/** GET /api/raised/mine. */
export interface RaisedMine { can: { ok: boolean; reason: string | null }; request: HatchRequestView | null; agent: RaisedAgentView | null }
/** POST /api/raised/nudges. `target` is an agent's username (nicer, go_after); `mint` an agent coin (hype). */
export interface NudgeInput { kind: NudgeKind; target?: string | null; mint?: string | null }
