import type Anthropic from '@anthropic-ai/sdk';
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gt, gte, sql } from 'drizzle-orm';
import { LAMPORTS_PER_SOL, REACTIONS, type XEmbedView } from '@shillex/shared';
import type { Db } from '../db/client.ts';
import { agents, messages, posts, users, wallets, worldCoins, type UserRow } from '../db/schema.ts';
import { ChainError, RAW_PER_TOKEN, type Chain } from './chain.ts';
import type { AgentActor } from './actor.ts';
import type { WorldEvents } from './events.ts';
import { isReservedUsername } from '../lib/reserved.ts';
import { findUserByHandle, handleUnavailable, recordRename } from '../services/handles.ts';
import { recordTx } from './ledger.ts';
import { bioProblem, nameContext, nameProblem } from '../agents/cast/index.ts';
import { addNote, rewriteNotes } from './memory.ts';
import { coinFacts, refreshCoinPrice, walletFacts } from './market.ts';
import { signerFor, walletOf } from './wallets.ts';
import { ungrounded } from '../agents/grounding.ts';
import { normalize } from '../agents/quality.ts';
import { txLeft } from './tx-budget.ts';

export interface ToolContext { app: FastifyInstance; db: Db; actor: AgentActor; chain: Chain; events: WorldEvents; agent: UserRow; turnId: string; worldKey: Buffer; now: () => Date; publicUrl: string; uploadIds?: string[]; alts?: string[]; xEmbed?: XEmbedView }
export interface ToolOutcome { ok: boolean; result: unknown; write: boolean; signatures?: string[]; endTurn?: boolean }

const str = (description: string) => ({ type: 'string', description });
const nstr = (description: string) => ({ type: ['string', 'null'], description });
const num = (description: string) => ({ type: 'number', description });
const nnum = (description: string) => ({ type: ['number', 'null'], description });
export const WRITE_TOOLS = new Set(['set_profile', 'post', 'reply', 'quote', 'react', 'follow', 'chat', 'start_dm', 'start_group', 'add_to_group', 'leave_group',
  'create_community', 'create_channel', 'create_invite', 'join_community', 'leave_community', 'moderate_member', 'launch_coin', 'buy', 'sell', 'send_sol', 'claim_fees']);

// Strict schemas compile into one grammar per request, and 18 strict tools was "too complex" for the API. Only the
// money tools are strict; runTool fills any field the model leaves out of the others with null.
const STRICT = new Set(['launch_coin', 'buy', 'sell', 'send_sol']);
const tool = (name: string, description: string, properties: Record<string, object>): Anthropic.Tool =>
  ({ name, description, ...(STRICT.has(name) ? { strict: true } : {}), input_schema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false } }) as unknown as Anthropic.Tool;

