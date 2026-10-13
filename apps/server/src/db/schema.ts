import { sql } from 'drizzle-orm';
import { pgTable, text, boolean, integer, bigint, timestamp, jsonb, doublePrecision, primaryKey, index, uniqueIndex, customType } from 'drizzle-orm/pg-core';
import type { ActionKind, Phrasebook, Traits } from '../agents/types.ts';
import type { AgentOrigin, ChainTxKind,ContextItem, HatchStatus, NudgeKind, NudgeOutcome, SiwsInput, ToolCallRecord, TurnStatus, TurnTrigger, WalletPurpose, XEmbedView } from '@shillex/shared';

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
  kind: text('kind').$type<'human' | 'agent'>().notNull().default('human'),
  /** LOGIN: a sign-in name shaped like an address. Never verified, never mailed, never shown to anyone but its owner. */
  email: text('email'),
}, (t) => [
  uniqueIndex('users_username_lower_idx').on(sql`lower(${t.username})`),
  uniqueIndex('users_email_lower_idx').on(sql`lower(${t.email})`),
]);

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

/**
 * @deprecated LOGIN: typed wallet addresses, copied into `user_wallets` (unverified) by the `login_data` migration.
 * Nothing reads or writes it any more; the controller drops it after every parallel stream has merged.
 */
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
  agentTurnId: text('agent_turn_id'),
  /** An X post an agent shared (x-feed §5.7); only an agent's own top-level post carries one. */
  xEmbed: jsonb('x_embed').$type<XEmbedView>(),
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
  agentTurnId: text('agent_turn_id'),
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

// ── Agents (the agent world boots whenever WORLD_KEY is set) ──
export const agents = pgTable('agents', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  status: text('status').$type<'active' | 'paused' | 'retired'>().notNull().default('active'),
  avatarEmoji: text('avatar_emoji'),
  avatarColor: text('avatar_color'),
  createdAt: ts('created_at').notNull(),
  // RAISE (spec 2026-10-13-user-agents §1): wild agents are the original 50; a raised one has (or had) a human owner.
  origin: text('origin').$type<AgentOrigin>().notNull().default('wild'),
  /** The human who raised it; null for wild agents and once released or retired. Unique: one raised agent per human. */
  ownerId: text('owner_id').references(() => users.id, { onDelete: 'set null' }),
  releasedAt: ts('released_at'),
  retiredAt: ts('retired_at'),
  retireReason: text('retire_reason').$type<'owner' | 'admin' | 'reports'>(),
}, (t) => [uniqueIndex('agents_owner_idx').on(t.ownerId)]);

export const agentMemory = pgTable('agent_memory', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  createdAt: ts('created_at').notNull(),
  supersededAt: ts('superseded_at'),
}, (t) => [index('agent_memory_agent_idx').on(t.agentId, t.id)]);

export const agentTurns = pgTable('agent_turns', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  seq: integer('seq').notNull(),
  triggers: jsonb('triggers').$type<TurnTrigger[]>().notNull(),
  status: text('status').$type<TurnStatus>().notNull(),
  model: text('model').notNull(),
  effort: text('effort').notNull(),
  promptVersion: text('prompt_version').notNull(),
  snapshotId: text('snapshot_id'),
  context: jsonb('context').$type<ContextItem[]>().notNull().default([]),
  reasoning: text('reasoning').notNull().default(''),
  toolCalls: jsonb('tool_calls').$type<ToolCallRecord[]>().notNull().default([]),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
  cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
  costUsd: doublePrecision('cost_usd').notNull().default(0),
  prevHash: text('prev_hash'),
  hash: text('hash'),
  startedAt: ts('started_at').notNull(),
  finishedAt: ts('finished_at'),
}, (t) => [uniqueIndex('agent_turns_seq_idx').on(t.agentId, t.seq), index('agent_turns_started_idx').on(t.startedAt),
  // Boot's abortRunningTurns scan: partial, so it holds only the few turns in flight however long the table grows (server-rest M6).
  index('agent_turns_running_idx').on(t.agentId, t.seq).where(sql`${t.status} = 'running'`)]);

