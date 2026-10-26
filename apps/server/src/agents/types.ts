import type { FastifyInstance } from 'fastify';
import type { AgentGoalKind, AgentJob, NudgeKind, VoiceSpec } from '@shillex/shared';
import type { ChainLimits } from '../world/chain.ts';
import type { PostFormat } from '../db/schema.ts';

export type Trait = 'risk' | 'chattiness' | 'loyalty' | 'pettiness' | 'greed' | 'humor' | 'curiosity';
export type Traits = Record<Trait, number>; // each 0..1
export type Situation =
  | 'gm' | 'idle' | 'market_take' | 'bought' | 'sold' | 'took_profit' | 'got_rugged' | 'rugged_someone'
  | 'pumping' | 'dumping' | 'launching' | 'shilling' | 'reply_agree' | 'reply_disagree' | 'roast' | 'thank'
  | 'welcome' | 'reply_human' | 'broke' | 'ghost' | 'begging' | 'faction_cheer' | 'leak' | 'callback' | 'news';
export interface Phrasebook {
  voice: string;
  traits: Traits;
  lines: Partial<Record<Situation, string[]>>;
  openers: string[];
  closers: string[];
  memeCaptions: { situation: Situation; top: string; bottom: string }[];
  interests: string[];
}
export type ActionKind = 'post' | 'reply' | 'react' | 'follow' | 'unfollow' | 'chat' | 'dm' | 'buy' | 'sell' | 'launch' | 'rug' | 'send_sol' | 'create_community' | 'beg' | 'repay' | 'leak' | 'lend' | 'revive' | 'event' | 'idle';
export interface Candidate {
  kind: ActionKind; score: number; reason: string;
  target?: { userId?: string; postId?: string; mint?: string; roomId?: string; conversationId?: string; messageId?: string };
  lamports?: number;
  raw?: number; // raw token units, for sell and rug
  situation?: Situation;
  slots?: Record<string, string | number>; // extra slot values for composeLine; they override the ones act derives
  /** RAISE: the owner's nudge that raised this candidate (agents/raised/nudges.ts); afterAct marks the nudge followed. */
  nudge?: { id: string };
  /** Something that happened to this agent, answered by this move (agents/reactions.ts); voice writes it in this format. */
  reaction?: { id: string; format: PostFormat; event: string; depth: number; arcId: string | null };
  /** An X news action (x-feed §5): a take on a live topic, or sharing an X post as an embed. Handled by the news module. */
  news?: { topicId: string } | { embedId: string };
  /** A happening (depth/happenings.ts): a duel, an AMA, an election, a milestone or a ranking, and which one. */
  event?: { type: string; id?: string };
  /** A buy's plan (decide.ts): the desk opens a thesis with it once the buy lands. */
  thesis?: { targetPct: number; stopPct: number; horizonMs: number; conviction: number; reason: string };
}
export interface AgentView {
  agent: { id: string; username: string; displayName: string };
  state: { energy: number; mood: number; traits: Traits; cooldowns: Partial<Record<ActionKind, string>>; recentLines: string[]; brokeSince: string | null; ghostSince: string | null };
  phrasebook: Phrasebook;
  wallet: { lamports: number; positions: { mint: string; symbol: string; raw: number; costLamports: number; valueLamports: number; createdByMe: boolean; creatorId: string; lockedRaw?: number }[] };
  coins: { mint: string; symbol: string; creatorId: string; priceLamports: number; change10m: number; change1h: number; holders: number; graduated: boolean; launchedAt: string }[];
  mentions: { postId: string; authorId: string; authorKind: 'human' | 'agent'; body: string; at: string }[];
  dms: { conversationId: string; otherId: string; otherKind: 'human' | 'agent'; lastBody: string; at: string; messageId?: string }[];
  feed: { postId: string; authorId: string; body: string; at: string; reactions: number; replied?: boolean; /** false for a human author (perceive always fills it; hand-built views may omit it) */ isAgent?: boolean }[];
  rooms: { roomId: string; communitySlug: string; lastAt: string; members: number }[];
  affinity: Record<string, number>;
  weather: 'euphoria' | 'grind' | 'fear' | 'chaos';
  now: string;
  depth: DepthView;
  /** Mints whose buy by this agent failed in the last 30 minutes (perceive fills it; absent in hand-built views). */
  failedBuys?: string[];
  /** Live news from X (x-feed §5), filled by the news module's perceive; absent when nothing from X is live. */
  news?: NewsView;
  /** What the chain allows (a ledger world, mainnet spec §3); absent on devnet and memory chains and in hand-built views. */
  limits?: ChainLimits | null;
  /** Agents trade only real coins on paper (TRADING_MODE=real): no Shillex coin is bought, sold, launched or rugged. */
  realOnly?: boolean;
  /** Outside agents among this agent's affinities (open agents): Shillex's own agents never send them SOL. Perceive fills it. */
  outsiders?: string[];
}
/** What the Phase 4 depth modules add to an agent's view; each module fills its own part in its perceive hook. */
export interface DepthView {
  reputation: Record<string, number>;                                                  // userId → -1..1
  beliefs: Record<string, { expect: number; trustCreator: number; stance: number | null; stanceAt: string | null }>; // mint →
  faction: { id: string; name: string; conversationId: string | null; coinMint: string | null; memberIds: string[]; rivalMemberIds: string[] } | null;
  leakable: { conversationId: string; targetId: string; lines: { authorId: string; body: string; at: string }[] }[]; // all-agent conversations only
  borrowed: { lineageId: string; text: string; situation: Situation; inventorId: string }[];
  debts: { owedToMe: { id: string; borrowerId: string; lamports: number; createdAt: string }[]; iOwe: { id: string; lenderId: string; lamports: number; createdAt: string }[] };
  begging: { userId: string; ghost: boolean }[];                                       // broke agents I like (affinity >= 0.4)
  pastEvents: { id: string; kind: string; text: string; otherId: string | null; at: string; recalled: number }[];
  agentAllies: string[];                                                               // agents this one likes (affinity >= 0.4), warmest first: the only ones a plea is sent to (L6b)
  callbackEvents: { id: string; kind: string; text: string; otherId: string | null; at: string; recalled: number }[]; // memories a callback may still recall, newest first (L6b)
  moodBias: number;                                                                    // weather mood shift, -0.3..0.3, not persisted
  feudsWith: string[];                                                                 // agents this one started a feud with in the last hour (L5)
  lastCallbackAt: string | null;                                                       // when this agent last posted a callback (L6)
  /** Whom it believes (-1..1) by agent id, trust only (agents/minds.ts); absent before the trust module ran. */
  trust?: Record<string, number>;
  /** What it is after right now (goals module); tilts its moves. */
  goal?: { kind: AgentGoalKind; why: string; targetId: string | null; mint: string | null; symbol: string | null };
  /** The desk (depth/desk.ts): today's trading plan, and the written plan behind each coin it holds, by mint. */
  desk?: { style: DeskStyleName; risk: number; watch: string[] };
  theses?: Record<string, ThesisView>;
  /** Its real-coin paper positions now (the desk): what it holds, how it is doing, and its plan's target and stop. */
  paper?: { symbol: string; pnlPct: number; hoursHeld: number; targetPct: number | null; stopPct: number | null }[];
  /** What happened that it has not answered yet (agents/reactions.ts). */
  reactions?: { id: string; kind: 'post' | 'reply'; format: PostFormat; event: string; postId: string | null; aboutId: string | null; mint: string | null; depth: number; arcId: string | null }[];
  /** Who it is and how it writes (agents/personas.ts); absent until its persona exists. */
  persona?: { job: AgentJob; background: string; worldview: string; humor: string; voice: VoiceSpec };
  /** RAISE: a raised agent's owner and the owner's live nudges (agents/raised/nudges.ts fills it; absent for wild agents). */
  raised?: { ownerId: string | null; nudges: { id: string; kind: NudgeKind; targetUserId: string | null; targetUsername: string | null; mint: string | null; symbol: string | null; rebel: boolean }[] };
}
export type DeskStyleName = 'sniper' | 'value' | 'momentum' | 'contrarian';
/** An open thesis: entry price (lamports per token), take-profit and stop as fractions of it, and when it runs out. */
export interface ThesisView { id: string; entryPrice: number; targetPct: number; stopPct: number; horizonAt: string; openedAt: string; conviction: number }
/** What is live from X for one agent (x-feed §5). `mine`: this agent already posted about the topic; `uses`: how many agents did. */
export interface NewsView {
  topics: { id: string; label: string; words: string[]; heat: number; sentiment: number; postIds: string[]; sourcePostId: string; sourceHandle: string | null; uses: number; mine: boolean }[];
  embeds: { postId: string; handle: string | null; heat: number }[];
  embedsLastHour: number;
  /** Every live topic's words, for themed launches (§5.3). */
  words: string[];
  /** Every live topic's cashtags: no agent coin takes one (§5.3). */
  avoidSymbols: string[];
}

// Defined here so Phase 2 compiles before Phase 3 (moments.ts) and Phase 5 (images.ts) exist; those files re-export them.
export type MomentKind = 'human_reply' | 'hatch' | 'launch' | 'rug' | 'graduation' | 'faction' | 'feud' | 'paper' | 'phrasebook' | 'x_digest' | 'site' | 'desk';
export interface Moment { kind: MomentKind; agentId: string; data: Record<string, unknown>; at: Date }
export interface Moments { enqueue(m: Moment): boolean; size(): number; drain(): Promise<void>; halted(): string | null; stop(): Promise<void> }
/** The trigger note of a model turn that answers a human (moments.ts); depth/receipt.ts blanks such a turn's reasoning when it is served. */
export const HUMAN_PURPOSE = 'reply to a human';
export interface ImagePolicy { maybeAttach(v: AgentView, c: Candidate, text: string): Promise<{ uploadId: string; alt: string } | null> }
export type { FastifyInstance };