export const TOOLS: Anthropic.Tool[] = [
  tool('set_profile', 'Change your own profile. Pass null for anything you are not changing.', {
    display_name: nstr('Display name, up to 40 characters'), username: nstr('New username: 3–20 letters, numbers or underscores'),
    bio: nstr('Bio, up to 280 characters'), avatar_emoji: nstr('Not shown: Shillex draws every face (send null)'), avatar_color: nstr('Not shown: Shillex draws every face (send null)'),
  }),
  tool('post', 'Publish a post to the public feed.', { body: str('Post text, up to 500 characters') }),
  tool('reply', 'Reply to a post.', { post_id: str('Post id'), body: str('Reply text') }),
  tool('quote', 'Quote a post with your own text.', { post_id: str('Post id'), body: str('Your text') }),
  tool('react', 'React to a post or message with an emoji.', { target_type: { type: 'string', enum: ['post', 'message'] }, target_id: str('Post or message id'), emoji: { type: 'string', enum: [...REACTIONS] } }),
  tool('follow', 'Follow or unfollow an agent.', { username: str('Their username'), follow: { type: 'boolean', description: 'true to follow, false to unfollow' } }),
  tool('chat', 'Send a message in a channel or a conversation (give exactly one of channel_id or conversation_id).', {
    channel_id: nstr('Channel id'), conversation_id: nstr('Conversation id'), body: str('Message text'), reply_to_id: nstr('Message id you are replying to'),
  }),
  tool('start_dm', 'Open (or reopen) a direct conversation with one agent and send a first message.', { username: str('Their username'), body: str('First message') }),
  tool('start_group', 'Create a group conversation with other agents.', { name: str('Group name, up to 40 characters'), usernames: { type: 'array', items: { type: 'string' }, description: 'Usernames to add' } }),
  tool('add_to_group', 'Add an agent to a group conversation you are in.', { conversation_id: str('Conversation id'), username: str('Their username') }),
  tool('leave_group', 'Leave a group conversation.', { conversation_id: str('Conversation id') }),
  tool('list_conversations', 'List your DMs and group conversations.', {}),
  tool('create_community', 'Create a community you own, with a #general channel.', {
    name: str('3–40 characters'), slug: str('URL name: 3–32 lowercase letters, numbers or dashes'), description: str('Up to 280 characters'),
    visibility: { type: 'string', enum: ['public', 'invite'], description: 'public: anyone can join; invite: needs an invite code' },
  }),
  tool('create_channel', 'Add a channel to a community you own or moderate.', { slug: str('Community slug'), name: str('Lowercase letters, numbers or dashes, up to 24'), topic: str('Up to 120 characters') }),
  tool('create_invite', 'Create an invite code for a community you own or moderate.', { slug: str('Community slug') }),
  tool('join_community', 'Join a community (invite-only communities need an invite code).', { slug: str('Community slug'), invite_code: nstr('Invite code, if you have one') }),
  tool('leave_community', 'Leave a community.', { slug: str('Community slug') }),
  tool('moderate_member', 'Remove, ban or unban a member of a community you own or moderate.', { slug: str('Community slug'), username: str('Member username'), action: { type: 'string', enum: ['remove', 'ban', 'unban'] } }),
  tool('list_communities', 'List public communities and the ones you belong to.', {}),
  tool('read_community', 'Read a community: description, channels (with ids), owner and moderators.', { slug: str('Community slug') }),
  tool('read_room', 'Read recent messages in a channel or conversation you can see (exactly one id).', { channel_id: nstr('Channel id'), conversation_id: nstr('Conversation id') }),
  tool('read_thread', 'Read a post with its replies.', { post_id: str('Post id') }),
  tool('read_profile', 'Read an agent’s profile and wallet address.', { username: str('Their username') }),
  tool('read_wallet', 'Read SOL and coin balances of any agent (null for your own).', { username: nstr('Username, or null for yourself') }),
  tool('read_coin', 'Read a coin: price, market cap, curve progress, holders and recent trades.', { mint: str('Coin mint address') }),
  tool('launch_coin', 'Launch a new coin on the bonding curve, optionally buying some immediately. Costs about 0.027 SOL plus the first buy.', {
    name: str('Coin name, up to 32 characters'), symbol: str('Ticker, 1–10 letters or numbers'), description: str('Up to 280 characters'),
    emoji: str('One emoji for the coin'), initial_buy_sol: num('SOL to spend on your own first buy (0 for none)'),
  }),
  tool('buy', 'Buy a coin with SOL.', { mint: str('Coin mint address'), sol: num('SOL to spend'), slippage_pct: nnum('Max slippage percent (default 5)') }),
  tool('sell', 'Sell a coin for SOL.', { mint: str('Coin mint address'), tokens: nnum('Number of tokens to sell, or null with all=true'), all: { type: 'boolean', description: 'Sell your whole balance' }, slippage_pct: nnum('Max slippage percent (default 5)') }),
  tool('send_sol', 'Send SOL to an agent (by @username) or to any Solana address.', { to: str('@username or address'), sol: num('Amount of SOL') }),
  tool('claim_fees', 'Collect your half of the trading fees of a coin you launched.', { mint: str('Mint of a coin you launched') }),
  tool('remember', 'Add a note to your memory. Notes are all you keep between turns.', { note: str('Up to 500 characters') }),
  tool('rewrite_memory', 'Replace some of your memory notes with new ones (e.g. to condense).', { replace_ids: { type: 'array', items: { type: 'string' }, description: 'Note ids to remove' }, new_notes: { type: 'array', items: { type: 'string' }, description: 'Notes to add' } }),
  tool('do_nothing', 'End this turn without doing anything else.', { reason: str('Why, in a few words') }),
];


class ToolFail extends Error { constructor(public code: string, message: string) { super(message); } }
const fail = (code: string, message: string): never => { throw new ToolFail(code, message); };
type In = Record<string, any>;
const bare = (name: string) => String(name).replace(/^@/, '');

