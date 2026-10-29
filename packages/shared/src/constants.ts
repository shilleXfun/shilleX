export const LIMITS = {
  postMax: 1000,
  messageMax: 2000,
  maxImages: 4,
  uploadBytes: 5 * 1024 * 1024,
  groupMax: 20,
  profileLinksMax: 5,
  newAccountLinkMentionCap: 2,
  messageRateCount: 10,
  messageRateWindowMs: 10_000,
  duplicateWindowMs: 60_000,
  newAccountMs: 24 * 60 * 60 * 1000,
} as const;

export const SLOW_MODE_OPTIONS = [0, 5, 15, 30, 60, 300] as const;
export const REACTIONS = ['🔥', '🚀', '👀', '💀', '😂', '🫡'] as const;
export type ReactionEmoji = (typeof REACTIONS)[number];

export const CALL_STATUSES = ['watching', 'bought', 'taking_profit', 'out', 'thesis_changed'] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];
export const CALL_STATUS_LABELS: Record<CallStatus, string> = {
  watching: 'Watching',
  bought: 'Bought',
  taking_profit: 'Taking profit',
  out: 'Out',
  thesis_changed: 'Thesis changed',
};

export const NOTIFICATION_TYPES = [
  'reply', 'mention', 'follow', 'reaction', 'quote', 'repost', 'dm',
  'call_update', 'token_discussion', 'invite', 'join_request', 'report_resolved', 'agent_moment',
] as const;
/** LOGIN: security notices (a wallet linked or removed). Always delivered and never in the preferences, so a stolen session can't hide them. */
export const SECURITY_NOTIFICATION_TYPES = ['sign_in_change', 'agent_linked', 'sol_withdrawn'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number] | (typeof SECURITY_NOTIFICATION_TYPES)[number];

export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;

export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

/** Accounts younger than this get a "New" badge on their posts and messages (scam CAs often come from fresh accounts). */
export const NEW_ACCOUNT_DAYS = 7;

/** Muted words: how many, and how long each may be. */
export const MUTED_WORDS = { max: 50, maxLength: 40 } as const;

export const COPY = {
  selfReported: 'self-reported',
  callsNote: 'Calls are self-reported: the author says what they are doing with a token. Shillex does not verify trades or holdings.',
  demoTag: 'DEMO',
  promoted: 'Promoted',
  tokenPanelNote: 'Mentions measure discussion, not quality. Do your own research.',
  discoveryNote: 'Listed by recency. Mentions are not an endorsement.',
  demoLinkReason: 'Fictional demo token — not on-chain',
  axiomNoPair: 'Axiom needs a trading pair address; none found yet',
  liveLookupDisabled: 'Live lookup disabled',
} as const;

/**
 * Generated banner art (server lib/svg-art bannerSvg). /media is served with a one-year immutable cache, so bump
 * BANNER_ART_VERSION whenever the art changes or browsers keep the old picture.
 */
export const BANNER_ART_VERSION = 4;
export const generatedBannerUrl = (seed: string) => `/media/banner/${seed}.svg?v=${BANNER_ART_VERSION}`;
