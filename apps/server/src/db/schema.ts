import { sql } from 'drizzle-orm';
import { pgTable, text, boolean, integer, timestamp, jsonb, doublePrecision, primaryKey, index, uniqueIndex } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash'),
  avatarUrl: text('avatar_url'),
  bannerUrl: text('banner_url'),
  bio: text('bio').notNull().default(''),
  links: jsonb('links').$type<{ label: string; url: string }[]>().notNull().default([]),
  /** Words, $tickers or addresses this user muted; their client collapses matching posts and messages. */
  mutedWords: jsonb('muted_words').$type<string[]>().notNull().default([]),
  createdAt: ts('created_at').notNull(),
  isDemo: boolean('is_demo').notNull().default(false),
}, (t) => [uniqueIndex('users_username_lower_idx').on(sql`lower(${t.username})`)]);

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: ts('expires_at').notNull(),
  createdAt: ts('created_at').notNull(),
});

export const follows = pgTable('follows', {
  followerId: text('follower_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  followeeId: text('followee_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: ts('created_at').notNull(),
}, (t) => [primaryKey({ columns: [t.followerId, t.followeeId] }), index('follows_followee_idx').on(t.followeeId)]);

export const blocks = pgTable('blocks', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  targetId: text('target_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: ts('created_at').notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.targetId] }), index('blocks_target_idx').on(t.targetId)]);

export const mutes = pgTable('mutes', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  targetId: text('target_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: ts('created_at').notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.targetId] })]);

export const walletLinks = pgTable('wallet_links', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  address: text('address').notNull(),
  displayWallet: boolean('display_wallet').notNull().default(false),
  displayHoldings: boolean('display_holdings').notNull().default(false),
  verified: boolean('verified').notNull().default(false),
});

export const uploads = pgTable('uploads', {
  id: text('id').primaryKey(),
  uploaderId: text('uploader_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  mime: text('mime').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  createdAt: ts('created_at').notNull(),
});

// Spec §3 lists a post_media table; media is stored as jsonb on posts instead (same data, fewer joins).
export const posts = pgTable('posts', {
  id: text('id').primaryKey(),
  authorId: text('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<'post' | 'reply' | 'repost' | 'quote'>().notNull(),
  body: text('body').notNull().default(''),
  parentId: text('parent_id'),
  rootId: text('root_id'),
  quoteOfId: text('quote_of_id'),
  repostOfId: text('repost_of_id'),
  communityId: text('community_id'),
  visibility: text('visibility').$type<'public' | 'community'>().notNull(),
  media: jsonb('media').$type<{ url: string; width: number; height: number; alt: string }[]>().notNull().default([]),
  createdAt: ts('created_at').notNull(),
  deletedAt: ts('deleted_at'),
  isDemo: boolean('is_demo').notNull().default(false),
}, (t) => [
  index('posts_author_idx').on(t.authorId, t.id),
  index('posts_parent_idx').on(t.parentId),
  index('posts_root_idx').on(t.rootId),
  index('posts_community_idx').on(t.communityId, t.id),
  index('posts_quote_idx').on(t.quoteOfId),
  index('posts_repost_idx').on(t.repostOfId),
]);

export const reactions = pgTable('reactions', {
  targetType: text('target_type').$type<'post' | 'message'>().notNull(),
  targetId: text('target_id').notNull(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  emoji: text('emoji').notNull(),
  createdAt: ts('created_at').notNull(),
}, (t) => [primaryKey({ columns: [t.targetType, t.targetId, t.userId, t.emoji] }), index('reactions_target_idx').on(t.targetType, t.targetId)]);

export const bookmarks = pgTable('bookmarks', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  postId: text('post_id').notNull(),
  createdAt: ts('created_at').notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.postId] })]);

export const callUpdates = pgTable('call_updates', {
  id: text('id').primaryKey(),
  postId: text('post_id').notNull(),
  authorId: text('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: text('status').notNull(),
  note: text('note'),
  selfReported: boolean('self_reported').notNull().default(true),
  createdAt: ts('created_at').notNull(),
}, (t) => [index('call_updates_post_idx').on(t.postId)]);

export const communities = pgTable('communities', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  avatarUrl: text('avatar_url'),
  bannerUrl: text('banner_url'),
  visibility: text('visibility').$type<'public' | 'private' | 'invite'>().notNull(),
  ownerId: text('owner_id').notNull().references(() => users.id),
  rules: text('rules').notNull().default(''),
  createdAt: ts('created_at').notNull(),
  isDemo: boolean('is_demo').notNull().default(false),
});

export const communityMembers = pgTable('community_members', {
  communityId: text('community_id').notNull().references(() => communities.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').$type<'owner' | 'mod' | 'member'>().notNull(),
  status: text('status').$type<'active' | 'pending' | 'banned'>().notNull(),
  joinedAt: ts('joined_at').notNull(),
}, (t) => [primaryKey({ columns: [t.communityId, t.userId] }), index('members_user_idx').on(t.userId)]);

export const invites = pgTable('invites', {
  code: text('code').primaryKey(),
  communityId: text('community_id').notNull().references(() => communities.id, { onDelete: 'cascade' }),
  createdBy: text('created_by').notNull().references(() => users.id),
  expiresAt: ts('expires_at'),
  maxUses: integer('max_uses'),
  uses: integer('uses').notNull().default(0),
  createdAt: ts('created_at').notNull(),
});

export const channels = pgTable('channels', {
  id: text('id').primaryKey(),
  communityId: text('community_id').notNull().references(() => communities.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  topic: text('topic').notNull().default(''),
  position: integer('position').notNull().default(0),
  slowModeSeconds: integer('slow_mode_seconds').notNull().default(0),
  holdNewMemberPosts: boolean('hold_new_member_posts').notNull().default(false),
}, (t) => [index('channels_community_idx').on(t.communityId)]);

export const pins = pgTable('pins', {
  id: text('id').primaryKey(),
  communityId: text('community_id').notNull().references(() => communities.id, { onDelete: 'cascade' }),
  channelId: text('channel_id'),
  targetType: text('target_type').$type<'post' | 'message'>().notNull(),
  targetId: text('target_id').notNull(),
  pinnedBy: text('pinned_by').notNull().references(() => users.id),
  createdAt: ts('created_at').notNull(),
});

export const conversations = pgTable('conversations', {
  id: text('id').primaryKey(),
  kind: text('kind').$type<'dm' | 'group'>().notNull(),
  name: text('name'),
  dmKey: text('dm_key').unique(), // "<smallerUserId>:<largerUserId>" for DMs, null for groups
  createdBy: text('created_by').notNull().references(() => users.id),
  createdAt: ts('created_at').notNull(),
});

export const conversationMembers = pgTable('conversation_members', {
  conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  joinedAt: ts('joined_at').notNull(),
  muted: boolean('muted').notNull().default(false),
}, (t) => [primaryKey({ columns: [t.conversationId, t.userId] }), index('conv_members_user_idx').on(t.userId)]);

export const messages = pgTable('messages', {
  id: text('id').primaryKey(),
  channelId: text('channel_id'),
  conversationId: text('conversation_id'),
  authorId: text('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  body: text('body').notNull().default(''),
  replyToId: text('reply_to_id'),
  attachments: jsonb('attachments').$type<
    ({ type: 'image'; url: string; width: number; height: number; alt: string } | { type: 'token'; mint: string })[]
  >().notNull().default([]),
  status: text('status').$type<'visible' | 'held' | 'deleted'>().notNull().default('visible'),
  createdAt: ts('created_at').notNull(),
  isDemo: boolean('is_demo').notNull().default(false),
}, (t) => [
  index('messages_channel_idx').on(t.channelId, t.id),
  index('messages_conversation_idx').on(t.conversationId, t.id),
  index('messages_author_idx').on(t.authorId, t.createdAt),
]);

export const readMarkers = pgTable('read_markers', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  scopeType: text('scope_type').$type<'channel' | 'conversation'>().notNull(),
  scopeId: text('scope_id').notNull(),
  lastReadMessageId: text('last_read_message_id').notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.scopeType, t.scopeId] })]);

export const tokens = pgTable('tokens', {
  mint: text('mint').primaryKey(),
  source: text('source').$type<'demo' | 'live'>(),
  status: text('status').$type<'resolved' | 'unindexed' | 'not_a_token' | 'error'>().notNull(),
  name: text('name'),
  symbol: text('symbol'),
  imageUrl: text('image_url'),
  decimals: integer('decimals'),
  liquidityUsd: doublePrecision('liquidity_usd'),
  marketCapUsd: doublePrecision('market_cap_usd'),
  fdvUsd: doublePrecision('fdv_usd'),
  pairAddress: text('pair_address'),
  dexId: text('dex_id'),
  pairCreatedAt: ts('pair_created_at'),
  promoted: boolean('promoted').notNull().default(false),
  fetchedAt: ts('fetched_at'),
  metaFetchedAt: ts('meta_fetched_at'),
  error: text('error'),
});

export const tokenMentions = pgTable('token_mentions', {
  id: text('id').primaryKey(),
  mint: text('mint').notNull(),
  sourceType: text('source_type').$type<'post' | 'message'>().notNull(),
  sourceId: text('source_id').notNull(),
  authorId: text('author_id').notNull(),
  communityId: text('community_id'),
  channelId: text('channel_id'),
  isPublic: boolean('is_public').notNull(),
  createdAt: ts('created_at').notNull(),
}, (t) => [
  uniqueIndex('mentions_source_mint_idx').on(t.sourceType, t.sourceId, t.mint),
  index('mentions_mint_public_idx').on(t.mint, t.isPublic, t.createdAt),
  index('mentions_public_created_idx').on(t.isPublic, t.createdAt),
]);

export const subscriptions = pgTable('subscriptions', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  targetType: text('target_type').$type<'post' | 'token'>().notNull(),
  targetId: text('target_id').notNull(),
  createdAt: ts('created_at').notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.targetType, t.targetId] }), index('subs_target_idx').on(t.targetType, t.targetId)]);

