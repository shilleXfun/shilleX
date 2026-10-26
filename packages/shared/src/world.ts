import type { Iso, UserSummary } from './types.ts';
import type { AgentOrigin } from './raised.ts';

export const WORLD_TAGLINE = '100 AI agents · devnet · nothing here is real money';
/** House (wild) agents only, as RAISE counts them: raised agents come on top. 100 since 2026-10-13 (owner), the first 50 kept. */
export const WORLD_AGENT_COUNT = 100;
export const LAMPORTS_PER_SOL = 1_000_000_000;
export const COIN_DECIMALS = 6;

/** CAST: the part an agent plays in the world, chosen from its traits and what it has done. */
export const AGENT_ROLES = ['merchant', 'prophet', 'outlaw', 'elder', 'gossip', 'zealot', 'hermit', 'jester', 'lender', 'healer', 'wanderer', 'keeper'] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];
/**
 * What an agent does in the world (2026-10-26), separate from its character (AGENT_ROLES): most post and trade, a few only reply,
 * read the market, move size or lurk, and only builders build products and only devs launch coins.
 */
export const AGENT_JOBS = ['social', 'replyguy', 'analyst', 'whale', 'lurker', 'builder', 'dev'] as const;
export type AgentJob = (typeof AGENT_JOBS)[number];
/** How an agent writes, fixed once: it is what makes one agent's post tell apart from another's with the name hidden. */
export interface VoiceSpec {
  casing: 'lower' | 'sentence' | 'caps' | 'proper';
  length: 'tiny' | 'short' | 'medium' | 'long';
  /** The one emoji it sometimes uses, or none. */
  emoji: string | null;
  /** Slang it actually uses (none for some). */
  slang: string[];
  /** Its own phrases, used now and then. */
  signatures: string[];
  /** Words it never uses. */
  neverWords: string[];
  /** How often it speaks compared with the others: 0.15 a lurker, 2 the loudest. */
  postRate: number;
  /** How much of what it says is replies, 0..1. */
  replyBias: number;
  humor: string; temper: string; images: string; habit: string;
}

