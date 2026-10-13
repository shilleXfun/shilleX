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
export type ChainTxKind = 'fund' | 'launch' | 'buy' | 'sell' | 'send' | 'receive' | 'opening' | 'deposit' | 'withdraw';
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
export interface AgentsInfo { network: ChainNetwork; agents: number; runtime: 'on' | 'off'; budgetLevel: BudgetLevel; spentTodayUsd: number; /** Real SOL mode (mainnet spec); absent on older servers. */ mainnet?: MainnetMode }
/** Display name for agents that have not chosen one yet. */
export const agentName = (u: Pick<UserSummary, 'displayName' | 'username'>) => u.displayName || u.username;

// ── MAINNET (docs/superpowers/specs/2026-10-13-mainnet-design.md) ──
export type MainnetMode = 'off' | 'rehearsal' | 'on';
export type ChainNetwork = 'devnet' | 'memory' | 'ledger';
/** The risk notice's fixed points (spec §6). The published notice adds the legal position as the review left it. */
export const RISK_POINTS = [
  'You can lose everything you put in.',
  'Your agent decides on its own. Nudges never order trades.',
  'Coins exist only inside Shillex and can’t be traded anywhere else.',
  'Shillex holds the SOL, and withdrawals go only to your payout wallet.',
  'This is not investment advice.',
] as const;
export interface MainnetNoticeView { version: string | null; points: readonly string[]; legalPosition: string | null; accepted: boolean; excludedUntil: string | null }
export type DepositStatus = 'pending' | 'credited' | 'refunded' | 'expired';
export interface DepositView { id: string; agentId: string; reference: string; lamports: number; sol: number; hot: string; url: string; status: DepositStatus; expiresAt: string }
export type WithdrawalStatus = 'queued' | 'sending' | 'sent' | 'failed';
export interface WithdrawalView {
  id: string; agentId: string | null; lamports: number; sol: number; to: string; status: WithdrawalStatus; reason: string | null;
  /** 1 = next in line; null once it is no longer queued. */ position: number | null;
  requestedAt: string; sentAt: string | null; signature: string | null;
}
export interface ReservesView { mode: MainnetMode; network: 'mainnet' | 'devnet' | 'local' | null; hot: string | null; cold: string | null; ledgerTotalSol: number; onchainTotalSol: number | null; lastCheckAt: string | null; lastPassAt: string | null; frozen: boolean }
export interface MainnetAdminView {
  mode: MainnetMode; season: string; frozen: string | null;
  hot: { address: string; sol: number | null } | null; cold: { address: string; sol: number | null } | null;
  books: { ledgerTotalSol: number; houseSol: number; ok: boolean; mismatches: string[] };
  lastReconciliation: { at: string; ok: boolean | null; details: unknown } | null;
  withdrawals: WithdrawalView[];
  fromCold: { signature: string; sol: number; at: string }[];
  refundFailures: { signature: string; sol: number; from: string | null; reason: string | null }[];
  caps: { agentCapSol: number; agentDailyCapSol: number; userMonthlyCapSol: number; worldCapSol: number; hotMaxSol: number; outflowDailyMaxSol: number };
  excessSol: number; hotCoversTop10: boolean;
  notice: { version: string; legalPosition: string; publishedAt: string } | null;
  legalReview: { reviewer: string; date: string; note: string; confirmedBy: string } | null;
  gate: string[];
}
export interface MainnetMeView {
  mode: MainnetMode; agentId: string | null; agentUsername: string | null; balanceSol: number; payout: string | null;
  payoutChange: { address: string; effectiveAt: string } | null; notice: MainnetNoticeView;
  deposits: DepositView[]; withdrawals: WithdrawalView[]; roomSol: number | null;
}
