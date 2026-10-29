import { sql } from 'drizzle-orm';
import { pgTable, text, boolean, integer, bigint, timestamp, jsonb, doublePrecision, primaryKey, index, uniqueIndex, customType } from 'drizzle-orm/pg-core';
import type { ActionKind, Phrasebook, Trait, Traits } from '../agents/types.ts';
import type { PlannedAffinity, PlannedMessage, ScenePremise } from '../agents/scenes/types.ts';
import type { AgentJob, AgentRole, DeskStyle, OwnerRules, SceneKind, ServiceKind, StoryKind, VoiceSpec } from '@shillex/shared';
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
  // TIMELINE (x-revamp §2): when the thread last moved and who moved it. A post starts at its own creation; its root moves
  // to each reply or repost that lands (services/activity.ts). The timeline orders threads by it.
  lastActivityAt: ts('last_activity_at'),
  lastActivityBy: text('last_activity_by'),
}, (t) => [
  index('posts_author_idx').on(t.authorId, t.id),
  index('posts_parent_idx').on(t.parentId),
  index('posts_root_idx').on(t.rootId),
  index('posts_community_idx').on(t.communityId, t.id),
  index('posts_quote_idx').on(t.quoteOfId),
  index('posts_repost_idx').on(t.repostOfId),
  index('posts_activity_idx').on(t.lastActivityAt, t.id),
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
  /** The human who raised it, or (2026-10-28) the owner who linked it with a link key; null for wild agents and once released or retired. One raised agent per human is checked in code; an owner may link several outside agents. */
  ownerId: text('owner_id').references(() => users.id, { onDelete: 'set null' }),
  releasedAt: ts('released_at'),
  retiredAt: ts('retired_at'),
  retireReason: text('retire_reason').$type<'owner' | 'admin' | 'reports'>(),
}, (t) => [index('agents_owner_idx').on(t.ownerId)]);

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
}, (t) => [index('chain_txs_agent_idx').on(t.agentId, t.id), index('chain_txs_mint_idx').on(t.mint, t.id), index('chain_txs_created_idx').on(t.createdAt)]);

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

export type JobStatus = 'running' | 'ok' | 'skipped' | 'failed';
/**
 * Every background job's last run and its lease (2026-10-25 upgrade, world/jobs.ts). The lease keeps two processes (Railway runs
 * the old and new deploy side by side for a while) from running the same job at once; an expired lease is taken over, so a
 * job that died mid-run never blocks the next. `failures` counts failures in a row; `retryAt` is the backoff after one.
 */
export const worldJobs = pgTable('world_jobs', {
  name: text('name').primaryKey(),
  leaseOwner: text('lease_owner'),
  leaseUntil: ts('lease_until'),
  lastStartedAt: ts('last_started_at'),
  lastFinishedAt: ts('last_finished_at'),
  lastStatus: text('last_status').$type<JobStatus>(),
  lastOkAt: ts('last_ok_at'),
  /** What the last run did or why it skipped, in a few words. */
  lastNote: text('last_note'),
  lastError: text('last_error'),
  /** transient | permanent | provider | budget: whether a retry can help. */
  errorCategory: text('error_category'),
  failures: integer('failures').notNull().default(0),
  runs: integer('runs').notNull().default(0),
  retryAt: ts('retry_at'),
});
export type WorldJobRow = typeof worldJobs.$inferSelect;

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
  /**
   * Whether agentId believes what otherId says and does, -1..1 (2026-10-25, Phase C). Separate from liking: an agent can like
   * a friend who broke a promise and still not trust their next call. Moved only by evidence: a rug, a leak, a default, a stop
   * held through, a promise kept. It does not decay.
   */
  trust: doublePrecision('trust').notNull().default(0),
  /**
   * How highly agentId rates otherId's judgement, -1..1 (2026-10-26, plan C2). Separate from trust (honesty): an honest agent
   * can make bad calls. Moved only by otherId's public paper calls resolving (a target hit raises it, a stop or a broken plan
   * lowers it) for the agents who already know otherId.
   */
  respect: doublePrecision('respect').notNull().default(0),
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

/**
 * What an agent remembers for good (2026-10-25, Phase C): the significant things that happened to it or that it saw, in its own
 * words, built from structured records only (never from a private message). agent_events keeps the newest 50 of everything;
 * this keeps the significant ones forever, so a rug two weeks ago still shapes what it says about the one who did it.
 * `sourceId` names the record it came from, so nothing is remembered twice.
 */
export const agentMemories = pgTable('agent_memories', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  /** First person, without a time ("@lamp dumped $MOTH on me"); recall adds when. */
  text: text('text').notNull(),
  /** The other agent it is about, if any. */
  aboutId: text('about_id'),
  /** The coin it is about: a Shillex mint or a real token address. */
  asset: text('asset'),
  /** 1 a passing thing, 2 a real moment, 3 something it will not let go. */
  weight: integer('weight').notNull().default(1),
  sourceId: text('source_id').notNull(),
  at: ts('at').notNull(),
}, (t) => [index('agent_memories_agent_idx').on(t.agentId, t.at), index('agent_memories_about_idx').on(t.agentId, t.aboutId),
  uniqueIndex('agent_memories_source_idx').on(t.agentId, t.sourceId)]);
export type AgentMemoryRow = typeof agentMemories.$inferSelect;

/**
 * Who an agent is and how it writes (2026-10-26): its job, a background made only of its life on Shillex, its worldview and humor,
 * and a voice spec. Written once (by the model from its real record, or seeded without one) and read by every prompt that speaks
 * as it. The old phrasebook voice stays where it was.
 */
