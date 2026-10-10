import type { CallStatus, NotificationType, ReactionEmoji } from './constants.ts';

export type Iso = string;
export type CommunityVisibility = 'public' | 'private' | 'invite';
export type MemberRole = 'owner' | 'mod' | 'member';
export type MemberStatus = 'active' | 'pending' | 'banned';

export interface ApiErrorBody { code: string; message: string; details?: unknown }
export interface Page<T> { items: T[]; nextCursor: string | null; tokens?: Record<string, TokenView> }

export interface UserSummary {
  id: string; username: string; displayName: string; avatarUrl: string; isDemo: boolean;
}
export interface UserProfile extends UserSummary {
  bannerUrl: string | null; bio: string; links: { label: string; url: string }[]; createdAt: Iso;
  followers: number; following: number;
  isSelf: boolean; isFollowing: boolean; followsYou: boolean; isMuted: boolean; isBlocked: boolean;
  wallet: { address: string; showHoldings: boolean; verified: false } | null;
}
export interface MeView extends UserSummary { unreadNotifications: number; createdAt: Iso }

/** `userIds` is set for message reactions (broadcast to many viewers; clients derive `mine` from it). */
export interface ReactionSummary { emoji: ReactionEmoji; count: number; mine: boolean; userIds?: string[] }
export interface MediaView { url: string; width: number; height: number; alt: string }
export interface CallUpdateView { id: string; status: CallStatus; note: string | null; selfReported: true; createdAt: Iso }
export interface CommunityRef { id: string; slug: string; name: string; visibility: CommunityVisibility }

export interface PostView {
  id: string;
  kind: 'post' | 'reply' | 'repost' | 'quote';
  author: UserSummary;
  body: string;
  createdAt: Iso;
  deleted: boolean;
  parentId: string | null;
  rootId: string | null;
  replyTo: { id: string; author: UserSummary } | null;
  community: CommunityRef | null;
  media: MediaView[];
  quoted: PostView | null;      // one level deep; quoted.quoted is always null
  reposted: PostView | null;    // for kind 'repost'
  counts: { replies: number; reposts: number; quotes: number };
  reactions: ReactionSummary[];
  viewer: { bookmarked: boolean; reposted: boolean; subscribed: boolean; canAddCallUpdate: boolean };
  mints: string[];
  callUpdates: CallUpdateView[];
}
export interface ThreadView { post: PostView; ancestors: PostView[]; replies: PostView[]; tokens: Record<string, TokenView> }

export type TokenStatus = 'pending' | 'resolved' | 'unindexed' | 'not_a_token' | 'error';
export interface TokenView {
  mint: string;
  status: TokenStatus;
  source: 'demo' | 'live' | null;
  name: string | null;
  symbol: string | null;
  imageUrl: string | null;
  decimals: number | null;
  liquidityUsd: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  pairAddress: string | null;
  dexId: string | null;
  pairCreatedAt: Iso | null;
  promoted: boolean;
  fetchedAt: Iso | null;
  error: string | null;
}
export interface TokenDiscussionStats {
  mentions24h: number; posts24h: number; chat24h: number; subscribed: boolean;
  /** Public mentions per rolling hour over the last 24 h, oldest first; the last entry is the past 60 minutes. */
  hourly: number[];
}
export interface PublicChatMention {
  message: MessageView;
  community: CommunityRef;
  channel: { id: string; name: string };
}

export interface CommunitySummary {
  id: string; slug: string; name: string; description: string; avatarUrl: string;
  visibility: CommunityVisibility; memberCount: number; onlineCount: number;
  myRole: MemberRole | null; myStatus: MemberStatus | null; unread: number; isDemo: boolean;
}
export interface ChannelView {
  id: string; communityId: string; name: string; topic: string; position: number;
  slowModeSeconds: number; holdNewMemberPosts: boolean; unread: number; lastMessageId: string | null;
}
export interface CommunityDetail {
  community: CommunitySummary;
  bannerUrl: string | null; rules: string; createdAt: Iso;
  owner: UserSummary | null; moderators: UserSummary[]; // both hidden (null / []) for non-members of private communities
  canRead: boolean; canPost: boolean; isMod: boolean;
  channels: ChannelView[];
}
export interface MemberView { user: UserSummary; role: MemberRole; status: MemberStatus; online: boolean; joinedAt: Iso }
export interface PinView { id: string; channelId: string | null; post: PostView | null; message: MessageView | null; createdAt: Iso }
export interface InviteView { code: string; url: string; expiresAt: Iso | null; maxUses: number | null; uses: number }

export type ScopeRef = { type: 'channel' | 'conversation'; id: string };
export type Attachment =
  | { type: 'image'; url: string; width: number; height: number; alt: string }
  | { type: 'token'; mint: string };
export interface MessageView {
  id: string;
  scope: ScopeRef;
  author: UserSummary;
  body: string;
  replyTo: { id: string; author: UserSummary; snippet: string; deleted: boolean } | null;
  attachments: Attachment[];
  reactions: ReactionSummary[];
  status: 'visible' | 'held' | 'deleted';
  mints: string[];
  createdAt: Iso;
  nonce: string | null;
}
export interface ConversationView {
  id: string; kind: 'dm' | 'group'; name: string | null; members: UserSummary[];
  lastMessage: MessageView | null; unread: number; muted: boolean; createdAt: Iso;
}

export interface NotificationView {
  id: string; type: NotificationType; actor: UserSummary | null;
  target: { type: 'post' | 'message' | 'user' | 'community' | 'token' | 'report'; id: string };
  text: string; href: string; read: boolean; createdAt: Iso;
  /** One line of the post or message it is about, when the viewer can still read it. */
  excerpt: string | null;
  /** The reaction, for reaction notifications (lets the client group several reactions into one row). */
  emoji: string | null;
}
export interface NotificationPref { type: NotificationType; enabled: boolean }

export interface SettingsView {
  profile: { displayName: string; bio: string; links: { label: string; url: string }[]; avatarUrl: string; bannerUrl: string | null };
  wallet: { address: string; displayWallet: boolean; displayHoldings: boolean; verified: false } | null;
  notificationPrefs: NotificationPref[];
}

export interface LiveRoomView {
  community: CommunityRef & { avatarUrl: string }; channel: { id: string; name: string };
  messagesLast15m: number; onlineCount: number; lastActivityAt: Iso;
}
export interface PersonSuggestion { user: UserSummary; bio: string; followers: number; reason: string }
export interface NewCoinView { token: TokenView; firstMentionAt: Iso; mentions24h: number; promoted: boolean }
export interface DiscoverView {
  liveRooms: LiveRoomView[]; communities: CommunitySummary[]; people: PersonSuggestion[];
  newCoins: NewCoinView[]; promoted: NewCoinView[];
}
export interface SidebarView { liveRooms: LiveRoomView[]; people: PersonSuggestion[]; newCoins: NewCoinView[]; promoted: NewCoinView | null; demoSimulator: boolean }
export interface UploadView { id: string; url: string; width: number; height: number; mime: string }
export interface ReportView {
  id: string; reporter: UserSummary; targetType: 'post' | 'message' | 'user'; targetId: string;
  reason: string; status: 'open' | 'resolved' | 'dismissed'; createdAt: Iso;
  preview: { author: UserSummary | null; body: string } | null;
}
export interface MessageSearchHit { message: MessageView; conversation: { id: string; name: string } }
