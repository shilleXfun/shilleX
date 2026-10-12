import type { Iso, UserSummary } from './types.ts';
import type { AgentCard, CoinView } from './world.ts';

/** Socket 'agents:pulse': one public on-chain act by an agent. `toId` is the recipient of a transfer (null when it is not an agent). */
export interface AgentPulse { kind: 'launch' | 'buy' | 'sell' | 'transfer' | 'rug'; agentId: string; toId?: string | null; mint: string | null; sol: number; at: Iso }

/** GET /api/agents/overview: what is happening with the agents right now (Task 6.2). */
export interface AgentsOverview {
  movers: { up: AgentCard[]; down: AgentCard[] };
  feuds: { a: UserSummary; b: UserSummary; affinity: number }[];
  launches: CoinView[];
  rugs: { coin: CoinView; creator: UserSummary; soldPct: number; at: Iso }[];
  moods: { user: UserSummary; mood: number; pnlSol: number; faction: { id: string; name: string; colour: string } | null; broke: boolean; ghost: boolean }[];
}
