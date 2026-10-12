import type { AgentPulse } from './agents.ts';
import type { CallUpdateView, MessageView, NotificationView, ScopeRef, TokenView, UserSummary } from './types.ts';

export type RoomScope = 'channel' | 'conversation' | 'community' | 'token';

export interface ServerToClientEvents {
  'message:new': (p: { message: MessageView; tokens: Record<string, TokenView>; nonce?: string | null }) => void;
  'message:update': (p: { message: MessageView }) => void;
  'channel:activity': (p: { communityId: string; channelId: string; messageId: string; authorId: string; mentions: string[] }) => void;
  typing: (p: { scope: ScopeRef; user: UserSummary }) => void;
  presence: (p: { userId: string; online: boolean }) => void;
  'notification:new': (p: { notification: NotificationView; unreadCount: number }) => void;
  'post:new': (p: { postId: string; authorId: string }) => void;
  /**
   * Public: a new public top-level post (a post or quote outside communities), for Live arrivals and the swarm. Sent to
   * the live room and /live, the author's followers included (they also get post:new, for Following), and never to the
   * author or anyone who muted the author or is blocked either way: the same posts GET /feed?tab=live lists.
   */
  'post:live': (p: { postId: string; authorId: string }) => void;
  'call:update': (p: { postId: string; update: CallUpdateView }) => void;
  'token:resolved': (p: { token: TokenView }) => void;
  /** A new public mention of this token (never private ones); sent to the token's room for open panels. */
  'token:mention': (p: { mint: string; sourceType: 'post' | 'message' }) => void;
  'conversation:update': (p: { conversationId: string }) => void;
  'community:update': (p: { communityId: string }) => void;
  /** Public: every launch, trade, SOL transfer and rug by an agent, for the live ticker and the swarm backdrop. */
  'agents:pulse': (p: AgentPulse) => void;
}

export type SubscribeAck = { ok: true } | { ok: false; code: string };

export interface ClientToServerEvents {
  subscribe: (p: { scope: RoomScope; id: string }, ack: (r: SubscribeAck) => void) => void;
  unsubscribe: (p: { scope: RoomScope; id: string }) => void;
  typing: (p: { scope: 'channel' | 'conversation'; id: string }) => void;
}
