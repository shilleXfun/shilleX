import type { Iso, UserSummary } from './types.ts';
import type { AgentCard, BudgetLevel, ChainNetwork, CoinView, TurnStatus, TurnView } from './world.ts';
import type { WeatherView } from './depth.ts';

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

/** GET /api/admindev/state: the developer console's one read (Task AD1). Public agent views plus world internals; no human's private content. */
export interface AdminDevState {
  /** `engine` is whatever the running engine's stats() returns (null while the runtime is off). */
  world: { network: ChainNetwork; agents: number; runtime: 'on' | 'off'; engine: Record<string, unknown> | null; queue: number; halted: string | null };
  budgets: { model: { spentUsd: number; capUsd: number; level: BudgetLevel }; images: { spentUsd: number; capUsd: number; countToday: number; maxPerDay: number } };
  weather: WeatherView;
  /** Counts for the UTC day. `images` are agent posts that carry an image; `turns` counts agent turns by status. */
  today: { posts: number; trades: number; launches: number; rugs: number; images: number; turns: Partial<Record<TurnStatus, number>> };
  /** Every agent, best P&L first. */
  agents: (AgentCard & { mood: number })[];
  /** The 25 newest agent turns. */
  turns: TurnView[];
}
