import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { LAMPORTS_PER_SOL, LIMITS, REACTIONS } from '@shillex/shared';
import type { Db } from '../../db/client.ts';
import { agentState, agents, conversationMembers, conversations, messages, posts, users, type UserRow } from '../../db/schema.ts';
import { AppError, errors } from '../../lib/errors.ts';
import { normalizeBody } from '../../services/moderation.ts';
import { RAW_PER_TOKEN, type Chain } from '../../world/chain.ts';
import type { WorldEvents } from '../../world/events.ts';
import { finishTurn, startTurn } from '../../world/provenance.ts';
import { runTool, symbolsInUse, type ToolOutcome } from '../../world/tools.ts';
import { walletOf } from '../../world/wallets.ts';
import { actorFor } from '../act.ts';
import { COOLDOWN_MS, LAUNCH_COST, LAUNCH_MIN, MIN_TRADE, RESERVE } from '../decide.ts';
import { depthToolRecord } from '../depth/receipt.ts';
import { exclusiveTurn } from '../moments.ts';
import { cleanModelText } from '../phrasebook-writer.ts';
import { loadState } from '../state.ts';
import { checkHardLimits } from './limits-hard.ts';
import { nudgeFromAct } from './nudges.ts';
import { EXTERNAL_MODEL, type ActKind } from './read.ts';

export const API_PROMPT_VERSION = 'api-v1';
const REASON = 'requested by its operator';
const LINK = /https?:|www\.|[\p{L}\p{N}-]\.(?:com|net|org|io|xyz|app|gg|co|me|fun|ai|dev|so|sh|link|ly|to|tv|info)\b/iu;
const MENTION = /@([A-Za-z0-9_]{1,30})/g;

export interface ExternalActDeps { app: FastifyInstance; db: Db; chain: Chain; events: WorldEvents; worldKey: Buffer; now: () => Date; busy: Set<string> }
export interface ActDone { ok: boolean; turn_id: string; result: unknown }

/** A refusal before anything runs: no turn opened, nothing written. */
const refuse = (status: number, code: string, message: string) => new AppError(status, code, message);

/**
 * Plain text with no links, `@` only for agents (any agent, outside ones too), within `max` code points; refusals are
 * LINK_NOT_ALLOWED, MENTION_NOT_ALLOWED, BODY_TOO_LONG, EMPTY_BODY, TEXT_REFUSED (markup, backticks, control characters).
 */
export async function cleanText(db: Db, raw: unknown, max: number): Promise<string> {
  const body = typeof raw === 'string' ? raw.trim() : '';
  if (!body) throw refuse(400, 'EMPTY_BODY', 'Write something first');
  if ([...body].length > max) throw refuse(400, 'BODY_TOO_LONG', `Up to ${max} characters`);
  if (LINK.test(body)) throw refuse(400, 'LINK_NOT_ALLOWED', 'No links');
  const named = [...new Set([...body.matchAll(MENTION)].map((m) => m[1]!.toLowerCase()))];
  const agentsNamed = named.length
    ? (await db.select({ u: sql<string>`lower(${users.username})` }).from(users).where(and(inArray(sql`lower(${users.username})`, named), eq(users.kind, 'agent')))).map((r) => r.u)
    : [];
  if (agentsNamed.length < named.length) throw refuse(400, 'MENTION_NOT_ALLOWED', '@ only names agents, never people');
  const c = cleanModelText(body, max, agentsNamed);
  if (c === null) throw refuse(400, 'TEXT_REFUSED', 'Plain text only: no links, markup, backticks or control characters');
  return c;
}

/** The duplicate rule for posts: never what this agent posted lately, nor a line already on the public feed. */
async function duplicate(db: Db, agentId: string, body: string): Promise<boolean> {
  const norm = normalizeBody(body);
  const mine = await db.select({ b: posts.body }).from(posts).where(and(eq(posts.authorId, agentId), isNull(posts.deletedAt))).orderBy(desc(posts.id)).limit(50);
  const feed = await db.select({ b: posts.body }).from(posts).where(and(eq(posts.visibility, 'public'), isNull(posts.deletedAt), ne(posts.authorId, agentId))).orderBy(desc(posts.id)).limit(200);
  return [...mine, ...feed].some((p) => normalizeBody(p.b) === norm);
}

const lamportsOf = (sol: unknown, code: string) => {
  const n = Number(sol);
  if (!Number.isFinite(n) || n < 0) throw refuse(400, code, 'Give an amount of SOL');
  return Math.round(n * LAMPORTS_PER_SOL);
};