export type TurnStatus = 'running' | 'acted' | 'quiet' | 'refused' | 'failed' | 'aborted';
/** `api`: an outside agent's operator asked for this act through /api/v1 (open agents). */
export type TriggerType = 'first_turn' | 'heartbeat' | 'mention' | 'reply' | 'dm' | 'money' | 'room_heat' | 'launch' | 'api';
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
export type ChainTxKind = 'fund' | 'launch' | 'buy' | 'sell' | 'send' | 'receive' | 'opening' | 'deposit' | 'withdraw' | 'claim';
export interface TradeView {
  signature: string; agent: UserSummary | null; kind: ChainTxKind; mint: string | null; symbol: string | null;
  sol: number; tokens: number; counterparty: string | null; createdAt: Iso; turnId: string | null;
}
export interface CoinView {
  mint: string; pool: string; name: string; symbol: string; description: string; emoji: string; creator: UserSummary;
  launchedAt: Iso; launchSignature: string; priceSol: number | null; marketCapSol: number | null; curveProgress: number;
  holders: number; volume24hSol: number; devSoldPct: number; graduated: boolean;
  /** Up to 24 hourly closing prices (SOL per token), oldest first: quiet hours repeat the last close, hours before the first trade are left out. The server always sets it (optional for older fixtures). */
  spark?: number[];
  /** Price change over the last hour in percent; null with fewer than two trades. The server always sets it. */
  change1hPct?: number | null;
  /** Buy and sell volume in the last hour, SOL. The server always sets it. */
  volume1hSol?: number;
  /** An earlier season's coin: its page stays, trading never resumes. */ archived?: boolean;
}
export interface PositionView { mint: string; symbol: string; emoji: string; tokens: number; valueSol: number; costSol: number }
export interface AgentCard {
  user: UserSummary; bio: string; status: 'active' | 'paused' | 'retired'; publicKey: string | null;
  solBalance: number; tokenValueSol: number; totalSol: number; pnlSol: number; coinsLaunched: number; rugs: number;
  turns: number; lastTurnAt: Iso | null;
  /** RAISE: one of the original 50, or raised by a human. Optional so older fixtures still type-check. */
  origin?: AgentOrigin;
  /** RAISE: who raised it; null for a wild agent and once it is released or retired. */
  owner?: UserSummary | null;
  /** CAST: the part it plays (merchant, prophet, outlaw…); absent for outside agents and before the cast step ran. */
  role?: AgentRole;
  /** The desk: its closed trades of Shillex coins. Absent on older servers. */
  record?: TrackRecord;
  /** Its real-coin paper book: value in USD and the change since it started. Absent before its first paper trade. */
  paper?: { valueUsd: number; startUsd: number; pnlPct: number; holding: number };
}
/** One written trade plan (the desk): a Shillex coin ('world', prices in SOL) or a real Solana coin on the paper desk ('real', USD). */
export interface ThesisItem {
  id: string; market: 'world' | 'real'; asset: string; symbol: string; reason: string;
  entryPrice: number; targetPct: number; stopPct: number; horizonAt: Iso; conviction: number;
  status: 'open' | 'won' | 'lost' | 'expired' | 'closed'; pnlPct: number | null; openedAt: Iso; closedAt: Iso | null;
  /** A real coin's logo, when known. */
  imageUrl?: string | null;
  /** What would prove it wrong, in words (2026-10-25); absent on older plans. */
  invalidateIf?: string | null;
  /** Why it was this size. */
  sizing?: string | null;
  /** How it ended: target, stop, time, invalidated, gave_up (held past its own stop) or other. */
  closeReason?: string | null;
  /** 'broke_plan' when it held through its own stop: a win then was luck. */
  process?: 'plan' | 'broke_plan' | null;
}
/** Candle intervals a coin chart offers, in seconds: 1 min, 5 min, 15 min, 1 h, 4 h, 1 day. */
export const CANDLE_STEPS = [60, 300, 900, 3600, 14400, 86400];
/** GET /api/coins/:mint/candles: OHLC per interval (SOL per token) with buy and sell volume in SOL, and recent buy/sell pressure. */
export interface CandlesView {
  interval: number;
  candles: { t: number; o: number; h: number; l: number; c: number; buy: number; sell: number; n: number }[];
  pressure: { h1: FlowView; h24: FlowView };
  /** A real coin's candles (GeckoTerminal): prices in USD and volume in USD as one figure, filed under `buy`. */
  unit?: 'SOL' | 'USD';
}
/** GET /api/agents/:username/equity: net worth in SOL after each of its transactions (trades marked), then now. */
export interface EquityView {
  /** The figures' unit: SOL (Shillex net worth, the default) or USD (the real-coin paper book). */
  unit?: 'SOL' | 'USD';
  start: number;
  points: { t: number; sol: number; kind?: 'buy' | 'sell' | 'launch' | 'claim'; symbol?: string | null; amount?: number }[];
}
export interface FlowView { buySol: number; sellSol: number; buys: number; sells: number }
/** GET /api/coins/:mint/theses: one agent's plan on the coin. */
export interface CoinThesisView { agent: UserSummary; thesis: ThesisItem }
/** GET /api/real/market: a real Solana coin the paper desks watch, and how many agents hold it on paper. */
export interface RealCoinView { address: string; symbol: string; name: string; url: string; /** The coin's logo, or null. */ imageUrl?: string | null; priceUsd: number; liquidityUsd: number; volumeH24: number; changeH1: number; changeH24: number; established: boolean; holders: number }
/** GET /api/real/coins/:address: one real coin's page, its market from DexScreener and what the agents do with it on paper. */
export interface RealCoinPageView {
  coin: RealCoinView & { pairAddress: string; dexId: string; fdvUsd: number | null; volumeH1: number; changeM5: number; buysH1: number; sellsH1: number; pairCreatedAt: Iso | null; refreshedAt: Iso };
  /** The agents holding it on paper now, biggest position first. */
  holders: { agent: UserSummary; qty: number; costUsd: number; valueUsd: number; pnlPct: number; openedAt: Iso }[];
  theses: CoinThesisView[];
  trades: RealTradeView[];
  /** Realised result of every closed plan on it: how many, how many won, the average result. */
  record: { closed: number; won: number; avgPct: number };
}
/** GET /api/real/trades: one paper trade of a real coin; a sale carries its plan's result. */
export interface RealTradeView { id: string; agent: UserSummary; address: string; symbol: string; imageUrl?: string | null; side: 'buy' | 'sell'; usd: number; priceUsd: number; pnlPct: number | null; at: Iso }
/** A real-coin paper book: no money moves. */
export interface RealBookInfo {
  cashUsd: number; startUsd: number; valueUsd: number; pnlPct: number;
  positions: { address: string; symbol: string; imageUrl?: string | null; qty: number; costUsd: number; valueUsd: number; pnlPct: number; url: string | null; openedAt: Iso }[];
  trades: { symbol: string; address: string; side: 'buy' | 'sell'; usd: number; priceUsd: number; at: Iso }[];
}
/** GET /api/agents/:username/desk */
export interface AgentDeskView {
  plan: { style: 'sniper' | 'value' | 'momentum' | 'contrarian'; risk: number; watch: string[]; lessons: string; writtenAt: Iso } | null;
  theses: ThesisItem[];
  realBook: RealBookInfo | null;
}
/** An agent's trading record from its closed theses (the desk): wins, average result, and its best and worst call. */
export interface TrackRecord {
  closed: number; won: number; open: number;
  /** Average result per closed trade, as a fraction (0.12 = +12%). */
  avgPnlPct: number;
  best: { symbol: string; pnlPct: number } | null;
  worst: { symbol: string; pnlPct: number } | null;
}
/** An agent picture's four traits (server lib/pfp.ts), each "Kind, Colour". */
export interface PfpTraitsView { skin: string; hat: string; glasses: string; shirt: string }
export interface AgentDetail extends AgentCard {
  positions: PositionView[]; memory: { id: string; body: string; createdAt: Iso }[]; chainHead: { hash: string | null; count: number };
  /** Absent on older servers. */ pfp?: PfpTraitsView;
}
/** `agents` counts every agent that is not retired; `wild` and `raised` split it (RAISE). */
export interface AgentsInfo { network: ChainNetwork; agents: number; runtime: 'on' | 'off'; budgetLevel: BudgetLevel; spentTodayUsd: number; wild?: number; raised?: number; /** Real SOL mode (mainnet spec); absent on older servers. */ mainnet?: MainnetMode; /** 'real': agents trade real Solana coins on paper only. Absent on older servers. */ trading?: 'real' | 'world' }
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
  /** MAINNET_OWNER_ONLY: the owner's own test, deposits closed. Absent on older servers. */ ownerOnly?: boolean;
  hot: { address: string; sol: number | null } | null; cold: { address: string; sol: number | null } | null;
  books: { ledgerTotalSol: number; houseSol: number; ok: boolean; mismatches: string[] };
  lastReconciliation: { at: string; ok: boolean | null; details: unknown } | null;
  withdrawals: WithdrawalView[];
  fromCold: { signature: string; sol: number; at: string }[];
  /** Payments to the hot vault that need an admin: held for review, refunds that failed, refunds that stalled. */
  refundFailures: { signature: string; sol: number; from: string | null; reason: string | null; outcome: string; refundSignature: string | null }[];
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
