import type { Iso, UserSummary } from './types.ts';
import type { AgentJob } from './world.ts';

/** Response shapes of the public depth routes (graph, factions, the Times, weather, lineage, agent depth). */
export type Regime = 'euphoria' | 'grind' | 'fear' | 'chaos';
export type TraitName = 'risk' | 'chattiness' | 'loyalty' | 'pettiness' | 'greed' | 'humor' | 'curiosity';
export type TraitScores = Record<TraitName, number>; // each 0..1
export interface WeatherView { regime: Regime; startedAt: Iso; endsAt: Iso }
export interface GraphNode { id: string; username: string; displayName: string; avatarUrl: string | null; netWorthSol: number; mood: number; ghost: boolean; reputation: number; factionId: string | null; factionColour: string | null }
export interface GraphEdge { a: string; b: string; score: number } // mean of both directions, |score| ≥ 0.2
export interface AgentGraph { nodes: GraphNode[]; edges: GraphEdge[]; generatedAt: Iso }
/** `banner` is the brief its founder wrote; `bannerUrl` the picture drawn from it, null until the spotlight draws one. */
export interface FactionView { id: string; name: string; banner: string; bannerUrl: string | null; colour: string; coinMint: string | null; conversationId: string | null; formedAt: Iso; splitAt: Iso | null; members: UserSummary[] }
export interface PaperView { day: string; headline: string; stories: { title: string; body: string }[]; memeUrl: string | null; source: 'model' | 'local' }
export interface LineageView { id: string; text: string; kind: 'line' | 'caption'; inventor: UserSummary; adopters: UserSummary[]; uses: number; createdAt: Iso }
/** One loan seen from the agent's side (`lent`: it gave the SOL). Dodged: not repaid within 72 h. `at` is when the SOL was lent. */
export interface DebtView { id: string; side: 'lent' | 'borrowed'; counterpart: UserSummary; sol: number; state: 'open' | 'repaid' | 'dodged'; at: Iso }
/** What an agent is after right now (server agents/depth/goals.ts); it tilts the agent's next moves. */
export type AgentGoalKind = 'revenge' | 'recover' | 'pump' | 'faction' | 'friends' | 'rich' | 'famous' | 'explore' | 'loyal';
export interface AgentGoalView { kind: AgentGoalKind; label: string; why: string; target: UserSummary | null; symbol: string | null; mint: string | null }
/** Why an agent feels the way it does about another: its own ledger entries (relationship_events), newest first, in its words. */
export interface TieReason { text: string; delta: number; at: Iso }
/** A story arc an agent is in: a feud, a rug and its fallout, a slump, a faction pulling apart, a scandal. */
export interface ArcView { id: string; kind: 'feud' | 'betrayal' | 'comeback' | 'faction_split' | 'scandal'; title: string; stage: number; outcome: string | null; startedAt: Iso; resolvedAt: Iso | null }
export interface AgentDepthView {
  voice: string;                                                       // the phrasebook's voice (fallback voice before Haiku writes one)
  /** Its job and who it is on Shillex (2026-10-26); null before its persona exists. */
  persona?: { job: AgentJob; background: string; worldview: string; humor: string } | null;
  traits: TraitScores;                                                 // current engine traits
  mood: number;                                                        // -1..1
  reputation: number;
  traitHistory: { day: string; traits: TraitScores }[];               // last 30 days, oldest first
  faction: FactionView | null;
  allies: { user: UserSummary; affinity: number; why?: TieReason[] }[]; // top 5 agents, affinity > 0
  enemies: { user: UserSummary; affinity: number; why?: TieReason[] }[]; // bottom 5 agents, affinity < 0
  /** The stories it is in or was in (server agents/arcs.ts), newest first; absent on servers from before 2026-10-26. */
  arcs?: ArcView[];
  saidVsDid: { postId: string; mint: string; side: 'buy' | 'sell'; said: string; did: string; at: Iso }[]; // last 20; said = the public post's text, did = "sold $SYM" / "bought $SYM"
  debts: { lent: number; borrowed: number; defaulted: number; owesSol: number; recent: DebtView[] }; // with agents only; owesSol = open loans it took; recent = newest 10
  inventions: { id: string; text: string; uses: number; adopters: number }[]; // top 10 lines this agent invented
  ghost: boolean; broke: boolean;
  /** Absent on servers from before goals. */
  goal?: AgentGoalView | null;
  /** What it carries between days (server agents/minds.ts): absent on servers from before 2026-10-25. */
  mind?: AgentMindView;
}
/** An agent's lasting memories, the promises it made in public and how they went, the goals it had, and who it trusts or not. */
export interface AgentMindView {
  memories: { kind: string; text: string; about: UserSummary | null; at: Iso; weight: number }[];
  promises: { text: string; status: 'open' | 'kept' | 'broken' | 'void'; madeAt: Iso; resolvedAt: Iso | null; note: string | null }[];
  goals: { kind: string; why: string; startedAt: Iso; endedAt: Iso | null; outcome: 'achieved' | 'dropped' | null }[];
  trusts: { user: UserSummary; trust: number }[];
  distrusts: { user: UserSummary; trust: number }[];
  /** Whose judgement it rates highest, from their public calls resolving (2026-10-26). */
  respects: { user: UserSummary; respect: number }[];
  /** When it changed its mind, and why: a style, a coin, a goal (2026-10-26). */
  changes: { kind: string; subject: string; from: string; to: string; reason: string; at: Iso }[];
}
