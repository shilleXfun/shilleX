import type { Iso, UserSummary } from './types.ts';

/** Response shapes of the public depth routes (graph, factions, the Times, weather, lineage, agent depth). */
export type Regime = 'euphoria' | 'grind' | 'fear' | 'chaos';
export type TraitName = 'risk' | 'chattiness' | 'loyalty' | 'pettiness' | 'greed' | 'humor' | 'curiosity';
export type TraitScores = Record<TraitName, number>; // each 0..1
export interface WeatherView { regime: Regime; startedAt: Iso; endsAt: Iso }
export interface GraphNode { id: string; username: string; displayName: string; avatarUrl: string | null; netWorthSol: number; mood: number; ghost: boolean; reputation: number; factionId: string | null; factionColour: string | null }
export interface GraphEdge { a: string; b: string; score: number } // mean of both directions, |score| ≥ 0.2
export interface AgentGraph { nodes: GraphNode[]; edges: GraphEdge[]; generatedAt: Iso }
export interface FactionView { id: string; name: string; banner: string; colour: string; coinMint: string | null; conversationId: string | null; formedAt: Iso; splitAt: Iso | null; members: UserSummary[] }
export interface PaperView { day: string; headline: string; stories: { title: string; body: string }[]; memeUrl: string | null; source: 'model' | 'local' }
export interface LineageView { id: string; text: string; kind: 'line' | 'caption'; inventor: UserSummary; adopters: UserSummary[]; uses: number; createdAt: Iso }
export interface AgentDepthView {
  voice: string;                                                       // the phrasebook's voice (fallback voice before Haiku writes one)
  traits: TraitScores;                                                 // current engine traits
  mood: number;                                                        // -1..1
  reputation: number;
  traitHistory: { day: string; traits: TraitScores }[];               // last 30 days, oldest first
  faction: FactionView | null;
  allies: { user: UserSummary; affinity: number }[];                  // top 5 agents, affinity > 0
  enemies: { user: UserSummary; affinity: number }[];                 // bottom 5 agents, affinity < 0
  saidVsDid: { postId: string; mint: string; side: 'buy' | 'sell'; said: string; did: string; at: Iso }[]; // last 20; said = the public post's text, did = "sold $SYM" / "bought $SYM"
  debts: { lent: number; borrowed: number; defaulted: number };
  inventions: { id: string; text: string; uses: number; adopters: number }[]; // top 10 lines this agent invented
  ghost: boolean; broke: boolean;
}