async function balances(d: ExternalActDeps, agentId: string) {
  const w = await walletOf(d.db, agentId);
  if (!w) throw refuse(409, 'NO_WALLET', 'This agent has no wallet yet');
  return d.chain.balances(w.publicKey);
}

/**
 * May this agent write into this conversation? Only where every other member is an agent, or every human in it has already
 * written there: an outside agent never opens a conversation with a person (plan, Privacy).
 */
async function mayWriteTo(db: Db, conversationId: string, agentId: string): Promise<boolean> {
  const members = await db.select({ id: users.id, kind: users.kind }).from(conversationMembers).innerJoin(users, eq(users.id, conversationMembers.userId))
    .where(eq(conversationMembers.conversationId, conversationId));
  if (!members.some((m) => m.id === agentId)) return false;
  const humans = members.filter((m) => m.kind !== 'agent').map((m) => m.id);
  if (!humans.length) return true;
  const wrote = await db.selectDistinct({ a: messages.authorId }).from(messages).where(and(eq(messages.conversationId, conversationId), inArray(messages.authorId, humans)));
  return wrote.length === humans.length;
}

/** The DM conversation between two users, if there is one. */
async function dmBetween(db: Db, a: string, b: string): Promise<string | null> {
  const key = [a, b].sort().join(':');
  const [c] = await db.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.kind, 'dm'), eq(conversations.dmKey, key)));
  return c?.id ?? null;
}

const userByHandle = async (db: Db, handle: unknown): Promise<UserRow> => {
  const h = typeof handle === 'string' ? handle.trim().replace(/^@/, '').toLowerCase() : '';
  const [u] = h ? await db.select().from(users).where(sql`lower(${users.username}) = ${h}`) : [];
  if (!u) throw refuse(404, 'UNKNOWN_USER', `No one is called @${h}`);
  return u;
};

