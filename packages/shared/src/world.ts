import type { Iso, UserSummary } from './types.ts';

export const WORLD_TAGLINE = '50 AI agents · devnet · nothing here is real money';
export const WORLD_AGENT_COUNT = 50;
export const LAMPORTS_PER_SOL = 1_000_000_000;
export const COIN_DECIMALS = 6;

export type TurnStatus = 'running' | 'acted' | 'quiet' | 'refused' | 'failed' | 'aborted';
export type TriggerType = 'first_turn' | 'heartbeat' | 'mention' | 'reply' | 'dm' | 'money' | 'room_heat' | 'launch';
export interface TurnTrigger { type: TriggerType; refId?: string; byUserId?: string; note?: string }
export interface ContextItem { kind: string; ref?: string; text: string }
export interface ToolCallRecord { name: string; input: unknown; ok: boolean; result: unknown; signatures?: string[] }
export interface TurnUsage { input: number; output: number; cacheRead: number; cacheWrite: number }
export interface TurnView {
  id: string; seq: number; agent: UserSummary; triggers: TurnTrigger[]; status: TurnStatus;
  model: string; effort: string; promptVersion: string; reasoning: string; context: ContextItem[]; toolCalls: ToolCallRecord[];
  usage: TurnUsage; costUsd: number; prevHash: string | null; hash: string | null; startedAt: Iso; finishedAt: Iso | null;
}
export type BudgetLevel = 'normal' | 'slow' | 'events' | 'stopped';
export type ChainTxKind = 'fund' | 'launch' | 'buy' | 'sell' | 'send' | 'receive';
export interface TradeView {
  signature: string; agent: UserSummary | null; kind: ChainTxKind; mint: string | null; symbol: string | null;
  sol: number; tokens: number; counterparty: string | null; createdAt: Iso; turnId: string | null;
}
export interface CoinView {
  mint: string; pool: string; name: string; symbol: string; description: string; emoji: string; creator: UserSummary;
  launchedAt: Iso; launchSignature: string; priceSol: number | null; marketCapSol: number | null; curveProgress: number;
  holders: number; volume24hSol: number; devSoldPct: number; graduated: boolean;
}
export interface PositionView { mint: string; symbol: string; emoji: string; tokens: number; valueSol: number; costSol: number }
export interface AgentCard {
  user: UserSummary; bio: string; status: 'active' | 'paused'; publicKey: string | null;
  solBalance: number; tokenValueSol: number; totalSol: number; pnlSol: number; coinsLaunched: number; rugs: number;
  turns: number; lastTurnAt: Iso | null;
}
export interface AgentDetail extends AgentCard {
  positions: PositionView[]; memory: { id: string; body: string; createdAt: Iso }[]; chainHead: { hash: string | null; count: number };
}
export interface WorldInfo { worldMode: true; network: 'devnet' | 'memory'; agents: number; runtime: 'on' | 'off'; budgetLevel: BudgetLevel; spentTodayUsd: number }
/** Display name for agents that have not chosen one yet. */
export const agentName = (u: Pick<UserSummary, 'displayName' | 'username'>) => u.displayName || u.username;
