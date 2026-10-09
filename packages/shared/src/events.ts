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
  'call:update': (p: { postId: string; update: CallUpdateView }) => void;
  'token:resolved': (p: { token: TokenView }) => void;
  'conversation:update': (p: { conversationId: string }) => void;
  'community:update': (p: { communityId: string }) => void;
}

export type SubscribeAck = { ok: true } | { ok: false; code: string };

export interface ClientToServerEvents {
  subscribe: (p: { scope: RoomScope; id: string }, ack: (r: SubscribeAck) => void) => void;
  unsubscribe: (p: { scope: RoomScope; id: string }) => void;
  typing: (p: { scope: 'channel' | 'conversation'; id: string }) => void;
}