export const notifications = pgTable('notifications', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  actorId: text('actor_id'),
  targetType: text('target_type').notNull(),
  targetId: text('target_id').notNull(),
  data: jsonb('data').$type<Record<string, string>>().notNull().default({}),
  readAt: ts('read_at'),
  createdAt: ts('created_at').notNull(),
}, (t) => [index('notifications_user_idx').on(t.userId, t.id)]);

export const notificationPrefs = pgTable('notification_prefs', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  enabled: boolean('enabled').notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.type] })]);

export const reports = pgTable('reports', {
  id: text('id').primaryKey(),
  reporterId: text('reporter_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  targetType: text('target_type').$type<'post' | 'message' | 'user'>().notNull(),
  targetId: text('target_id').notNull(),
  communityId: text('community_id'),
  reason: text('reason').notNull(),
  status: text('status').$type<'open' | 'resolved' | 'dismissed'>().notNull().default('open'),
  resolvedBy: text('resolved_by'),
  createdAt: ts('created_at').notNull(),
}, (t) => [index('reports_community_idx').on(t.communityId, t.status)]);

export type UserRow = typeof users.$inferSelect;
export type PostRow = typeof posts.$inferSelect;
export type CommunityRow = typeof communities.$inferSelect;
export type MemberRow = typeof communityMembers.$inferSelect;
export type ChannelRow = typeof channels.$inferSelect;
export type ConversationRow = typeof conversations.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type TokenRow = typeof tokens.$inferSelect;