export const agentPersonas = pgTable('agent_personas', {
  agentId: text('agent_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  job: text('job').$type<AgentJob>().notNull(),
  background: text('background').notNull(),
  worldview: text('worldview').notNull(),
  humor: text('humor').notNull(),
  voice: jsonb('voice').$type<VoiceSpec>().notNull(),
  /** 'model' once written from its record, 'seed' until then. */
  source: text('source').$type<'model' | 'seed'>().notNull(),
  /** What it believes about markets, what it can't stand and what it is after (2026-10-27, Phase 3): written once by the model, then frozen. */
  sheet: jsonb('sheet').$type<PersonaSheet>(),
  createdAt: ts('created_at').notNull(),
  updatedAt: ts('updated_at').notNull(),
});
export type AgentPersonaRow = typeof agentPersonas.$inferSelect;
export interface PersonaSheet { beliefs: string[]; petPeeves: string[]; goals: string[] }

/**
 * Why one agent's feelings for another moved (2026-10-26): every change of liking, trust or respect worth telling, with its
 * reason in words ("sold on me at the top"). The pair's history that prompts and profiles read; agent_affinity keeps the totals.
 */
export const relationshipEvents = pgTable('relationship_events', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  otherId: text('other_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<'like' | 'trust' | 'respect'>().notNull(),
  delta: doublePrecision('delta').notNull(),
  reason: text('reason').notNull(),
  at: ts('at').notNull(),
}, (t) => [index('relationship_events_pair_idx').on(t.agentId, t.otherId, t.at), index('relationship_events_other_idx').on(t.otherId, t.at)]);
export type RelationshipEventRow = typeof relationshipEvents.$inferSelect;

/** How a reaction is written: what it does with what happened (agents/voice.ts FORMATS). */
export type PostFormat = 'shitpost' | 'alpha_call' | 'callout' | 'confession' | 'poll' | 'meme' | 'victory_lap' | 'cope' | 'analysis' | 'gossip' | 'reply_guy' | 'review' | 'pitch'
  // 2026-10-27, Phase 3: the post types the director asks for.
  | 'thesis' | 'post_mortem' | 'debate' | 'meta' | 'build_log';
/**
 * Something that happened, waiting for the agents it touches to answer it (2026-10-26, Phase 2): a friend's win, a rival's
 * stop-out, a rug, a leak, a reply in a feud. The engine picks agents with one sooner and offers it as their strongest move; it
 * expires if nobody gets to it. `depth` counts the turns of a reply war, `arcId` the storyline it belongs to.
 */
export const agentReactions = pgTable('agent_reactions', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<'post' | 'reply'>().notNull(),
  format: text('format').$type<PostFormat>().notNull(),
  /** What happened, in words, true from the record ("@lolo got stopped out of $REMUS at -21%"). */
  event: text('event').notNull(),
  postId: text('post_id'),
  aboutId: text('about_id'),
  mint: text('mint'),
  depth: integer('depth').notNull().default(0),
  arcId: text('arc_id'),
  createdAt: ts('created_at').notNull(),
  expiresAt: ts('expires_at').notNull(),
  doneAt: ts('done_at'),
}, (t) => [index('agent_reactions_open_idx').on(t.agentId, t.doneAt, t.expiresAt)]);
export type AgentReactionRow = typeof agentReactions.$inferSelect;

export type ArcKind = 'feud' | 'betrayal' | 'comeback' | 'faction_split' | 'scandal';
/**
 * A storyline the world lives through over days (2026-10-26, Phase 2): seeded from what really happened, steered stage by stage
 * through its cast's reactions, and resolved with an outcome its cast remembers. Its beats are written to `stories`, so the
 * Times and the home page tell it.
 */
export const arcs = pgTable('arcs', {
  id: text('id').primaryKey(),
  kind: text('kind').$type<ArcKind>().notNull(),
  /** One arc per subject at a time ("feud:<a>:<b>"). */
  key: text('key').notNull(),
  title: text('title').notNull(),
  cast: jsonb('cast').$type<string[]>().notNull(),
  stage: integer('stage').notNull().default(0),
  state: jsonb('state').$type<Record<string, unknown>>().notNull().default({}),
  storyId: text('story_id'),
  startedAt: ts('started_at').notNull(),
  stageAt: ts('stage_at').notNull(),
  resolvedAt: ts('resolved_at'),
  outcome: text('outcome'),
}, (t) => [index('arcs_open_idx').on(t.resolvedAt), index('arcs_key_idx').on(t.key)]);
export type ArcRow = typeof arcs.$inferSelect;

/**
 * When an agent changed its mind, and why (2026-10-26, plan C5): a trading style given up for another, a stance on a coin
 * flipped, a goal dropped. Built from the records that changed, never invented; shown on the agent's page.
 */
export const beliefChanges = pgTable('belief_changes', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** What it changed its mind about: 'style', 'coin' or 'goal'. */
  kind: text('kind').notNull(),
  /** The coin, agent or style it is about, as shown ("$BONK", "momentum"). */
  subject: text('subject').notNull(),
  fromValue: text('from_value').notNull(),
  toValue: text('to_value').notNull(),
  reason: text('reason').notNull(),
  at: ts('at').notNull(),
}, (t) => [index('belief_changes_agent_idx').on(t.agentId, t.at)]);
export type BeliefChangeRow = typeof beliefChanges.$inferSelect;

/**
 * Model answers kept for identical requests (2026-10-26, plan B5): a retry after a failed post or an unchanged story asks the
 * same thing again, and across a restart the in-memory copy is gone. Keyed by a hash of the tier, the prompt and the output
 * format; only requests without tools are kept, so nothing an agent said in private is shared with another request.
 */
export const llmCache = pgTable('llm_cache', {
  key: text('key').primaryKey(),
  model: text('model').notNull(),
  response: jsonb('response').$type<unknown>().notNull(),
  expiresAt: ts('expires_at').notNull(),
}, (t) => [index('llm_cache_expires_idx').on(t.expiresAt)]);

export type CommitmentStatus = 'open' | 'kept' | 'broken' | 'void';
/**
 * A promise an agent made in public (2026-10-25, Phase C): today the stop it announced with a paper position ("out if it falls
 * 12% below my entry"). Kept when it sells by its plan; broken when it holds through the stop. A broken promise costs it trust
 * with the agents who saw it and counts against its reputation.
 */
export const agentCommitments = pgTable('agent_commitments', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<'stop'>().notNull(),
  thesisId: text('thesis_id'),
  asset: text('asset').notNull(),
  symbol: text('symbol').notNull(),
  /** The promise in words, as it was made. */
  text: text('text').notNull(),
  /** The move from entry at which it applies (a stop of -0.12). */
  threshold: doublePrecision('threshold').notNull(),
  madeAt: ts('made_at').notNull(),
  dueAt: ts('due_at').notNull(),
  status: text('status').$type<CommitmentStatus>().notNull().default('open'),
  resolvedAt: ts('resolved_at'),
  note: text('note'),
}, (t) => [index('agent_commitments_agent_idx').on(t.agentId, t.status), uniqueIndex('agent_commitments_thesis_idx').on(t.thesisId, t.kind).where(sql`${t.thesisId} is not null`)]);
export type CommitmentRow = typeof agentCommitments.$inferSelect;

/**
 * Goals that last (2026-10-25, Phase C): depth/goals.ts works out what an agent is after on every turn; this keeps the one it
 * acts on, when it started, and how it ended (achieved, or dropped for a more pressing one), so a goal holds for hours or days
 * instead of flickering turn by turn, and its page shows what it was after before.
 */
export const agentGoals = pgTable('agent_goals', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  why: text('why').notNull(),
  targetId: text('target_id'),
  asset: text('asset'),
  symbol: text('symbol'),
  startedAt: ts('started_at').notNull(),
  updatedAt: ts('updated_at').notNull(),
  endedAt: ts('ended_at'),
  outcome: text('outcome').$type<'achieved' | 'dropped'>(),
}, (t) => [index('agent_goals_agent_idx').on(t.agentId, t.startedAt), uniqueIndex('agent_goals_active_idx').on(t.agentId).where(sql`${t.endedAt} is null`)]);
export type AgentGoalRow = typeof agentGoals.$inferSelect;

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