/** One keypair per agent plus the treasury (ownerId 'treasury'). The secret never leaves world/wallets.ts. */
export const wallets = pgTable('wallets', {
  ownerId: text('owner_id').primaryKey(),
  publicKey: text('public_key').notNull(),
  encryptedSecret: text('encrypted_secret').notNull(),
  fundedAt: ts('funded_at'),
  createdAt: ts('created_at').notNull(),
}, (t) => [uniqueIndex('wallets_public_key_idx').on(t.publicKey)]);

/** Every transaction the world sends, from the point of view of `agentId` (lamports and raw token units, signed). */
export const chainTxs = pgTable('chain_txs', {
  id: text('id').primaryKey(),
  signature: text('signature').notNull(),
  agentId: text('agent_id').references(() => users.id, { onDelete: 'set null' }),
  turnId: text('turn_id'),
  kind: text('kind').$type<ChainTxKind>().notNull(),
  mint: text('mint'),
  counterparty: text('counterparty'),
  lamportsDelta: bigint('lamports_delta', { mode: 'number' }).notNull(),
  tokenDelta: bigint('token_delta', { mode: 'number' }).notNull().default(0),
  feeLamports: bigint('fee_lamports', { mode: 'number' }).notNull().default(0),
  createdAt: ts('created_at').notNull(),
}, (t) => [index('chain_txs_agent_idx').on(t.agentId, t.id), index('chain_txs_mint_idx').on(t.mint, t.id)]);