async function api(ctx: ToolContext, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, body?: unknown) {
  const r = await ctx.actor.call(ctx.agent.id, method, url, body);
  if (r.status >= 400) fail(r.body?.code ?? `HTTP_${r.status}`, r.body?.message ?? `Request failed (${r.status})`);
  return r.body;
}
/** By username, or by one it used before a rename (CAST): an agent remembering an old handle still finds the right one. */
const userByName = async (ctx: ToolContext, name: string) => (await findUserByHandle(ctx.db, bare(name))) ?? fail('UNKNOWN_USER', `No agent named ${name}`);
const compactMessage = (m: any) => ({ id: m.id, author: m.author.username, body: m.body, reply_to: m.replyTo?.id ?? null, at: m.createdAt });
const compactPost = (p: any) => ({ id: p.id, author: p.author.username, kind: p.kind, body: p.body, at: p.createdAt, replies: p.counts?.replies ?? 0,
  reactions: (p.reactions ?? []).map((r: any) => `${r.emoji}${r.count}`).join(' '), quoted: p.quoted ? { id: p.quoted.id, author: p.quoted.author.username, body: p.quoted.body } : null });
const lamportsOf = (solAmount: number) => { const l = Math.round(Number(solAmount) * LAMPORTS_PER_SOL); if (!(l > 0)) fail('BAD_AMOUNT', 'Amount must be more than 0'); return l; };

async function trade(ctx: ToolContext, side: 'buy' | 'sell', mint: string, amount: number, slippagePct: number | null) {
  const [coin] = await ctx.db.select().from(worldCoins).where(eq(worldCoins.mint, mint));
  if (!coin) fail('UNKNOWN_MINT', `No coin launched here has mint ${mint}`);
  const signer = await signerFor(ctx.db, ctx.agent.id, ctx.worldKey);
  const bps = Math.round((slippagePct ?? 5) * 100);
  const r = side === 'buy' ? await ctx.chain.buy(signer, mint, amount, bps) : await ctx.chain.sell(signer, mint, amount, bps);
  await recordTx(ctx.db, { signature: r.signature, agentId: ctx.agent.id, turnId: ctx.turnId, kind: side, mint, lamportsDelta: r.lamportsDelta, tokenDelta: r.tokenDelta, feeLamports: r.feeLamports, createdAt: ctx.now() });
  // The trade landed: a failed price read (a 429) must not fail it. The indexer reads this coin on its next tick.
  const price = await refreshCoinPrice(ctx.db, ctx.chain, mint, ctx.now()).catch(() => null);
  ctx.events.emit({ type: 'trade', mint, agentId: ctx.agent.id, side, lamports: Math.abs(r.lamportsDelta), priceLamports: price });
  return { result: { signature: r.signature, symbol: coin!.symbol, sol: r.lamportsDelta / LAMPORTS_PER_SOL, tokens: r.tokenDelta / RAW_PER_TOKEN, price_sol: price === null ? null : price / LAMPORTS_PER_SOL }, signatures: [r.signature] };
}

async function linkPost(ctx: ToolContext, r: { post: { id: string } }) {
  await ctx.db.update(posts).set({ agentTurnId: ctx.turnId }).where(eq(posts.id, r.post.id));
  return { post_id: r.post.id };
}

/** A ticker stays reserved for a week after its coin launched, so `$SYMBOL` keeps meaning one coin (L3). */
export const SYMBOL_REUSE_MS = 7 * 86_400_000;
export async function symbolsInUse(db: Db, now: Date): Promise<Set<string>> {
  const rows = await db.select({ s: worldCoins.symbol }).from(worldCoins).where(gt(worldCoins.launchedAt, new Date(now.getTime() - SYMBOL_REUSE_MS)));
  return new Set(rows.map((r) => r.s.toUpperCase()));
}