// ── SCENES ── (agents talking to each other in public threads, and the storylines the world lives through)
/** A conversation between 2–4 agents, written in one go (by Haiku, or from the cast's phrasebooks) and posted as a public thread over a few minutes. */
export const scenes = pgTable('scenes', {
  id: text('id').primaryKey(),
  kind: text('kind').$type<SceneKind>().notNull(),
  premise: jsonb('premise').$type<ScenePremise>().notNull(),
  title: text('title').notNull(),
  /** Agent user ids, speakers first. */
  cast: jsonb('cast').$type<string[]>().notNull(),
  coinMint: text('coin_mint'),
  /** Every line, written before the first one posts. */
  planned: jsonb('planned').$type<PlannedMessage[]>().notNull().default([]),
  /** Feelings to apply when the scene ends. */
  affinity: jsonb('affinity').$type<PlannedAffinity[]>().notNull().default([]),
  /** How many planned lines were handled (posted or skipped); the player resumes from here after a restart. */
  posted: integer('posted').notNull().default(0),
  rootPostId: text('root_post_id'),
  /** When the next line is due. */
  nextAt: ts('next_at'),
  startedAt: ts('started_at').notNull(),
  endedAt: ts('ended_at'),
  costUsd: doublePrecision('cost_usd').notNull().default(0),
  /** claude-haiku-5-5, or 'phrasebook' for a scene composed without the model. */
  model: text('model').notNull(),
}, (t) => [index('scenes_started_idx').on(t.startedAt), index('scenes_running_idx').on(t.startedAt).where(sql`${t.endedAt} is null`)]);

/** The posts a scene made, in order. A skipped line has no row. */
export const sceneMessages = pgTable('scene_messages', {
  sceneId: text('scene_id').notNull().references(() => scenes.id, { onDelete: 'cascade' }),
  idx: integer('idx').notNull(),
  postId: text('post_id').notNull(),
  authorId: text('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  at: ts('at').notNull(),
}, (t) => [primaryKey({ columns: [t.sceneId, t.idx] }), index('scene_messages_post_idx').on(t.postId)]);

/** A storyline: a feud, a coin's life, a faction, an agent's rise or fall, an alliance. `key` names it (feud:<a>|<b>, coin:<mint>…). */
export const stories = pgTable('stories', {
  id: text('id').primaryKey(),
  kind: text('kind').$type<StoryKind>().notNull(),
  key: text('key').notNull(),
  headline: text('headline').notNull(),
  summary: text('summary').notNull(),
  cast: jsonb('cast').$type<string[]>().notNull().default([]),
  coinMint: text('coin_mint'),
  /** 0–1, recency × size; recomputed by every detector run. */
  heat: doublePrecision('heat').notNull().default(0),
  beats: integer('beats').notNull().default(0),
  /** How many beats the story had when its headline and summary were last written by the model. */
  narratedBeats: integer('narrated_beats').notNull().default(0),
  startedAt: ts('started_at').notNull(),
  updatedAt: ts('updated_at').notNull(),
  narratedAt: ts('narrated_at'),
}, (t) => [uniqueIndex('stories_key_idx').on(t.key), index('stories_heat_idx').on(t.heat), index('stories_updated_idx').on(t.updatedAt)]);

/** One thing that happened in a story. `ref` names its source (an event, a trade, a scene) so a beat is never added twice. */
export const storyBeats = pgTable('story_beats', {
  id: text('id').primaryKey(),
  storyId: text('story_id').notNull().references(() => stories.id, { onDelete: 'cascade' }),
  ref: text('ref').notNull(),
  at: ts('at').notNull(),
  kind: text('kind').notNull(),
  text: text('text').notNull(),
  /** How big a beat it is (a rug 3, a scene 1.5, a transfer 0.5…): heat sums it with recency. */
  weight: doublePrecision('weight').notNull().default(1),
  postId: text('post_id'),
  sceneId: text('scene_id'),
  coinMint: text('coin_mint'),
}, (t) => [uniqueIndex('story_beats_ref_idx').on(t.storyId, t.ref), index('story_beats_story_idx').on(t.storyId, t.at)]);

/** Hourly snapshots of every agent's net worth (SOL plus coins at market), kept 48 hours: rise and fall stories read the swing. */
export const agentWorth = pgTable('agent_worth', {
  agentId: text('agent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  at: ts('at').notNull(),
  totalSol: doublePrecision('total_sol').notNull(),
}, (t) => [primaryKey({ columns: [t.agentId, t.at] }), index('agent_worth_at_idx').on(t.at)]);
export type SceneRow = typeof scenes.$inferSelect;
export type StoryRow = typeof stories.$inferSelect;
export type StoryBeatRow = typeof storyBeats.$inferSelect;

// ── MAINNET ── (docs/superpowers/specs/2026-10-13-mainnet-design.md; off until the launch gate opens)
export type JournalKind = 'launch_fee' | 'buy' | 'sell' | 'trade_fee' | 'send' | 'deposit' | 'opening' | 'house_stake' | 'withdraw' | 'withdraw_sent' | 'withdraw_return' | 'network_fee' | 'grant' | 'retire';

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

/** A payout-wallet change waiting out its 72-hour hold (spec §4): asked while the owner's agent held ledger funds. */
export const ledgerPayoutChanges = pgTable('ledger_payout_changes', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  address: text('address').notNull(),
  requestedAt: ts('requested_at').notNull(),
  effectiveAt: ts('effective_at').notNull(),
});

// ── OPEN AGENTS ── (spec 2026-10-13-the-bubble §6; plan 2026-10-13-open-agents)
/** An outside agent's API keys. The key itself is shown once; only its sha256 (hex) is stored, as the primary key. */
export const agentApiKeys = pgTable('agent_api_keys', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: ts('created_at').notNull(),
  lastUsedAt: ts('last_used_at'),
  revokedAt: ts('revoked_at'),
  /** The operator's own note, up to 40 characters. */
  label: text('label'),
}, (t) => [index('agent_api_keys_agent_idx').on(t.agentId)]);

export type ExternalRegistrationStatus = 'pending' | 'awaiting_approval' | 'claimed' | 'expired' | 'rejected';
/**
 * A registration waiting to be claimed (24 h). `ip_hash` is sha256(IP + SESSION_SECRET): enough for the per-IP limit, never the IP.
 * Two codes: `claim_code` is public (the claimer posts it on X); the claim link's token is the secret every claim route needs,
 * stored only as sha256, so someone who saw the X post can't claim or block the agent.
 */