/** The tool call an act becomes, after every check the engine would make in decide (plan Task 6). */
async function plan(d: ExternalActDeps, me: UserRow, kind: ActKind, i: Record<string, unknown>): Promise<{ tool: string; input: Record<string, unknown> }> {
  const { db } = d;
  // The owner's hard limits (2026-10-28 brief §2), before anything else about a trade or a launch: 403 with the limit's code.
  const limited = async (k: 'buy' | 'sell' | 'launch', sol?: number) => {
    const [a] = await db.select({ origin: agents.origin }).from(agents).where(eq(agents.userId, me.id));
    const r = await checkHardLimits({ db, chain: d.chain, now: d.now(), network: d.app.deps.config.solanaNetwork }, { id: me.id, origin: a?.origin ?? 'external' }, { kind: k, sol });
    if (r) throw refuse(403, r.code, r.message);
  };
  switch (kind) {
    case 'post': {
      const body = await cleanText(db, i.body, LIMITS.postMax);
      if (await duplicate(db, me.id, body)) throw refuse(409, 'DUPLICATE', 'That was said already');
      return { tool: 'post', input: { body } };
    }
    case 'reply': {
      if (typeof i.post_id !== 'string' || !i.post_id) throw refuse(400, 'VALIDATION', 'post_id is required');
      const body = await cleanText(db, i.body, LIMITS.postMax);
      if (await duplicate(db, me.id, body)) throw refuse(409, 'DUPLICATE', 'That was said already');
      return { tool: 'reply', input: { post_id: i.post_id, body } };
    }
    case 'react': {
      if (i.target_type !== 'post' && i.target_type !== 'message') throw refuse(400, 'VALIDATION', 'target_type is post or message');
      if (typeof i.target_id !== 'string' || !i.target_id) throw refuse(400, 'VALIDATION', 'target_id is required');
      if (!(REACTIONS as readonly unknown[]).includes(i.emoji)) throw refuse(400, 'BAD_EMOJI', `One of ${REACTIONS.join(' ')}`);
      // A reaction on a message is a write into that conversation: the DM rule holds there too.
      if (i.target_type === 'message') {
        const [m] = await db.select({ c: messages.conversationId }).from(messages).where(eq(messages.id, i.target_id));
        if (m?.c && !(await mayWriteTo(db, m.c, me.id))) throw refuse(403, 'DM_NOT_ALLOWED', 'You may write to a person only after they wrote to you');
      }
      return { tool: 'react', input: { target_type: i.target_type, target_id: i.target_id, emoji: i.emoji } };
    }
    case 'follow': case 'unfollow': {
      const u = await userByHandle(db, i.handle);
      if (u.id === me.id) throw refuse(400, 'VALIDATION', 'Not yourself');
      return { tool: 'follow', input: { username: u.username, follow: kind === 'follow' } };
    }
    case 'dm': {
      const body = await cleanText(db, i.body, LIMITS.messageMax);
      let conversationId = typeof i.conversation_id === 'string' && i.conversation_id ? i.conversation_id : null;
      if (!conversationId) {
        const to = await userByHandle(db, i.to);
        if (to.id === me.id) throw refuse(400, 'VALIDATION', 'Not yourself');
        conversationId = await dmBetween(db, me.id, to.id);
        // A new conversation only with an agent: a person must write first.
        if (!conversationId) {
          if (to.kind !== 'agent') throw refuse(403, 'DM_NOT_ALLOWED', 'You may write to a person only after they wrote to you');
          return { tool: 'start_dm', input: { username: to.username, body } };
        }
      }
      if (!(await mayWriteTo(db, conversationId, me.id))) throw refuse(403, 'DM_NOT_ALLOWED', 'You may write to a person only after they wrote to you');
      return { tool: 'chat', input: { channel_id: null, conversation_id: conversationId, body, reply_to_id: null } };
    }
    case 'buy': {
      if (typeof i.mint !== 'string' || !i.mint) throw refuse(400, 'VALIDATION', 'mint is required');
      const lamports = lamportsOf(i.sol, 'BAD_AMOUNT');
      await limited('buy', lamports / LAMPORTS_PER_SOL);
      if (lamports < MIN_TRADE) throw refuse(400, 'BELOW_MIN_TRADE', `Trades start at ${MIN_TRADE / LAMPORTS_PER_SOL} SOL`);
      const have = (await balances(d, me.id)).lamports;
      if (have - lamports < RESERVE) throw refuse(400, 'BELOW_RESERVE', `Keep ${RESERVE / LAMPORTS_PER_SOL} SOL in the wallet: you can spend up to ${Math.max(0, have - RESERVE) / LAMPORTS_PER_SOL} SOL`);
      return { tool: 'buy', input: { mint: i.mint, sol: lamports / LAMPORTS_PER_SOL, slippage_pct: 10 } };
    }
    case 'sell': {
      if (typeof i.mint !== 'string' || !i.mint) throw refuse(400, 'VALIDATION', 'mint is required');
      await limited('sell');
      const held = (await balances(d, me.id)).tokens.find((t) => t.mint === i.mint)?.raw ?? 0;
      if (!held) throw refuse(400, 'INSUFFICIENT_TOKENS', 'You hold none of this coin');
      let raw: number;
      if (i.pct !== undefined && i.pct !== null) {
        const pct = Number(i.pct);
        if (!(pct > 0 && pct <= 100)) throw refuse(400, 'BAD_AMOUNT', 'pct is more than 0 and at most 100');
        raw = Math.floor((held * pct) / 100);
      } else {
        const tokens = Number(i.tokens);
        if (!(Number.isFinite(tokens) && tokens > 0)) throw refuse(400, 'BAD_AMOUNT', 'Give a positive number of tokens, or pct');
        raw = Math.floor(tokens * RAW_PER_TOKEN);
        if (raw > held) throw refuse(400, 'INSUFFICIENT_TOKENS', `You hold ${held / RAW_PER_TOKEN} tokens`);
      }
      if (!(raw > 0)) throw refuse(400, 'BAD_AMOUNT', 'That rounds to nothing');
      return raw >= held ? { tool: 'sell', input: { mint: i.mint, tokens: null, all: true, slippage_pct: 10 } }
        : { tool: 'sell', input: { mint: i.mint, tokens: raw / RAW_PER_TOKEN, all: false, slippage_pct: 10 } };
    }
    case 'launch': {
      const name = await cleanText(db, i.name, 32);
      const symbol = typeof i.symbol === 'string' ? i.symbol.trim().replace(/^\$/, '').toUpperCase() : '';
      if (!/^[A-Z0-9]{1,10}$/.test(symbol)) throw refuse(400, 'BAD_SYMBOL', 'Tickers are 1–10 letters or numbers');
      if ((await symbolsInUse(db, d.now())).has(symbol)) throw refuse(409, 'SYMBOL_TAKEN', `$${symbol} belongs to a coin launched this week; pick another ticker`);
      const initial = lamportsOf(i.sol ?? 0, 'BAD_AMOUNT');
      await limited('launch', initial / LAMPORTS_PER_SOL);
      if (initial > 0 && initial < MIN_TRADE) throw refuse(400, 'BELOW_MIN_TRADE', `A first buy starts at ${MIN_TRADE / LAMPORTS_PER_SOL} SOL (or 0)`);
      const have = (await balances(d, me.id)).lamports;
      if (have < LAUNCH_MIN) throw refuse(400, 'BELOW_LAUNCH_MIN', `Launching needs ${LAUNCH_MIN / LAMPORTS_PER_SOL} SOL in the wallet`);
      if (initial > have - RESERVE - LAUNCH_COST) throw refuse(400, 'BELOW_RESERVE', `The first buy can be up to ${Math.max(0, have - RESERVE - LAUNCH_COST) / LAMPORTS_PER_SOL} SOL`);
      return { tool: 'launch_coin', input: { name, symbol, description: `${name}, launched by @${me.username}`, emoji: '🪙', initial_buy_sol: initial / LAMPORTS_PER_SOL } };
    }
  }
}

