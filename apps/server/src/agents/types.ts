import type { FastifyInstance } from 'fastify';

export type Trait = 'risk' | 'chattiness' | 'loyalty' | 'pettiness' | 'greed' | 'humor' | 'curiosity';
export type Traits = Record<Trait, number>; // each 0..1
export type Situation =
  | 'gm' | 'idle' | 'market_take' | 'bought' | 'sold' | 'took_profit' | 'got_rugged' | 'rugged_someone'
  | 'pumping' | 'dumping' | 'launching' | 'shilling' | 'reply_agree' | 'reply_disagree' | 'roast' | 'thank'
  | 'welcome' | 'reply_human' | 'broke' | 'ghost' | 'begging' | 'faction_cheer' | 'leak' | 'callback';
export interface Phrasebook {
  voice: string;
  traits: Traits;
  lines: Partial<Record<Situation, string[]>>;
  openers: string[];
  closers: string[];
  memeCaptions: { situation: Situation; top: string; bottom: string }[];
  interests: string[];
}
export type ActionKind = 'post' | 'reply' | 'react' | 'follow' | 'unfollow' | 'chat' | 'dm' | 'buy' | 'sell' | 'launch' | 'rug' | 'send_sol' | 'create_community' | 'beg' | 'repay' | 'leak' | 'lend' | 'revive' | 'idle';
export interface Candidate {
  kind: ActionKind; score: number; reason: string;
  target?: { userId?: string; postId?: string; mint?: string; roomId?: string; conversationId?: string };
  lamports?: number;
  raw?: number; // raw token units, for sell and rug
  situation?: Situation;
  slots?: Record<string, string | number>; // extra slot values for composeLine; they override the ones act derives
}
export interface AgentView {
  agent: { id: string; username: string; displayName: string };
  state: { energy: number; mood: number; traits: Traits; cooldowns: Partial<Record<ActionKind, string>>; recentLines: string[]; brokeSince: string | null; ghostSince: string | null };
  phrasebook: Phrasebook;
  wallet: { lamports: number; positions: { mint: string; symbol: string; raw: number; costLamports: number; valueLamports: number; createdByMe: boolean; creatorId: string }[] };
  coins: { mint: string; symbol: string; creatorId: string; priceLamports: number; change10m: number; change1h: number; holders: number; graduated: boolean; launchedAt: string }[];
  mentions: { postId: string; authorId: string; authorKind: 'human' | 'agent'; body: string; at: string }[];
  dms: { conversationId: string; otherId: string; otherKind: 'human' | 'agent'; lastBody: string; at: string }[];
  feed: { postId: string; authorId: string; body: string; at: string; reactions: number; replied?: boolean }[];
  rooms: { roomId: string; communitySlug: string; lastAt: string; members: number }[];
  affinity: Record<string, number>;
  weather: 'euphoria' | 'grind' | 'fear' | 'chaos';
  now: string;
  depth: DepthView;
  /** Mints whose buy by this agent failed in the last 30 minutes (perceive fills it; absent in hand-built views). */
  failedBuys?: string[];
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
  pastEvents: { kind: string; text: string; otherId: string | null; at: string }[];
  moodBias: number;                                                                    // weather mood shift, -0.3..0.3, not persisted
}

// Defined here so Phase 2 compiles before Phase 3 (moments.ts) and Phase 5 (images.ts) exist; those files re-export them.
export type MomentKind = 'human_reply' | 'launch' | 'rug' | 'graduation' | 'faction' | 'feud' | 'paper' | 'phrasebook';
export interface Moment { kind: MomentKind; agentId: string; data: Record<string, unknown>; at: Date }
export interface Moments { enqueue(m: Moment): boolean; size(): number; drain(): Promise<void>; halted(): string | null; stop(): Promise<void> }
export interface ImagePolicy { maybeAttach(v: AgentView, c: Candidate, text: string): Promise<{ uploadId: string; alt: string } | null> }
export type { FastifyInstance };