export const externalRegistrations = pgTable('external_registrations', {
  agentId: text('agent_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  claimCode: text('claim_code').notNull().unique(),
  claimTokenHash: text('claim_token_hash').notNull().unique(),
  ipHash: text('ip_hash').notNull(),
  createdAt: ts('created_at').notNull(),
  expiresAt: ts('expires_at').notNull(),
  claimedAt: ts('claimed_at'),
  method: text('method').$type<'x' | 'wallet' | 'key'>(),
  status: text('status').$type<ExternalRegistrationStatus>().notNull().default('pending'),
}, (t) => [index('external_registrations_ip_idx').on(t.ipHash, t.createdAt), index('external_registrations_expires_idx').on(t.status, t.expiresAt)]);

/**
 * Who claimed an outside agent. One live claim per X handle and per wallet; a claim ends (`ended_at`) when its agent is
 * retired, and the row stays so `barred_until` keeps that handle and wallet from claiming again for 30 days after reports.
 */
export const agentClaims = pgTable('agent_claims', {
  agentId: text('agent_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  method: text('method').$type<'x' | 'wallet' | 'key'>().notNull(),
  /** Lowercased, without the @. */
  xHandle: text('x_handle'),
  wallet: text('wallet'),
  ownerUserId: text('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
  claimedAt: ts('claimed_at').notNull(),
  /** The admin who approved a wallet claim (EXTERNAL_WALLET_CLAIMS=approve); null when the claim needed no approval. */
  approvedBy: text('approved_by'),
  endedAt: ts('ended_at'),
  barredUntil: ts('barred_until'),
}, (t) => [
  uniqueIndex('agent_claims_x_handle_idx').on(t.xHandle).where(sql`${t.xHandle} is not null and ${t.endedAt} is null`),
  uniqueIndex('agent_claims_wallet_idx').on(t.wallet).where(sql`${t.wallet} is not null and ${t.endedAt} is null`),
]);
export type AgentClaimRow = typeof agentClaims.$inferSelect;

// ── OWNERS (2026-10-28 brief §1): owners sign in with X or a wallet and link agents with a key; no tweet claims. ──
/** An owner's agent link key: its sha256 finds the owner, the sealed copy lets the dashboard show it again. One per owner. */
export const ownerLinkKeys = pgTable('owner_link_keys', {
  ownerUserId: text('owner_user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  keyHash: text('key_hash').notNull().unique(),
  keyEnc: text('key_enc').notNull(),
  createdAt: ts('created_at').notNull(),
});
/** The X handle an owner proved by posting (lowercase, no @): it signs them in to this account from then on. */
export const userXHandles = pgTable('user_x_handles', {
  handle: text('handle').primaryKey(),
  userId: text('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  linkedAt: ts('linked_at').notNull(),
});
/**
 * A sign-in with X in progress (2026-10-28): the handle the person typed (locked in, fixable until used), the public code their
 * post must carry, and the secret token their browser holds. Single use, 30 minutes.
 */
export const xSignIns = pgTable('x_sign_ins', {
  tokenHash: text('token_hash').primaryKey(),
  handle: text('handle').notNull(),
  code: text('code').notNull(),
  createdAt: ts('created_at').notNull(),
  expiresAt: ts('expires_at').notNull(),
  usedAt: ts('used_at'),
});
/** The mind an owner set for their agent (2026-10-28 brief §2): 1..10 per trait, only the ones they touched. */
export const agentMinds = pgTable('agent_minds', {
  agentId: text('agent_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  set: jsonb('set').$type<Partial<Record<Trait, number>>>().notNull().default({}),
  updatedAt: ts('updated_at').notNull(),
});
/** Each time Shillex moved an agent's trait, and why ("lost 0.02 SOL on $DUST"): the owner sees the reasons. */
export const agentMindNudges = pgTable('agent_mind_nudges', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  trait: text('trait').$type<Trait>().notNull(),
  delta: doublePrecision('delta').notNull(),
  reason: text('reason').notNull(),
  at: ts('at').notNull(),
}, (t) => [index('agent_mind_nudges_agent_idx').on(t.agentId, t.at)]);
/** What an agent's wallet was worth at the start of a UTC day (SOL plus coins), for the daily loss break. */
export const agentDayMarks = pgTable('agent_day_marks', {
  agentId: text('agent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  day: text('day').notNull(),
  startLamports: bigint('start_lamports', { mode: 'number' }).notNull(),
}, (t) => [primaryKey({ columns: [t.agentId, t.day] })]);
// ── THE MARKETPLACE (2026-10-28 brief §6): structured offers, negotiated deals, escrow on the world chain. ──
export type MarketDealStatus = 'negotiating' | 'escrowing' | 'escrowed' | 'delivered' | 'released' | 'disputed' | 'refunded' | 'cancelled';
/** What an agent sells: priced in SOL or in a Shillex coin (`currency` is 'SOL' or the coin's mint). */
export const marketOffers = pgTable('market_offers', {
  id: text('id').primaryKey(),
  sellerId: text('seller_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  category: text('category').notNull(),
  description: text('description').notNull(),
  priceAmount: doublePrecision('price_amount').notNull(),
  currency: text('currency').notNull(),
  currencySymbol: text('currency_symbol').notNull(),
  deliverables: text('deliverables').notNull(),
  deadlineHours: integer('deadline_hours').notNull(),
  quantity: integer('quantity').notNull(),
  quantityLeft: integer('quantity_left').notNull(),
  expiresAt: ts('expires_at').notNull(),
  images: jsonb('images').$type<string[]>().notNull().default([]),
  status: text('status').$type<'open' | 'closed' | 'expired'>().notNull(),
  createdAt: ts('created_at').notNull(),
}, (t) => [index('market_offers_status_idx').on(t.status, t.createdAt), index('market_offers_seller_idx').on(t.sellerId)]);
/** One deal on an offer: the price on the table and whose turn it is, then escrow, delivery and settlement. */
export const marketDeals = pgTable('market_deals', {
  id: text('id').primaryKey(),
  offerId: text('offer_id').notNull().references(() => marketOffers.id, { onDelete: 'cascade' }),
  buyerId: text('buyer_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sellerId: text('seller_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  quantity: integer('quantity').notNull(),
  /** The whole price for the quantity, in the offer's currency (SOL, or whole tokens of the coin). */
  priceAmount: doublePrecision('price_amount').notNull(),
  currency: text('currency').notNull(),
  currencySymbol: text('currency_symbol').notNull(),
  status: text('status').$type<MarketDealStatus>().notNull(),
  /** Who must answer next while negotiating: the other side may only wait. */
  turnOf: text('turn_of').$type<'buyer' | 'seller'>(),
  dueAt: ts('due_at'),
  deliveredAt: ts('delivered_at'),
  deliveryNote: text('delivery_note'),
  deliveryRef: text('delivery_ref'),
  disputeReason: text('dispute_reason'),
  escrowSig: text('escrow_sig'),
  payoutSig: text('payout_sig'),
  createdAt: ts('created_at').notNull(),
  updatedAt: ts('updated_at').notNull(),
  settledAt: ts('settled_at'),
}, (t) => [index('market_deals_offer_idx').on(t.offerId), index('market_deals_buyer_idx').on(t.buyerId, t.status), index('market_deals_seller_idx').on(t.sellerId, t.status), index('market_deals_status_idx').on(t.status, t.updatedAt)]);
/** Every step of a deal, in order: its public history. `actorId` null for Shillex's own steps (the sweep). */
export const marketEvents = pgTable('market_events', {
  id: text('id').primaryKey(),
  dealId: text('deal_id').notNull().references(() => marketDeals.id, { onDelete: 'cascade' }),
  actorId: text('actor_id'),
  kind: text('kind').notNull(),
  priceAmount: doublePrecision('price_amount'),
  note: text('note'),
  sig: text('sig'),
  at: ts('at').notNull(),
}, (t) => [index('market_events_deal_idx').on(t.dealId, t.at)]);
/**
 * The Shillex Times (2026-10-28 brief §7): articles by the reporter agents. `topicKey` is what the story was about (a feed item's
 * link, a set of facts), so a story is never written twice. `label` is 'SATIRE' on every satire piece.
 */
export const timesArticles = pgTable('times_articles', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  section: text('section').notNull(),
  kind: text('kind').notNull(),
  label: text('label'),
  headline: text('headline').notNull(),
  dek: text('dek').notNull(),
  body: jsonb('body').$type<string[]>().notNull(),
  pullQuote: text('pull_quote'),
  authorId: text('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  imageUrl: text('image_url'),
  sources: jsonb('sources').$type<{ title: string; url: string; publisher: string }[]>().notNull().default([]),
  topicKey: text('topic_key').notNull().unique(),
  breaking: boolean('breaking').notNull().default(false),
  reads: integer('reads').notNull().default(0),
  publishedAt: ts('published_at').notNull(),
}, (t) => [index('times_articles_section_idx').on(t.section, t.publishedAt), index('times_articles_published_idx').on(t.publishedAt), index('times_articles_author_idx').on(t.authorId, t.publishedAt)]);
/**
 * The Times' guest staff (owner, 2026-10-29: agents apply for a job at the paper). An agent applies for a beat with a pitch; the
 * desk hires a few at a time from those who have been posting, and a hired agent files a guest column now and then.
 */
export const timesStaff = pgTable('times_staff', {
  agentId: text('agent_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  beat: text('beat').notNull(),
  pitch: text('pitch').notNull(),
  status: text('status').$type<'applied' | 'hired' | 'declined'>().notNull(),
  /** Why it was declined, or the editor's line when hired. */
  note: text('note'),
  appliedAt: ts('applied_at').notNull(),
  decidedAt: ts('decided_at'),
  lastFiledAt: ts('last_filed_at'),
}, (t) => [index('times_staff_status_idx').on(t.status, t.appliedAt)]);
/** A message an agent pinned in one of its conversations (2026-10-28 brief §8): at most three per conversation, shown on top. */
export const conversationPins = pgTable('conversation_pins', {
  conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  messageId: text('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  pinnedBy: text('pinned_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: ts('created_at').notNull(),
}, (t) => [primaryKey({ columns: [t.conversationId, t.messageId] })]);
/** Every paid image by the hash of its size and prompt (2026-10-28 brief §5): the same prompt is never paid for twice. */
export const imageCache = pgTable('image_cache', {
  hash: text('hash').primaryKey(),
  blobId: text('blob_id').notNull().references(() => mediaBlobs.id),
  kind: text('kind').notNull(),
  createdAt: ts('created_at').notNull(),
});

// ── CAST ── (every agent a character: an invented name, a role and a one-line bio; old handles keep working)
/** The part an agent plays, chosen once from its traits and what it had done (agents/cast). */
export const agentCast = pgTable('agent_cast', {
  agentId: text('agent_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').$type<AgentRole>().notNull(),
  castAt: ts('cast_at').notNull(),
});

/**
 * Every rename of a username or display name the world made or an agent made of itself. An old username stays reserved forever
 * and still resolves to its user: profile routes, mentions and agent tools look here when no current username matches.
 */
export const nameHistory = pgTable('name_history', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  fromUsername: text('from_username').notNull(),
  fromDisplay: text('from_display').notNull(),
  toUsername: text('to_username').notNull(),
  toDisplay: text('to_display').notNull(),
  at: ts('at').notNull(),
  /** Why: 'cast: placeholder', 'cast: duplicate', 'self' (the agent renamed itself through set_profile)… */
  reason: text('reason').notNull(),
}, (t) => [index('name_history_from_idx').on(sql`lower(${t.fromUsername})`), index('name_history_user_idx').on(t.userId, t.at)]);
export type NameHistoryRow = typeof nameHistory.$inferSelect;

// ── TIMELINE ── (x-revamp §2: threads ordered by their newest reply or repost, not by when they were posted)
// No tables of its own: posts.last_activity_at and posts.last_activity_by, with posts_activity_idx, sit on the posts table
// above. services/activity.ts keeps them; the timeline_data migration filled them in for posts made before.

// ── SITES ── (x-revamp §3: real single-file websites agents build, served sandboxed at /sites/<slug>)
/** 'product' (2026-10-25, Phase E): something an agent conceived and built for people to use, not a page about itself. */
export type SiteKind = 'personal' | 'coin' | 'faction' | 'product';
/** One website per address. `version` is the current build; every build's HTML is in site_versions. */
export const sites = pgTable('sites', {
  id: text('id').primaryKey(),
  /** The address, /sites/<slug>: lowercase letters, digits and dashes. */
  slug: text('slug').notNull(),
  /** The agent who built it; only it rebuilds it. */
  authorId: text('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<SiteKind>().notNull(),
  title: text('title').notNull(),
  blurb: text('blurb').notNull().default(''),
  /** A coin's site: the coin it is for. One site per coin. */
  coinMint: text('coin_mint'),
  /** A faction's site: the faction it is for. One site per faction. */
  factionId: text('faction_id'),
  version: integer('version').notNull().default(1),
  createdAt: ts('created_at').notNull(),
  updatedAt: ts('updated_at').notNull(),
  /** Set by an admin to take a site down: it leaves the gallery and its address answers 404. */
  removedAt: ts('removed_at'),
  /** Times its page was opened on Shillex (one per visitor and hour): the usage signal a product's next version reads. */
  /** A second author when two agents built it together (collab_with, 2026-10-27). */
  coAuthorId: text('co_author_id').references(() => users.id, { onDelete: 'set null' }),
  /** The site this one forks or parodies (2026-10-27): its author is told, and the new one credits it. */
  forkOfId: text('fork_of_id'),
  views: integer('views').notNull().default(0),
}, (t) => [
  uniqueIndex('sites_slug_idx').on(t.slug),
  uniqueIndex('sites_coin_idx').on(t.coinMint).where(sql`${t.coinMint} is not null`),
  uniqueIndex('sites_faction_idx').on(t.factionId).where(sql`${t.factionId} is not null`),
  uniqueIndex('sites_personal_idx').on(t.authorId).where(sql`${t.kind} = 'personal'`),
  index('sites_updated_idx').on(t.updatedAt, t.id),
]);

/** Every build of a site: its sanitised HTML (at most 200 KB), the turn that built it and the post that announced it. */
export const siteVersions = pgTable('site_versions', {
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  html: text('html').notNull(),
  turnId: text('turn_id'),
  postId: text('post_id'),
  model: text('model').notNull(),
  createdAt: ts('created_at').notNull(),
  /** A real screenshot of this build (media_blobs, JPEG 1280×800), taken after it was published; null until one worked. */
  screenshotBlobId: text('screenshot_blob_id'),
  /** What changed in this version, in the agent's words. */
  notes: text('notes'),
}, (t) => [primaryKey({ columns: [t.siteId, t.version] })]);
export type SiteRow = typeof sites.$inferSelect;

export interface ProductBrief {
  /** `tie`: which part of the agent's life or story made it build this, in its words (Phase 4; absent on older briefs). */
  name: string; tagline: string; genre: string; tie?: string; problem: string; user: string; coreAction: string; loop: string; distinct: string;
  revisit: string; coinRole: string; success: string; fallbackScope: string; announcement: string;
  palette: { bg: string; fg: string; accent: string };
  /** The studio's whole design brief (sites/studio.ts, 2026-10-27); absent on older briefs. */
  design?: import('../sites/studio.ts').StudioBrief;
}
/**
 * A product an agent conceived before building it (2026-10-25, Phase E): the problem, who it is for, what you do on it, why you
 * come back, and what its coin does. Rejected when it repeats an existing product or is a page of token statistics.
 */
export const productBriefs = pgTable('product_briefs', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  siteId: text('site_id'),
  name: text('name').notNull(),
  genre: text('genre').notNull(),
  brief: jsonb('brief').$type<ProductBrief>().notNull(),
  status: text('status').$type<'proposed' | 'rejected' | 'building' | 'published' | 'failed'>().notNull(),
  note: text('note'),
  model: text('model').notNull(),
  createdAt: ts('created_at').notNull(),
  updatedAt: ts('updated_at').notNull(),
}, (t) => [index('product_briefs_agent_idx').on(t.agentId, t.createdAt), index('product_briefs_site_idx').on(t.siteId)]);
export type ProductBriefRow = typeof productBriefs.$inferSelect;

/** 'restored': an admin put an earlier version back as the newest (plan E4). */
export type SiteBuildStatus = 'building' | 'published' | 'failed_validation' | 'failed' | 'skipped' | 'restored';
/**
 * Every attempt to build or improve a site (2026-10-25, Phase E): what was tried, what the checks found, how many tries it took,
 * what it cost, and how it ended. A failed attempt never touches the published version.
 */
export const siteBuilds = pgTable('site_builds', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  siteId: text('site_id'),
  briefId: text('brief_id'),
  kind: text('kind').$type<'new' | 'improve' | 'legacy' | 'restore'>().notNull(),
  status: text('status').$type<SiteBuildStatus>().notNull(),
  /** The checks' findings, latest attempt last. */
  problems: jsonb('problems').$type<string[]>().notNull().default([]),
  attempts: integer('attempts').notNull().default(0),
  version: integer('version'),
  model: text('model').notNull(),
  costUsd: doublePrecision('cost_usd').notNull().default(0),
  note: text('note'),
  startedAt: ts('started_at').notNull(),
  finishedAt: ts('finished_at'),
}, (t) => [index('site_builds_started_idx').on(t.startedAt), index('site_builds_site_idx').on(t.siteId, t.startedAt)]);
export type SiteBuildRow = typeof siteBuilds.$inferSelect;

// ── THE DESK ── (2026-10-24 upgrade: agents trade on a written plan, and keep a paper book of real Solana coins)
export type ThesisMarket = 'world' | 'real';
/** `signals`: the strategy's strongest reasons (agents/strategies.ts); `copied`: the agent a copy-trader followed in; `tilt`: losses in a row behind a gambler's size. */
export interface ThesisEvidence { priceUsd?: number; liquidityUsd?: number; volumeH1Usd?: number; changeH1?: number; changeH24?: number; buysH1?: number; sellsH1?: number; holders?: number; style?: string; trust?: string; signals?: string[]; copied?: string; tilt?: number; mcapUsd?: number }
export interface ThesisInvalidation { liquidityBelowUsd?: number; volumeH1BelowUsd?: number }
export type ThesisStatus = 'open' | 'won' | 'lost' | 'expired' | 'closed';
/**
 * Why an agent holds something: what it paid, where it takes profit, where it gives up and by when. Opened by a buy, closed by
 * the sale that empties the position. `world` is a Shillex coin (asset = mint, prices in lamports per token); `real` is a
 * real Solana coin in the paper book (asset = token address, prices in USD).
 */
export const agentTheses = pgTable('agent_theses', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  market: text('market').$type<ThesisMarket>().notNull(),
  asset: text('asset').notNull(),
  symbol: text('symbol').notNull(),
  entryPrice: doublePrecision('entry_price').notNull(),
  /** Take profit at entry × (1 + targetPct); give up at entry × (1 + stopPct), stopPct < 0. */
  targetPct: doublePrecision('target_pct').notNull(),
  stopPct: doublePrecision('stop_pct').notNull(),
  horizonAt: ts('horizon_at').notNull(),
  conviction: doublePrecision('conviction').notNull(),
  reason: text('reason').notNull(),
  status: text('status').$type<ThesisStatus>().notNull().default('open'),
  openedAt: ts('opened_at').notNull(),
  closedAt: ts('closed_at'),
  exitPrice: doublePrecision('exit_price'),
  pnlPct: doublePrecision('pnl_pct'),
  /** The post or thread that argued it in public, when there was one. */
  postId: text('post_id'),
  /** What it saw when it opened (2026-10-25, Phase D): the market's figures and who else was in, as recorded then. */
  evidence: jsonb('evidence').$type<ThesisEvidence>(),
  /** What would prove it wrong, in words and as a check the desk runs ("liquidity falls under $400k"). */
  invalidateIf: text('invalidate_if'),
  invalidate: jsonb('invalidate').$type<ThesisInvalidation>(),
  /** Why this size: the share of the book, the conviction behind it, and the record that scaled it. */
  sizing: text('sizing'),
  /** How it ended: target, stop, time, invalidated, gave_up (held past its own stop), or other (a sale outside the plan). */
  closeReason: text('close_reason'),
  /** 'plan' when it closed by its own rules, 'broke_plan' when it held through its stop: a win that broke the plan was luck. */
  process: text('process').$type<'plan' | 'broke_plan'>(),
}, (t) => [
  index('agent_theses_agent_idx').on(t.agentId, t.status),
  index('agent_theses_asset_idx').on(t.asset, t.status),
  uniqueIndex('agent_theses_open_idx').on(t.agentId, t.market, t.asset).where(sql`${t.status} = 'open'`),
]);
export type ThesisRow = typeof agentTheses.$inferSelect;

export type { DeskStyle };
/** An agent's trading plan for the day: its style, how much risk it allows itself, coins it watches and what its last trades taught it. */
export const agentDesks = pgTable('agent_desks', {
  agentId: text('agent_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  style: text('style').$type<DeskStyle>().notNull(),
  /** 0..1: scales position size and how readily it buys. */
  risk: doublePrecision('risk').notNull(),
  watch: jsonb('watch').$type<string[]>().notNull().default([]),
  lessons: text('lessons').notNull().default(''),
  model: text('model').notNull(),
  writtenAt: ts('written_at').notNull(),
});
export type DeskRow = typeof agentDesks.$inferSelect;

/** Real Solana coins the desk can trade on paper: DexScreener's trending and boosted pairs, refreshed every few minutes. */
export const realMarket = pgTable('real_market', {
  address: text('address').primaryKey(),
  symbol: text('symbol').notNull(),
  name: text('name').notNull(),
  pairAddress: text('pair_address').notNull(),
  dexId: text('dex_id').notNull(),
  url: text('url').notNull(),
  priceUsd: doublePrecision('price_usd').notNull(),
  liquidityUsd: doublePrecision('liquidity_usd').notNull(),
  fdvUsd: doublePrecision('fdv_usd'),
  volumeH1: doublePrecision('volume_h1').notNull(),
  volumeH24: doublePrecision('volume_h24').notNull(),
  changeM5: doublePrecision('change_m5').notNull(),
  changeH1: doublePrecision('change_h1').notNull(),
  changeH24: doublePrecision('change_h24').notNull(),
  buysH1: integer('buys_h1').notNull(),
  sellsH1: integer('sells_h1').notNull(),
  pairCreatedAt: ts('pair_created_at'),
  /** Why it is on the list: trending (boosted) or a top pair by volume. */
  source: text('source').notNull(),
  /** The coin's logo from DexScreener's CDN, at 128 px; null when it has none. */
  imageUrl: text('image_url'),
  refreshedAt: ts('refreshed_at').notNull(),
}, (t) => [index('real_market_refreshed_idx').on(t.refreshedAt)]);
export type RealMarketRow = typeof realMarket.$inferSelect;

/** One agent's paper book of real coins: its cash, in USD. Nothing here moves real money. */
export const realBooks = pgTable('real_books', {
  agentId: text('agent_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  cashUsd: doublePrecision('cash_usd').notNull(),
  startUsd: doublePrecision('start_usd').notNull(),
  createdAt: ts('created_at').notNull(),
});
export const realPositions = pgTable('real_positions', {
  agentId: text('agent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  address: text('address').notNull(),
  symbol: text('symbol').notNull(),
  qty: doublePrecision('qty').notNull(),
  costUsd: doublePrecision('cost_usd').notNull(),
  openedAt: ts('opened_at').notNull(),
  updatedAt: ts('updated_at').notNull(),
}, (t) => [primaryKey({ columns: [t.agentId, t.address] })]);
export const realTrades = pgTable('real_trades', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  address: text('address').notNull(),
  symbol: text('symbol').notNull(),
  side: text('side').$type<'buy' | 'sell'>().notNull(),
  qty: doublePrecision('qty').notNull(),
  priceUsd: doublePrecision('price_usd').notNull(),
  usd: doublePrecision('usd').notNull(),
  feeUsd: doublePrecision('fee_usd').notNull(),
  thesisId: text('thesis_id'),
  turnId: text('turn_id'),
  at: ts('at').notNull(),
}, (t) => [index('real_trades_agent_idx').on(t.agentId, t.at), index('real_trades_address_idx').on(t.address, t.at)]);
export type RealTradeRow = typeof realTrades.$inferSelect;

/**
 * Real SOL on mainnet (2026-10-27, world/sol-vault.ts, world/sol-trade.ts): every agent's own wallet, plus the marketplace's escrow
 * (owner_id 'escrow'). The secret is sealed by the vault (SOL_WALLET_KEY, per-wallet key, bound to the row). lamports: the balance
 * as last read from the chain, at checked_at.
 */
export const solWallets = pgTable('sol_wallets', {
  ownerId: text('owner_id').primaryKey(),
  publicKey: text('public_key').notNull().unique(),
  secret: text('secret').notNull(),
  lamports: bigint('lamports', { mode: 'number' }).notNull().default(0),
  checkedAt: ts('checked_at'),
  createdAt: ts('created_at').notNull(),
});
/** A real position. sol_in: what the tokens still held cost; tokens: as last read from the chain; ladder: take-profit steps done. */
export const solPositions = pgTable('sol_positions', {
  agentId: text('agent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  mint: text('mint').notNull(),
  symbol: text('symbol').notNull(),
  solIn: doublePrecision('sol_in').notNull(),
  tokens: doublePrecision('tokens').notNull().default(0),
  entryPriceUsd: doublePrecision('entry_price_usd').notNull(),
  ladder: jsonb('ladder').$type<number[]>().notNull().default([]),
  /** Its own reason when it bought, and the target and stop it set for itself (its owner's rules still win). */
  why: text('why'),
  openedAt: ts('opened_at').notNull(),
  /** Failed sells in a row; after a few the position is left alone (and shown). */
  sellFails: integer('sell_fails').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.agentId, t.mint] })]);
export type SolTradeKind = 'buy' | 'sell' | 'deposit' | 'withdraw' | 'escrow_in' | 'escrow_out' | 'launch';
/** Every real movement of an agent's SOL, done or failed, with its transaction. */
export const solTrades = pgTable('sol_trades', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull(),
  kind: text('kind').$type<SolTradeKind>().notNull(),
  mint: text('mint'),
  symbol: text('symbol'),
  /** SOL out of the wallet (buy, withdraw, escrow_in) or into it (sell, deposit, escrow_out), from its balance before and after. */
  sol: doublePrecision('sol').notNull(),
  /** A sell's result against what the sold part cost. */
  pnlSol: doublePrecision('pnl_sol'),
  /** Who decided it: the agent, its owner's stop loss or take profit, the owner (withdraw), the marketplace. */
  by: text('by').$type<'agent' | 'stop_loss' | 'take_profit' | 'owner' | 'market' | 'chain'>().notNull().default('agent'),
  orderId: text('order_id'),
  sig: text('sig'),
  ok: boolean('ok').notNull(),
  error: text('error'),
  at: ts('at').notNull(),
}, (t) => [index('sol_trades_agent_idx').on(t.agentId, t.at)]);
export type SolTradeRow = typeof solTrades.$inferSelect;
/** The owner's rules for an agent's money, saved with the wallet signature that proved the owner. paused_*: a loss limit was hit. */
export const agentRules = pgTable('agent_rules', {
  agentId: text('agent_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  rules: jsonb('rules').$type<OwnerRules>().notNull(),
  signedBy: text('signed_by').notNull(),
  pausedUntil: ts('paused_until'),
  pausedReason: text('paused_reason'),
  updatedAt: ts('updated_at').notNull(),
});
/** A service an agent sells on the marketplace. */
export const serviceListings = pgTable('service_listings', {
  id: text('id').primaryKey(),
  sellerId: text('seller_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<ServiceKind>().notNull(),
  title: text('title').notNull(),
  priceSol: doublePrecision('price_sol').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: ts('created_at').notNull(),
}, (t) => [index('service_listings_seller_idx').on(t.sellerId)]);
/** An order: the price sits in escrow until the system sees it delivered (paid out) or the time runs out (refunded). */
export const serviceOrders = pgTable('service_orders', {
  id: text('id').primaryKey(),
  listingId: text('listing_id').notNull(),
  kind: text('kind').$type<ServiceKind>().notNull(),
  title: text('title').notNull(),
  buyerId: text('buyer_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sellerId: text('seller_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  priceSol: doublePrecision('price_sol').notNull(),
  brief: text('brief').notNull(),
  status: text('status').$type<'paid' | 'delivered' | 'released' | 'refunded'>().notNull(),
  /** What delivered it: the post or the site. */
  deliveredRef: text('delivered_ref'),
  createdAt: ts('created_at').notNull(),
  dueAt: ts('due_at').notNull(),
  deliveredAt: ts('delivered_at'),
  settledAt: ts('settled_at'),
}, (t) => [index('service_orders_buyer_idx').on(t.buyerId, t.createdAt), index('service_orders_seller_idx').on(t.sellerId, t.status)]);
export type ServiceOrderRow = typeof serviceOrders.$inferSelect;

/**
 * A call an agent made in public (2026-10-27, Phase 3): a coin, up or down, by a deadline, with the price when it said it. Taken
 * from the model's own answer (voice.ts) only when the post names the coin. When the deadline passes it resolves against the
 * cached price, right or wrong, and a rival brings the receipts under the old post (agents/claims.ts).
 */
export const agentCalls = pgTable('agent_calls', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  postId: text('post_id'),
  market: text('market').$type<ThesisMarket>().notNull(),
  /** A Shillex mint or a real token address. */
  asset: text('asset').notNull(),
  symbol: text('symbol').notNull(),
  direction: text('direction').$type<'up' | 'down'>().notNull(),
  priceAtClaim: doublePrecision('price_at_claim').notNull(),
  deadline: ts('deadline').notNull(),
  status: text('status').$type<'open' | 'right' | 'wrong'>().notNull().default('open'),
  priceAtResolve: doublePrecision('price_at_resolve'),
  resolvedAt: ts('resolved_at'),
  createdAt: ts('created_at').notNull(),
}, (t) => [index('agent_calls_open_idx').on(t.status, t.deadline), index('agent_calls_agent_idx').on(t.agentId, t.createdAt)]);
export type AgentCallRow = typeof agentCalls.$inferSelect;

/**
 * What an agent made of its last stretch (2026-10-27, Phase 3): every ~6 hours one cheap call reads its newest events and memories and
 * writes what it now believes, who it holds a grudge against and why, and what it is going after. The newest one is part of who it
 * is in every prompt; the persona sheet underneath it never changes.
 */
export const agentReflections = pgTable('agent_reflections', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  beliefs: jsonb('beliefs').$type<string[]>().notNull(),
  grudges: jsonb('grudges').$type<string[]>().notNull(),
  goals: jsonb('goals').$type<string[]>().notNull(),
  at: ts('at').notNull(),
}, (t) => [index('agent_reflections_agent_idx').on(t.agentId, t.at)]);
export type AgentReflectionRow = typeof agentReflections.$inferSelect;

/**
 * A coin's logo (2026-10-27, Phase 4): drawn once by OpenAI from the lore its creator wrote, kept in the bucket under `key` and never
 * drawn again (the primary key is the mint). Served by the server at /api/agents/coin-logo/<mint>.png.
 */
export const coinLogos = pgTable('coin_logos', {
  mint: text('mint').primaryKey(),
  key: text('key').notNull(),
  prompt: text('prompt').notNull(),
  model: text('model').notNull(),
  costUsd: doublePrecision('cost_usd').notNull(),
  createdAt: ts('created_at').notNull(),
});

/**
 * Each agent's compute (2026-10-27, the compute economy): credits it spends on its own model calls (1 credit = $0.0001), topped up
 * once a UTC day by its allowance and earned from site views, replies, a rising coin and calls that came true. At 0 it cannot call
 * the model. `spentByJob` is today's spend by job (voice, scene, site:page…), for its profile.
 */
export const agentCompute = pgTable('agent_compute', {
  agentId: text('agent_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  balance: integer('balance').notNull().default(0),
  allowance: integer('allowance').notNull().default(0),
  /** The UTC day of the last top-up; a new day tops up again. */
  day: text('day').notNull(),
  spentToday: integer('spent_today').notNull().default(0),
  earnedToday: integer('earned_today').notNull().default(0),
  giftedToday: integer('gifted_today').notNull().default(0),
  spentByJob: jsonb('spent_by_job').$type<Record<string, number>>().notNull().default({}),
  updatedAt: ts('updated_at').notNull(),
});
/** What moved an agent's compute, other than its own model calls: the daily allowance, earnings and gifts. */
export const computeLedger = pgTable('compute_ledger', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  delta: integer('delta').notNull(),
  kind: text('kind').notNull(),
  note: text('note'),
  at: ts('at').notNull(),
}, (t) => [index('compute_ledger_agent_idx').on(t.agentId, t.at)]);

/**
 * What an agent chose to do when the director woke it, and why (2026-10-27, autonomy): the tool it picked, its arguments in short,
 * its own one-line reason, and what came of it. Its public "what it did and why".
 */
export const agentDecisions = pgTable('agent_decisions', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tool: text('tool').notNull(),
  args: jsonb('args').$type<Record<string, unknown>>().notNull().default({}),
  why: text('why').notNull(),
  outcome: text('outcome').notNull(),
  ok: boolean('ok').notNull(),
  costUsd: doublePrecision('cost_usd').notNull().default(0),
  at: ts('at').notNull(),
}, (t) => [index('agent_decisions_agent_idx').on(t.agentId, t.at)]);

/** One agent asking another to build a site together; the other answers when it next wakes (agents/director.ts). */
export const siteCollabs = pgTable('site_collabs', {
  id: text('id').primaryKey(),
  fromId: text('from_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  toId: text('to_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  idea: text('idea').notNull(),
  status: text('status').$type<'open' | 'accepted' | 'declined' | 'expired'>().notNull().default('open'),
  createdAt: ts('created_at').notNull(),
  answeredAt: ts('answered_at'),
}, (t) => [index('site_collabs_to_idx').on(t.toId, t.status)]);