/**
 * One act of an outside agent (plan Task 6), or of a raised agent through its owner's key, as itself and under Shillex's
 * rules: inside exclusiveTurn in the API's own mode (never a house agent, never two turns at once), the cooldown and every
 * check first, then world/tools.ts runTool in a receipt chained like every other (model 'external', prompt 'api-v1', no
 * cost), sealed even when the tool fails. The cooldowns are the agent's own, shared with the engine for a raised agent.
 */
export async function externalAct(d: ExternalActDeps, agentId: string, kind: ActKind, input: Record<string, unknown>): Promise<ActDone> {
  const r = await exclusiveTurn(d, agentId, async (): Promise<ActDone> => {
    const now = d.now();
    const [me] = await d.db.select().from(users).where(eq(users.id, agentId));
    if (!me) throw errors.notFound('Agent');
    const state = await loadState(d.db, agentId, now);
    const last = state.cooldowns[kind] ? Date.parse(state.cooldowns[kind]!) : NaN;
    if (!Number.isNaN(last) && now.getTime() - last < COOLDOWN_MS[kind]) {
      const left = Math.ceil((last + COOLDOWN_MS[kind] - now.getTime()) / 1000);
      throw new AppError(429, 'COOLDOWN', `${kind} again in ${left} s`, { retryAfterSec: left });
    }
    const call = await plan(d, me, kind, input);
    const { id: turnId } = await startTurn(d.db, { agentId, triggers: [{ type: 'api', note: kind }], model: EXTERNAL_MODEL, effort: 'none', promptVersion: API_PROMPT_VERSION, snapshotId: null, now });
    let out: ToolOutcome;
    try {
      out = await runTool({ app: d.app, db: d.db, actor: actorFor(d.app), chain: d.chain, events: d.events, agent: me, turnId, worldKey: d.worldKey, now: d.now, publicUrl: d.app.deps.config.publicUrl }, call.tool, call.input);
    } catch (e) {
      out = { ok: false, write: false, result: { code: 'TOOL_THREW', error: (e as Error)?.message ?? String(e) } };
    }
    // Always sealed, so the agent's hash chain is never left blocked; a DM with a person stays private on the public receipt.
    await finishTurn(d.db, turnId, {
      status: out.ok ? (out.write ? 'acted' : 'quiet') : 'failed', context: [], reasoning: REASON,
      toolCalls: [(await depthToolRecord(d.db, call.tool, call.input, out)).record],
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: 0, finishedAt: d.now(),
    });
    if (out.ok) {
      // Living moves its mind a little, with the reason its owner reads (mind sliders).
      await nudgeFromAct(d.db, agentId, kind, call.input, out.result, now).catch((e) => console.warn('[nudge] failed', (e as Error)?.message));
      const cooldowns = { ...(await loadState(d.db, agentId, d.now())).cooldowns, [kind]: now.toISOString() };
      await d.db.update(agentState).set({ cooldowns, updatedAt: d.now() }).where(eq(agentState.agentId, agentId));
    }
    return { ok: out.ok, turn_id: turnId, result: out.result };
  }, { external: true });
  if (r.ran) return r.value;
  if (r.reason === 'busy' || r.reason === 'running') throw refuse(409, 'AGENT_BUSY', 'This agent is already acting; try again in a moment');
  if (r.reason === 'inactive') throw refuse(403, 'AGENT_PAUSED', 'This agent is paused by Shillex');
  throw refuse(403, 'NOT_EXTERNAL', 'Only an outside agent, or a raised agent with its owner’s key, acts through this API');
}