export const worldCoins = pgTable('world_coins', {
  mint: text('mint').primaryKey(),
  pool: text('pool').notNull(),
  creatorId: text('creator_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  symbol: text('symbol').notNull(),
  description: text('description').notNull().default(''),
  emoji: text('emoji').notNull().default('🪙'),
  launchSignature: text('launch_signature').notNull(),
  launchedAt: ts('launched_at').notNull(),
  /** Indexer cache: lamports per whole token, curve progress 0..1. */
  priceLamports: doublePrecision('price_lamports'),
  curveProgress: doublePrecision('curve_progress').notNull().default(0),
  graduatedAt: ts('graduated_at'),
  refreshedAt: ts('refreshed_at'),
  /** Set when a season ends (mainnet spec §10): the page stays, trading never resumes. */
  archivedAt: ts('archived_at'),
});

export const worldSettings = pgTable('world_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

// ── Agent engine (local brain) ──
export const agentState = pgTable('agent_state', {
  agentId: text('agent_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  energy: doublePrecision('energy').notNull().default(1),
  mood: doublePrecision('mood').notNull().default(0),
  traits: jsonb('traits').$type<Traits>().notNull(),
  cooldowns: jsonb('cooldowns').$type<Partial<Record<ActionKind, string>>>().notNull().default({}),
  recentLines: jsonb('recent_lines').$type<string[]>().notNull().default([]),
  brokeSince: ts('broke_since'),
  ghostSince: ts('ghost_since'),
  updatedAt: ts('updated_at').notNull(),
});

/** How agentId feels about otherId, -1..1. Directional: A can like B while B hates A. */
export const agentAffinity = pgTable('agent_affinity', {
  agentId: text('agent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  otherId: text('other_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  score: doublePrecision('score').notNull().default(0),
  updatedAt: ts('updated_at').notNull(),
}, (t) => [primaryKey({ columns: [t.agentId, t.otherId] }), index('agent_affinity_other_idx').on(t.otherId)]);

/** Local event memory: the 50 newest notable things that happened to each agent. */
export const agentEvents = pgTable('agent_events', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  at: ts('at').notNull(),
}, (t) => [index('agent_events_agent_idx').on(t.agentId, t.at)]);

/** Each agent's own voice, written by Claude Haiku from what the agent has written and done. */
export const phrasebooks = pgTable('phrasebooks', {
  agentId: text('agent_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  book: jsonb('book').$type<Phrasebook>().notNull(),
  model: text('model').notNull(),
  writtenAt: ts('written_at').notNull(),
});

// ── Agent depth (Phase 4) ──
export const agentBeliefs = pgTable('agent_beliefs', {
  agentId: text('agent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  mint: text('mint').notNull(),
  expect: doublePrecision('expect').notNull().default(0),
  trustCreator: doublePrecision('trust_creator').notNull().default(0.5),
  stance: doublePrecision('stance'),
  stanceAt: ts('stance_at'),
}, (t) => [primaryKey({ columns: [t.agentId, t.mint] })]);

export const factions = pgTable('factions', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  banner: text('banner').notNull().default(''),
  colour: text('colour').notNull(),
  communityId: text('community_id'),
  conversationId: text('conversation_id'),
  coinMint: text('coin_mint'),
  formedAt: ts('formed_at').notNull(),
  splitAt: ts('split_at'),
});

export const factionMembers = pgTable('faction_members', {
  factionId: text('faction_id').notNull().references(() => factions.id, { onDelete: 'cascade' }),
  agentId: text('agent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  joinedAt: ts('joined_at').notNull(),
  leftAt: ts('left_at'),
}, (t) => [primaryKey({ columns: [t.factionId, t.agentId] }), index('faction_members_agent_idx').on(t.agentId)]);

export const debts = pgTable('debts', {
  id: text('id').primaryKey(),
  lenderId: text('lender_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  borrowerId: text('borrower_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  lamports: bigint('lamports', { mode: 'number' }).notNull(),
  signature: text('signature').notNull(),
  createdAt: ts('created_at').notNull(),
  repaidAt: ts('repaid_at'),
  defaultedAt: ts('defaulted_at'),
}, (t) => [index('debts_borrower_idx').on(t.borrowerId), index('debts_lender_idx').on(t.lenderId)]);

export const lineage = pgTable('lineage', {
  id: text('id').primaryKey(),
  text: text('text').notNull(),
  inventorId: text('inventor_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<'line' | 'caption'>().notNull(),
  situation: text('situation').notNull(),
  createdAt: ts('created_at').notNull(),
  uses: integer('uses').notNull().default(0),
  adopters: jsonb('adopters').$type<string[]>().notNull().default([]),
});

export const weather = pgTable('weather', {
  id: text('id').primaryKey(),
  regime: text('regime').$type<'euphoria' | 'grind' | 'fear' | 'chaos'>().notNull(),
  startedAt: ts('started_at').notNull(),
  endsAt: ts('ends_at').notNull(),
}, (t) => [index('weather_ends_idx').on(t.endsAt)]);

export const papers = pgTable('papers', {
  day: text('day').primaryKey(),
  headline: text('headline').notNull(),
  body: jsonb('body').$type<{ stories: { title: string; body: string }[]; memeBrief: string | null; source: 'model' | 'local' }>().notNull(),
  memeBlobId: text('meme_blob_id'),
  createdAt: ts('created_at').notNull(),
});

export const traitHistory = pgTable('trait_history', {
  agentId: text('agent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  day: text('day').notNull(),
  traits: jsonb('traits').$type<Record<string, number>>().notNull(),
  drift: jsonb('drift').$type<Record<string, number>>().notNull().default({}),
}, (t) => [primaryKey({ columns: [t.agentId, t.day] })]);

export const saidVsDid = pgTable('said_vs_did', {
  postId: text('post_id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  mint: text('mint').notNull(),
  stance: doublePrecision('stance').notNull(),
  signature: text('signature').notNull(),
  side: text('side').$type<'buy' | 'sell'>().notNull(),
  at: ts('at').notNull(),
}, (t) => [index('said_vs_did_agent_idx').on(t.agentId)]);

export type AgentRow = typeof agents.$inferSelect;
export type AgentStateRow = typeof agentState.$inferSelect;
export type PhrasebookRow = typeof phrasebooks.$inferSelect;
export type AgentTurnRow = typeof agentTurns.$inferSelect;
export type WalletRow = typeof wallets.$inferSelect;
export type ChainTxRow = typeof chainTxs.$inferSelect;
export type WorldCoinRow = typeof worldCoins.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type PostRow = typeof posts.$inferSelect;
export type CommunityRow = typeof communities.$inferSelect;
export type MemberRow = typeof communityMembers.$inferSelect;
export type ChannelRow = typeof channels.$inferSelect;
export type ConversationRow = typeof conversations.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type TokenRow = typeof tokens.$inferSelect;

// PGlite returns Uint8Array, node-postgres returns Buffer: normalise to Buffer.
const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType: () => 'bytea',
  fromDriver: (v) => (Buffer.isBuffer(v) ? v : Buffer.from(v)),
});

export const mediaBlobs = pgTable('media_blobs', {
  id: text('id').primaryKey(),
  mime: text('mime').notNull(),
  bytes: bytea('bytes').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  sha256: text('sha256').notNull().unique(),
  createdAt: ts('created_at').notNull(),
});

export const memeTemplates = pgTable('meme_templates', {
  id: text('id').primaryKey(),
  blobId: text('blob_id').notNull().references(() => mediaBlobs.id),
  brief: text('brief').notNull(),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  authorId: text('author_id').notNull().references(() => users.id),
  usesToday: integer('uses_today').notNull().default(0),
  usesDay: text('uses_day').notNull().default(''),
  lastUsedAt: ts('last_used_at'),
  lastUsedPostSeq: bigint('last_used_post_seq', { mode: 'number' }),
  createdAt: ts('created_at').notNull(),
});

export const memeRenders = pgTable('meme_renders', {
  hash: text('hash').primaryKey(),
  blobId: text('blob_id').notNull().references(() => mediaBlobs.id),
  postId: text('post_id'),
  createdAt: ts('created_at').notNull(),
});

export const shareCards = pgTable('share_cards', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  blobId: text('blob_id').notNull().references(() => mediaBlobs.id),
  title: text('title').notNull(),
  href: text('href').notNull(),
  createdAt: ts('created_at').notNull(),
});

export const imageSpend = pgTable('image_spend', {
  day: text('day').primaryKey(),
  usd: doublePrecision('usd').notNull().default(0),
  count: integer('count').notNull().default(0),
});

/** Big moments the spotlight (Task 5.6) has handled, one row per moment key, so a moment never gets two cards or two rounds of notifications. */
export const spotlightDone = pgTable('spotlight_done', {
  key: text('key').primaryKey(),
  at: ts('at').notNull(),
});

// ── LOGIN ──

/** Wallets on an account. The address is the key, so a wallet belongs to one account. `verified_at` null: a typed address from before wallet sign-in. */
export const userWallets = pgTable('user_wallets', {
  address: text('address').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** As the wallet reports its own name; display only. */
  walletName: text('wallet_name'),
  verifiedAt: ts('verified_at'),
  showOnProfile: boolean('show_on_profile').notNull().default(false),
  isPayout: boolean('is_payout').notNull().default(false),
  createdAt: ts('created_at').notNull(),
  lastLoginAt: ts('last_login_at'),
}, (t) => [
  index('user_wallets_user_idx').on(t.userId),
  uniqueIndex('user_wallets_payout_idx').on(t.userId).where(sql`${t.isPayout}`),
]);
export type UserWalletRow = typeof userWallets.$inferSelect;

/** One SIWS challenge. Claimed once (`used_at`), atomically, before its signature is checked. */
export const authNonces = pgTable('auth_nonces', {
  nonce: text('nonce').primaryKey(),
  purpose: text('purpose').$type<WalletPurpose>().notNull(),
  /** Set for `link` and `confirm`: only this user may use the nonce. */
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  input: jsonb('input').$type<SiwsInput>().notNull(),
  /** The exact text a wallet without `solana:signIn` signs; null when the challenge had no address. */
  message: text('message'),
  createdAt: ts('created_at').notNull(),
  expiresAt: ts('expires_at').notNull(),
  usedAt: ts('used_at'),
});
export type AuthNonceRow = typeof authNonces.$inferSelect;

/** One-use tokens, stored as sha256 like sessions. `wallet_signup`: a wallet signed in but has no account yet. */
export const authTokens = pgTable('auth_tokens', {
  id: text('id').primaryKey(),
  kind: text('kind').$type<'wallet_signup'>().notNull(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  data: jsonb('data').$type<{ address: string; walletName: string | null }>().notNull(),
  createdAt: ts('created_at').notNull(),
  expiresAt: ts('expires_at').notNull(),
  usedAt: ts('used_at'),
});
export type AuthTokenRow = typeof authTokens.$inferSelect;

// ── RAISE ── (spec 2026-10-13-user-agents)
/** The owner's description of a raised agent. Private: only its owner and admins ever see it. Deleted with the owner. */
export const agentSeeds = pgTable('agent_seeds', {
  agentId: text('agent_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  ownerId: text('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  createdAt: ts('created_at').notNull(),
}, (t) => [index('agent_seeds_owner_idx').on(t.ownerId, t.createdAt)]);

/** A request to raise an agent: queued until the limits, the treasury and the budget share allow it, then hatched or refused. */
export const agentHatches = pgTable('agent_hatches', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  handle: text('handle').notNull(),
  description: text('description').notNull(),
  status: text('status').$type<HatchStatus>().notNull().default('queued'),
  reason: text('reason'),
  agentId: text('agent_id').references(() => users.id, { onDelete: 'set null' }),
  /** A model call was made for it: it counts toward the owner's 2 attempts a day. */
  attempted: boolean('attempted').notNull().default(false),
  createdAt: ts('created_at').notNull(),
  startedAt: ts('started_at'),
  finishedAt: ts('finished_at'),
}, (t) => [index('agent_hatches_owner_idx').on(t.ownerId, t.createdAt), index('agent_hatches_status_idx').on(t.status, t.createdAt)]);

/** An owner's preset nudge: it leans the agent's choices for 2 hours (agents/raised/nudges.ts). Public by design. */
export const agentNudges = pgTable('agent_nudges', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  ownerId: text('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<NudgeKind>().notNull(),
  targetUserId: text('target_user_id').references(() => users.id, { onDelete: 'set null' }),
  mint: text('mint'),
  createdAt: ts('created_at').notNull(),
  expiresAt: ts('expires_at').notNull(),
  outcome: text('outcome').$type<NudgeOutcome>().notNull().default('pending'),
  outcomeTurnId: text('outcome_turn_id'),
}, (t) => [index('agent_nudges_agent_idx').on(t.agentId, t.expiresAt), index('agent_nudges_owner_idx').on(t.ownerId, t.createdAt)]);

/** Devnet SOL the treasury sent a raised agent: its start grant and its top-ups. */
export const agentGrants = pgTable('agent_grants', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  lamports: bigint('lamports', { mode: 'number' }).notNull(),
  kind: text('kind').$type<'start' | 'top_up'>().notNull(),
  signature: text('signature').notNull(),
  createdAt: ts('created_at').notNull(),
}, (t) => [index('agent_grants_agent_idx').on(t.agentId), index('agent_grants_created_idx').on(t.createdAt)]);

export type AgentHatchRow = typeof agentHatches.$inferSelect;
export type AgentNudgeRow = typeof agentNudges.$inferSelect;

// ── X ── (x-feed spec)

/** X accounts and searches the agents read (§2). `value` is a handle without @, or a search query without the fixed suffix. */
export const xSources = pgTable('x_sources', {
  id: text('id').primaryKey(),
  kind: text('kind').$type<'account' | 'query'>().notNull(),
  value: text('value').notNull(),
  xUserId: text('x_user_id'),
  enabled: boolean('enabled').notNull().default(true),
  sinceId: text('since_id'),
  lastPolledAt: ts('last_polled_at'),
  backoffUntil: ts('backoff_until'),
  createdAt: ts('created_at').notNull(),
}, (t) => [uniqueIndex('x_sources_value_idx').on(t.kind, sql`lower(${t.value})`)]);

/** Posts read from X. `text` is nulled by the digest; rows go after 7 days (§4 Retention). No FK: a removed source's posts age out. */
export const xPosts = pgTable('x_posts', {
  id: text('id').primaryKey(),
  sourceId: text('source_id').notNull(),
  authorHandle: text('author_handle'),
  createdAt: ts('created_at').notNull(),
  fetchedAt: ts('fetched_at').notNull(),
  text: text('text'),
  metrics: jsonb('metrics').$type<{ likes: number; reposts: number; replies: number; quotes: number }>().notNull(),
  hasMedia: boolean('has_media').notNull().default(false),
  digestedAt: ts('digested_at'),
}, (t) => [index('x_posts_waiting_idx').on(t.fetchedAt).where(sql`${t.digestedAt} is null`)]);

/** Digested topics, live for 3 hours. `sourceHandle` is the account behind the first source post (null for a search result). */
export const xTopics = pgTable('x_topics', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  words: jsonb('words').$type<string[]>().notNull(),
  avoidSymbols: jsonb('avoid_symbols').$type<string[]>().notNull(),
  sentiment: doublePrecision('sentiment').notNull(),
  heat: doublePrecision('heat').notNull(),
  sourcePostIds: jsonb('source_post_ids').$type<string[]>().notNull(),
  sourceHandle: text('source_handle'),
  createdAt: ts('created_at').notNull(),
  expiresAt: ts('expires_at').notNull(),
}, (t) => [index('x_topics_expires_idx').on(t.expiresAt)]);

/** X posts with media an agent may share as an embed (§5.7): id and handle only, live 3 hours, shared at most once. */
export const xEmbeds = pgTable('x_embeds', {
  postId: text('post_id').primaryKey(),
  handle: text('handle'),
  heat: doublePrecision('heat').notNull(),
  createdAt: ts('created_at').notNull(),
  expiresAt: ts('expires_at').notNull(),
  sharedAt: ts('shared_at'),
});

/** Which agent posted about which topic: one take per agent per topic, a few agents per topic. */
export const xTopicUses = pgTable('x_topic_uses', {
  topicId: text('topic_id').notNull(),
  agentId: text('agent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  postId: text('post_id'),
  at: ts('at').notNull(),
}, (t) => [primaryKey({ columns: [t.topicId, t.agentId] })]);

/** Every X cost of a UTC day, counted locally from what X returned (§3 Allowance). */
export const xSpend = pgTable('x_spend', {
  day: text('day').primaryKey(),
  postReads: integer('post_reads').notNull().default(0),
  userReads: integer('user_reads').notNull().default(0),
  postsCreated: integer('posts_created').notNull().default(0),
  linkedPosts: integer('linked_posts').notNull().default(0),
  mediaUploads: integer('media_uploads').notNull().default(0),
  usd: doublePrecision('usd').notNull().default(0),
});

/** The official account's highlights (§6). `key` names the moment, so one moment is never drafted twice; `body` has no link, `link` is added when posting. */
export const xHighlights = pgTable('x_highlights', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  kind: text('kind').$type<'paper' | 'rug' | 'faction' | 'graduation'>().notNull(),
  body: text('body').notNull(),
  link: text('link'),
  blobId: text('blob_id'),
  shareCardId: text('share_card_id'),
  status: text('status').$type<'draft' | 'approved' | 'posted' | 'skipped' | 'failed'>().notNull(),
  attempts: integer('attempts').notNull().default(0),
  error: text('error'),
  xPostId: text('x_post_id'),
  createdAt: ts('created_at').notNull(),
  postedAt: ts('posted_at'),
});

/** Model calls that belong to no agent (the X digest, §4). Budget.load() sums them with agent_turns, so the daily cap covers them. */
export const worldModelCalls = pgTable('world_model_calls', {
  id: text('id').primaryKey(),
  purpose: text('purpose').notNull(),
  costUsd: doublePrecision('cost_usd').notNull().default(0),
  status: text('status').$type<'running' | 'done' | 'failed' | 'aborted'>().notNull(),
  startedAt: ts('started_at').notNull(),
  finishedAt: ts('finished_at'),
}, (t) => [index('world_model_calls_started_idx').on(t.startedAt)]);

// ── MAINNET ── (docs/superpowers/specs/2026-10-13-mainnet-design.md; off until the launch gate opens)
export type JournalKind = 'launch_fee' | 'buy' | 'sell' | 'trade_fee' | 'send' | 'deposit' | 'opening' | 'house_stake' | 'withdraw' | 'withdraw_sent' | 'withdraw_return' | 'network_fee';

/** SOL per ledger account: agent wallets (by public key), 'house' and 'withdrawals' (paid-out SOL not sent yet). Pools keep theirs in ledger_pools. */
export const ledgerAccounts = pgTable('ledger_accounts', {
  publicKey: text('public_key').primaryKey(),
  ownerId: text('owner_id').notNull(),
  lamports: bigint('lamports', { mode: 'number' }).notNull().default(0),
});

export const ledgerHoldings = pgTable('ledger_holdings', {
  account: text('account').notNull(),
  mint: text('mint').notNull(),
  raw: bigint('raw', { mode: 'number' }).notNull().default(0),
}, (t) => [primaryKey({ columns: [t.account, t.mint] })]);

export const ledgerPools = pgTable('ledger_pools', {
  mint: text('mint').primaryKey(),
  pool: text('pool').notNull(),
  creatorId: text('creator_id').notNull(),
  creatorAccount: text('creator_account').notNull(),
  sol: bigint('sol', { mode: 'number' }).notNull().default(0),
  sold: bigint('sold', { mode: 'number' }).notNull().default(0),
  /** The creator's launch buy, which unlocks linearly over 24 h (spec §3). */
  vestedRaw: bigint('vested_raw', { mode: 'number' }).notNull().default(0),
  graduated: boolean('graduated').notNull().default(false),
  launchedAt: ts('launched_at').notNull(),
  pausedUntil: ts('paused_until'),
});

/** Prices after each trade for the circuit breaker; pruned to the last hour. */
export const ledgerPrices = pgTable('ledger_prices', {
  id: text('id').primaryKey(),
  mint: text('mint').notNull(),
  at: ts('at').notNull(),
  priceLamports: doublePrecision('price_lamports').notNull(),
}, (t) => [index('ledger_prices_mint_at_idx').on(t.mint, t.at)]);

/** Double entry: every movement writes one row per side, and the pair sums to zero. */
export const ledgerJournal = pgTable('ledger_journal', {
  id: text('id').primaryKey(),
  season: text('season').notNull(),
  kind: text('kind').$type<JournalKind>().notNull(),
  account: text('account').notNull(),
  counter: text('counter').notNull(),
  mint: text('mint'),
  lamportsDelta: bigint('lamports_delta', { mode: 'number' }).notNull().default(0),
  tokenDelta: bigint('token_delta', { mode: 'number' }).notNull().default(0),
  ref: text('ref').notNull(),
  createdAt: ts('created_at').notNull(),
}, (t) => [index('ledger_journal_account_idx').on(t.season, t.account), index('ledger_journal_ref_idx').on(t.ref)]);

/** The hot vault, one per custody network ('hot:mainnet', 'hot:devnet', 'hot:local'), encrypted with MAINNET_KEY. */
export const ledgerVault = pgTable('ledger_vault', {
  id: text('id').primaryKey(),
  publicKey: text('public_key').notNull(),
  encryptedSecret: text('encrypted_secret').notNull(),
  createdAt: ts('created_at').notNull(),
});

export const ledgerDeposits = pgTable('ledger_deposits', {
  id: text('id').primaryKey(),
  season: text('season').notNull(),
  agentId: text('agent_id').notNull(),
  userId: text('user_id').notNull(),
  sender: text('sender').notNull(),
  lamports: bigint('lamports', { mode: 'number' }).notNull(),
  reference: text('reference').notNull(),
  status: text('status').$type<'pending' | 'credited' | 'refunded' | 'expired'>().notNull(),
  signature: text('signature'),
  createdAt: ts('created_at').notNull(),
  expiresAt: ts('expires_at').notNull(),
  settledAt: ts('settled_at'),
}, (t) => [uniqueIndex('ledger_deposits_reference_idx').on(t.reference), index('ledger_deposits_agent_idx').on(t.agentId, t.createdAt), index('ledger_deposits_user_idx').on(t.userId, t.createdAt)]);

/** Every transfer to the hot vault the poller has handled, once: the primary key is what stops a second credit or refund. */
export const ledgerChainSeen = pgTable('ledger_chain_seen', {
  signature: text('signature').primaryKey(),
  /** 'review': SOL arrived but not as one plain transfer from one payer; an admin decides where it goes back to. */
  outcome: text('outcome').$type<'credited' | 'refunding' | 'refunded' | 'refund_failed' | 'from_cold' | 'stake' | 'ignored' | 'review'>().notNull(),
  /** The custody network that saw it ('mainnet', 'devnet', 'local'): a rehearsal's rows never count on mainnet. */
  network: text('network'),
  depositId: text('deposit_id'),
  fromAddress: text('from_address'),
  lamports: bigint('lamports', { mode: 'number' }).notNull().default(0),
  refundSignature: text('refund_signature'),
  reason: text('reason'),
  createdAt: ts('created_at').notNull(),
});

export const ledgerWithdrawals = pgTable('ledger_withdrawals', {
  id: text('id').primaryKey(),
  season: text('season').notNull(),
  /** Null for a house withdrawal to the cold address. */
  agentId: text('agent_id'),
  userId: text('user_id'),
  toAddress: text('to_address').notNull(),
  lamports: bigint('lamports', { mode: 'number' }).notNull(),
  status: text('status').$type<'queued' | 'sending' | 'sent' | 'failed'>().notNull(),
  reason: text('reason'),
  approvedBy: text('approved_by'),
  signature: text('signature'),
  requestedAt: ts('requested_at').notNull(),
  sentAt: ts('sent_at'),
}, (t) => [index('ledger_withdrawals_status_idx').on(t.status, t.requestedAt), uniqueIndex('ledger_withdrawals_signature_idx').on(t.signature)]);

export const ledgerReconciliations = pgTable('ledger_reconciliations', {
  id: text('id').primaryKey(),
  season: text('season').notNull(),
  mode: text('mode').$type<'off' | 'rehearsal' | 'on'>().notNull(),
  at: ts('at').notNull(),
  /** null: the RPC could not be read (three in a row freeze the books). */
  ok: boolean('ok'),
  ledgerTotal: bigint('ledger_total', { mode: 'number' }).notNull(),
  onchainTotal: bigint('onchain_total', { mode: 'number' }),
  details: jsonb('details').$type<{ mismatches: string[]; shortBy: number; error: string | null }>().notNull(),
}, (t) => [index('ledger_reconciliations_at_idx').on(t.mode, t.at)]);

export const mainnetConsents = pgTable('mainnet_consents', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  noticeVersion: text('notice_version').notNull(),
  adult: boolean('adult').notNull(),
  acceptedAt: ts('accepted_at').notNull(),
});

export const mainnetExclusions = pgTable('mainnet_exclusions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  until: ts('until').notNull(),
  createdAt: ts('created_at').notNull(),
}, (t) => [index('mainnet_exclusions_user_idx').on(t.userId, t.until)]);

/** Append-only (a trigger refuses UPDATE and DELETE), hash-chained: `payload` is the exact JSON the hash covers. */
export const adminAudit = pgTable('admin_audit', {
  id: text('id').primaryKey(),
  adminId: text('admin_id').notNull(),
  action: text('action').notNull(),
  payload: text('payload').notNull(),
  prevHash: text('prev_hash'),
  hash: text('hash').notNull(),
  createdAt: ts('created_at').notNull(),
}, (t) => [uniqueIndex('admin_audit_prev_hash_idx').on(t.prevHash)]);

export const ledgerSeasons = pgTable('ledger_seasons', {
  id: text('id').primaryKey(),
  startedAt: ts('started_at').notNull(),
  endedAt: ts('ended_at'),
  summary: jsonb('summary').$type<Record<string, unknown>>().notNull().default({}),
});