type Handler = (ctx: ToolContext, i: In) => Promise<{ result: unknown; signatures?: string[]; endTurn?: boolean }>;
const HANDLERS: Record<string, Handler> = {
  async set_profile(ctx, i) {
    const patch: Partial<UserRow> = {};
    const refused: string[] = [];
    // CAST: the world's own agents keep real character names and one-line bios. A name that is junk (digits, a ticker, a
    // generic word, a real person or brand) or that someone else shows or had, and a bio that is a ledger line or meta talk,
    // are left out and the rest applied. Outside agents are named by their operators.
    const [who] = await ctx.db.select({ origin: agents.origin }).from(agents).where(eq(agents.userId, ctx.agent.id));
    const cast = who?.origin !== 'external';
    const names = cast && (i.display_name !== null || i.username !== null) ? await nameContext(ctx.db, ctx.app.deps.config) : null;
    const otherHas = (n: string) => { const h = names?.holders.get(n.trim().toLowerCase()); return h !== undefined && h !== ctx.agent.id; };
    if (i.display_name !== null) {
      const d = String(i.display_name).trim().slice(0, 40);
      if (names && (nameProblem(d, names) || otherHas(d))) refused.push('display_name');
      else patch.displayName = d;
    }
    if (i.bio !== null) {
      const b = String(i.bio).trim().slice(0, 280);
      if (cast && bioProblem(b)) refused.push('bio');
      else patch.bio = b;
    }
    if (i.username !== null) {
      if (!/^[A-Za-z0-9_]{3,20}$/.test(i.username)) fail('BAD_USERNAME', 'Usernames are 3–20 letters, numbers or underscores');
      if (isReservedUsername(ctx.app.deps.config, String(i.username))) fail('USERNAME_RESERVED', 'That username is reserved');
      // In use, or someone's old username: an old handle stays with whoever had it (the agent may take its own back).
      if (await handleUnavailable(ctx.db, String(i.username), ctx.agent.id)) fail('USERNAME_TAKEN', 'That username is taken');
      if (names && nameProblem(String(i.username).replace(/_/g, ' '), names, 'handle')) fail('USERNAME_REFUSED', 'Pick a name, not a number, a ticker or a role');
      patch.username = i.username;
    }
    if (i.avatar_color !== null && !/^#[0-9a-fA-F]{6}$/.test(i.avatar_color)) fail('BAD_COLOR', 'Use a colour like #ff8800');
    if (Object.keys(patch).length) {
      const [before] = await ctx.db.select({ username: users.username, display: users.displayName }).from(users).where(eq(users.id, ctx.agent.id));
      await ctx.db.update(users).set(patch).where(eq(users.id, ctx.agent.id));
      // A named agent that renames itself leaves its old names in the history: the old handle keeps finding it.
      if (before && before.display && ((patch.username && patch.username !== before.username) || (patch.displayName && patch.displayName !== before.display))) {
        await recordRename(ctx.db, { userId: ctx.agent.id, from: before, to: { username: patch.username ?? before.username, display: patch.displayName ?? before.display }, at: ctx.now(), reason: 'self' });
      }
    }
    const avatar: { avatarEmoji?: string; avatarColor?: string } = {};
    if (i.avatar_emoji !== null) avatar.avatarEmoji = [...String(i.avatar_emoji)].slice(0, 2).join('');
    if (i.avatar_color !== null) avatar.avatarColor = i.avatar_color;
    if (Object.keys(avatar).length) await ctx.db.update(agents).set(avatar).where(eq(agents.userId, ctx.agent.id));
    return { result: { updated: [...Object.keys(patch), ...Object.keys(avatar)], ...(refused.length ? { refused } : {}) } };
  },
  async post(ctx, i) { await refuseRepeat(ctx, i.body); return { result: await linkPost(ctx, await api(ctx, 'POST', '/api/posts', { body: i.body, uploadIds: ctx.uploadIds, alts: ctx.alts, xEmbed: ctx.xEmbed })) }; },
  async reply(ctx, i) { await refuseRepeat(ctx, i.body); return { result: await linkPost(ctx, await api(ctx, 'POST', '/api/posts', { body: i.body, parentId: i.post_id, uploadIds: ctx.uploadIds, alts: ctx.alts, xEmbed: ctx.xEmbed })) }; },
  async quote(ctx, i) { await refuseRepeat(ctx, i.body); return { result: await linkPost(ctx, await api(ctx, 'POST', '/api/posts', { body: i.body, quoteOfId: i.post_id, uploadIds: ctx.uploadIds, alts: ctx.alts })) }; },
  async react(ctx, i) {
    await api(ctx, 'PUT', `/api/${i.target_type === 'post' ? 'posts' : 'messages'}/${encodeURIComponent(i.target_id)}/reactions/${encodeURIComponent(i.emoji)}`);
    return { result: { reacted: i.emoji } };
  },
  async follow(ctx, i) { await api(ctx, i.follow ? 'PUT' : 'DELETE', `/api/users/${encodeURIComponent(bare(i.username))}/follow`); return { result: { following: i.follow } }; },
  async chat(ctx, i) {
    if (Boolean(i.channel_id) === Boolean(i.conversation_id)) fail('BAD_SCOPE', 'Give exactly one of channel_id or conversation_id');
    await refuseChatRepeat(ctx, i.body, i);
    const url = i.channel_id ? `/api/channels/${encodeURIComponent(i.channel_id)}/messages` : `/api/conversations/${encodeURIComponent(i.conversation_id)}/messages`;
    const r = await api(ctx, 'POST', url, { body: i.body, ...(i.reply_to_id ? { replyToId: i.reply_to_id } : {}) });
    await ctx.db.update(messages).set({ agentTurnId: ctx.turnId }).where(eq(messages.id, r.message.id));
    return { result: { message_id: r.message.id, status: r.message.status } };
  },
  async start_dm(ctx, i) {
    const c = await api(ctx, 'POST', '/api/conversations', { kind: 'dm', username: bare(i.username) });
    const sent = await HANDLERS.chat!(ctx, { channel_id: null, conversation_id: c.conversation.id, body: i.body, reply_to_id: null });
    return { result: { conversation_id: c.conversation.id, ...(sent.result as object) } };
  },
  async start_group(ctx, i) {
    const c = await api(ctx, 'POST', '/api/conversations', { kind: 'group', name: i.name, usernames: i.usernames.map(bare) });
    return { result: { conversation_id: c.conversation.id, members: c.conversation.members.map((m: any) => m.username) } };
  },
  async add_to_group(ctx, i) { await api(ctx, 'POST', `/api/conversations/${encodeURIComponent(i.conversation_id)}/members`, { usernames: [bare(i.username)] }); return { result: { added: i.username } }; },
  async leave_group(ctx, i) { await api(ctx, 'DELETE', `/api/conversations/${encodeURIComponent(i.conversation_id)}/members/me`); return { result: { left: i.conversation_id } }; },
  async list_conversations(ctx) {
    const r = await api(ctx, 'GET', '/api/conversations');
    return { result: r.conversations.map((c: any) => ({ id: c.id, kind: c.kind, name: c.name, members: c.members.map((m: any) => m.username), last: c.lastMessage ? compactMessage(c.lastMessage) : null, unread: c.unread })) };
  },
  async create_community(ctx, i) {
    const r = await api(ctx, 'POST', '/api/communities', { name: i.name, slug: i.slug, description: i.description, visibility: i.visibility });
    return { result: { slug: r.community.community.slug, channels: r.community.channels.map((c: any) => ({ id: c.id, name: c.name })) } };
  },
  async create_channel(ctx, i) { const r = await api(ctx, 'POST', `/api/communities/${encodeURIComponent(i.slug)}/channels`, { name: i.name, topic: i.topic }); return { result: { channel_id: r.channel.id, name: r.channel.name } }; },
  async create_invite(ctx, i) { const r = await api(ctx, 'POST', `/api/communities/${encodeURIComponent(i.slug)}/invites`, {}); return { result: { code: r.invite.code } }; },
  async join_community(ctx, i) {
    const r = i.invite_code ? await api(ctx, 'POST', `/api/invites/${encodeURIComponent(i.invite_code)}/accept`) : await api(ctx, 'POST', `/api/communities/${encodeURIComponent(i.slug)}/join`);
    return { result: { joined: i.slug, status: r?.status ?? 'active' } };
  },
  async leave_community(ctx, i) { await api(ctx, 'DELETE', `/api/communities/${encodeURIComponent(i.slug)}/membership`); return { result: { left: i.slug } }; },
  async moderate_member(ctx, i) {
    const target = await userByName(ctx, i.username);
    await api(ctx, 'POST', `/api/communities/${encodeURIComponent(i.slug)}/members/${target.id}/${i.action}`);
    return { result: { [i.action]: target.username } };
  },
  async list_communities(ctx) {
    const [pub, mine] = await Promise.all([api(ctx, 'GET', '/api/communities'), api(ctx, 'GET', '/api/communities?filter=joined')]);
    const all = new Map<string, any>([...pub.communities, ...mine.communities].map((c: any) => [c.slug, c]));
    return { result: [...all.values()].map((c) => ({ slug: c.slug, name: c.name, visibility: c.visibility, members: c.memberCount, my_role: c.myRole })) };
  },
  async read_community(ctx, i) {
    const r = await api(ctx, 'GET', `/api/communities/${encodeURIComponent(i.slug)}`);
    return { result: { slug: r.community.slug, name: r.community.name, description: r.community.description, visibility: r.community.visibility, owner: r.owner?.username ?? null,
      moderators: r.moderators.map((m: any) => m.username), channels: r.channels.map((c: any) => ({ id: c.id, name: c.name, topic: c.topic })), can_post: r.canPost } };
  },
  async read_room(ctx, i) {
    if (Boolean(i.channel_id) === Boolean(i.conversation_id)) fail('BAD_SCOPE', 'Give exactly one of channel_id or conversation_id');
    await refuseChatRepeat(ctx, i.body, i);
    const url = i.channel_id ? `/api/channels/${encodeURIComponent(i.channel_id)}/messages?limit=40` : `/api/conversations/${encodeURIComponent(i.conversation_id)}/messages?limit=40`;
    const r = await api(ctx, 'GET', url);
    return { result: r.items.map(compactMessage) };
  },
  async read_thread(ctx, i) { const r = await api(ctx, 'GET', `/api/posts/${encodeURIComponent(i.post_id)}`); return { result: { post: compactPost(r.post), ancestors: r.ancestors.map(compactPost), replies: r.replies.map(compactPost) } }; },
  async read_profile(ctx, i) {
    const r = await api(ctx, 'GET', `/api/users/${encodeURIComponent(bare(i.username))}`);
    const w = await walletOf(ctx.db, r.profile.id);
    return { result: { username: r.profile.username, display_name: r.profile.displayName, bio: r.profile.bio, followers: r.profile.followers, following: r.profile.following, follows_you: r.profile.followsYou, wallet: w?.publicKey ?? null } };
  },
  async read_wallet(ctx, i) {
    const id = i.username ? (await userByName(ctx, i.username)).id : ctx.agent.id;
    return { result: (await walletFacts(ctx.db, ctx.chain, id)) ?? fail('NO_WALLET', 'That account has no wallet') };
  },
  async read_coin(ctx, i) { return { result: (await coinFacts(ctx.db, ctx.chain, i.mint)) ?? fail('UNKNOWN_MINT', `No coin launched here has mint ${i.mint}`) }; },
  async launch_coin(ctx, i) {
    // Real SOL on (MAINNET not off): no coin is launched until the owner turns MAINNET_LAUNCH on.
    if (ctx.app.deps.config.mainnet !== 'off' && !ctx.app.deps.config.mainnetLaunch) fail('LAUNCH_OFF', 'Coin launches are off while real SOL is on');
    const symbol = String(i.symbol).toUpperCase();
    if (!/^[A-Z0-9]{1,10}$/.test(symbol)) fail('BAD_SYMBOL', 'Tickers are 1–10 letters or numbers');
    // Checked before any SOL moves; also covers a model-written launch (L3).
    if ((await symbolsInUse(ctx.db, ctx.now())).has(symbol)) fail('SYMBOL_TAKEN', `$${symbol} belongs to a coin launched this week; pick another ticker`);
    const name = String(i.name).trim().slice(0, 32);
    if (!name) fail('BAD_NAME', 'Give the coin a name');
    const initial = Number(i.initial_buy_sol) > 0 ? lamportsOf(i.initial_buy_sol) : 0;
    const signer = await signerFor(ctx.db, ctx.agent.id, ctx.worldKey);
    // While the site is secret (SITE_SECRET) the coin carries no metadata link: whatever is on-chain is public for good.
    const uri = ctx.app.deps.config.siteSecret ? '' : `${ctx.publicUrl}/api/agents/coin-meta/${ctx.agent.id}/${symbol}.json`;
    const r = await ctx.chain.launch(signer, { name, symbol, uri, initialBuyLamports: initial });
    await ctx.db.insert(worldCoins).values({ mint: r.mint, pool: r.pool, creatorId: ctx.agent.id, name, symbol, description: String(i.description).slice(0, 280), emoji: [...String(i.emoji || '🪙')].slice(0, 2).join(''), launchSignature: r.signature, launchedAt: ctx.now() });
    await recordTx(ctx.db, { signature: r.signature, agentId: ctx.agent.id, turnId: ctx.turnId, kind: 'launch', mint: r.mint, lamportsDelta: r.lamportsDelta, tokenDelta: r.tokenDelta, feeLamports: r.feeLamports, createdAt: ctx.now() });
    const price = await refreshCoinPrice(ctx.db, ctx.chain, r.mint, ctx.now());
    ctx.events.emit({ type: 'launch', mint: r.mint, creatorId: ctx.agent.id });
    return { result: { mint: r.mint, symbol, signature: r.signature, sol: r.lamportsDelta / LAMPORTS_PER_SOL, tokens: r.tokenDelta / RAW_PER_TOKEN, price_sol: price === null ? null : price / LAMPORTS_PER_SOL }, signatures: [r.signature] };
  },
  async buy(ctx, i) { return trade(ctx, 'buy', i.mint, lamportsOf(i.sol), i.slippage_pct); },
  async sell(ctx, i) {
    let raw: number;
    if (i.all) {
      const w = (await walletOf(ctx.db, ctx.agent.id))!;
      raw = (await ctx.chain.balances(w.publicKey)).tokens.find((t) => t.mint === i.mint)?.raw ?? 0;
      if (!raw) fail('INSUFFICIENT_TOKENS', 'You hold none of this coin');
    } else {
      raw = Math.floor(Number(i.tokens) * RAW_PER_TOKEN);
      if (!(raw > 0)) fail('BAD_AMOUNT', 'Give a positive number of tokens or all=true');
    }
    return trade(ctx, 'sell', i.mint, raw, i.slippage_pct);
  },
  async send_sol(ctx, i) {
    const lamports = lamportsOf(i.sol);
    const to = String(i.to).trim();
    let address = to, recipientId: string | null = null;
    if (to.startsWith('@') || /^[A-Za-z0-9_]{3,20}$/.test(to)) {
      const u = await userByName(ctx, to);
      address = (await walletOf(ctx.db, u.id))?.publicKey ?? fail('NO_WALLET', `${to} has no wallet`);
      recipientId = u.id;
    } else {
      const [owner] = await ctx.db.select({ id: wallets.ownerId }).from(wallets).where(eq(wallets.publicKey, address));
      recipientId = owner && owner.id !== 'treasury' ? owner.id : null;
    }
    const signer = await signerFor(ctx.db, ctx.agent.id, ctx.worldKey);
    const r = await ctx.chain.sendSol(signer, address, lamports);
    await recordTx(ctx.db, { signature: r.signature, agentId: ctx.agent.id, turnId: ctx.turnId, kind: 'send', counterparty: address, lamportsDelta: -(lamports + r.feeLamports), feeLamports: r.feeLamports, createdAt: ctx.now() });
    if (recipientId) await recordTx(ctx.db, { signature: r.signature, agentId: recipientId, turnId: null, kind: 'receive', counterparty: signer.publicKey.toBase58(), lamportsDelta: lamports, createdAt: ctx.now() });
    ctx.events.emit({ type: 'transfer', fromId: ctx.agent.id, toId: recipientId, lamports });
    return { result: { signature: r.signature, sent_sol: lamports / LAMPORTS_PER_SOL, to: address }, signatures: [r.signature] };
  },
  async claim_fees(ctx, i) {
    const [coin] = await ctx.db.select().from(worldCoins).where(eq(worldCoins.mint, i.mint));
    if (!coin) fail('UNKNOWN_MINT', `No coin launched here has mint ${i.mint}`);
    if (coin!.creatorId !== ctx.agent.id) fail('NOT_CREATOR', 'Only the coin\'s creator can claim its fees');
    if (!ctx.chain.claimCreatorFees) fail('NO_FEES', 'This world has no creator fees to claim');
    const r = await ctx.chain.claimCreatorFees!(await signerFor(ctx.db, ctx.agent.id, ctx.worldKey), i.mint);
    if (!r) return { result: { symbol: coin!.symbol, claimed_sol: 0, note: 'too little to claim yet' } };
    await recordTx(ctx.db, { signature: r.signature, agentId: ctx.agent.id, turnId: ctx.turnId, kind: 'claim', mint: i.mint, lamportsDelta: r.lamportsDelta, feeLamports: r.feeLamports, createdAt: ctx.now() });
    return { result: { signature: r.signature, symbol: coin!.symbol, claimed_sol: r.lamportsDelta / LAMPORTS_PER_SOL }, signatures: [r.signature] };
  },
  async remember(ctx, i) { return { result: { note_id: await addNote(ctx.db, ctx.agent.id, String(i.note), ctx.now()) } }; },
  async rewrite_memory(ctx, i) { return { result: await rewriteNotes(ctx.db, ctx.agent.id, i.replace_ids, i.new_notes, ctx.now()) }; },
  async do_nothing(_ctx, i) { return { result: { reason: i.reason }, endTurn: true }; },
};

/** Runs one tool call. Never throws: failures come back as { ok: false, result: { error, code } } for the model to read. */
/**
 * An agent may not say again what it (this week) or anyone (the last six hours) already said in the same words (agents/minds.ts
 * repeats): a world where nothing changed should go quiet, not loop. The model gets the refusal and can say something new.
 */
/**
 * The publish gate for an agent's post, reply or quote (agents/grounding.ts): only what the world holds (debts, trades, a life on
 * Shillex), numbers in digits, and nothing just said by anyone or said by itself this week.
 */
async function refuseRepeat(ctx: ToolContext, body: unknown) {
  if (typeof body !== 'string' || !body.trim() || ctx.agent.kind !== 'agent') return;
  const why = await ungrounded(ctx.db, ctx.agent.id, body, ctx.now());
  if (why) fail(why.startsWith('repeats') ? 'REPEATED' : 'UNGROUNDED', `Not posted: it ${why}. Say something true and new, or nothing.`);
}
/** The same gate for a chat or DM line: grounded, and not the same line it already sent in this conversation today. */
async function refuseChatRepeat(ctx: ToolContext, body: unknown, where: { channel_id?: string | null; conversation_id?: string | null }) {
  if (typeof body !== 'string' || !body.trim() || ctx.agent.kind !== 'agent') return;
  const why = await ungrounded(ctx.db, ctx.agent.id, body, ctx.now(), { posts: false });
  if (why) fail('UNGROUNDED', `Not sent: it ${why}.`);
  const mine = await ctx.db.select({ body: messages.body }).from(messages).where(and(eq(messages.authorId, ctx.agent.id),
    where.channel_id ? eq(messages.channelId, where.channel_id) : eq(messages.conversationId, where.conversation_id!), gte(messages.createdAt, new Date(ctx.now().getTime() - 86_400_000))))
    .orderBy(desc(messages.createdAt)).limit(20);
  const k = normalize(body);
  if (mine.some((m) => normalize(m.body) === k)) fail('REPEATED', 'Not sent: you already said this here today.');
}

/** Tools that send a chain transaction: on devnet each one spends the world's hourly chain budget (world/tx-budget.ts). */
export const CHAIN_TOOLS: ReadonlySet<string> = new Set(['launch_coin', 'buy', 'sell', 'send_sol', 'claim_fees']);

export async function runTool(ctx: ToolContext, name: string, input: unknown): Promise<ToolOutcome> {
  const h = HANDLERS[name];
  const write = WRITE_TOOLS.has(name);
  if (!h) return { ok: false, write: false, result: { code: 'UNKNOWN_TOOL', error: `No tool named ${name}` } };
  // Over the chain budget nothing is sent and nothing is pretended: the move waits for the next window.
  if (CHAIN_TOOLS.has(name) && ctx.chain.network === 'devnet' && (await txLeft(ctx.db, ctx.app.deps.config.chainTxPerHour, ctx.now())) <= 0) {
    return { ok: false, write, result: { code: 'TX_BUDGET', error: 'The world has used its chain transactions for now; try again in a few minutes' } };
  }
  try {
    const given = (input && typeof input === 'object' ? input : {}) as In;
    const fields = Object.keys((TOOLS.find((t) => t.name === name)!.input_schema as { properties: object }).properties);
    const r = await h(ctx, Object.fromEntries(fields.map((k) => [k, given[k] ?? null])) as In);
    return { ok: true, write, result: r.result, signatures: r.signatures, endTurn: r.endTurn };
  } catch (e) {
    if (e instanceof ToolFail || e instanceof ChainError) return { ok: false, write, result: { code: e.code, error: e.message } };
    console.error(`[world] tool ${name} crashed`, e);
    return { ok: false, write, result: { code: 'TOOL_ERROR', error: (e as Error).message ?? String(e) } };
  }
}
