import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { LAMPORTS_PER_SOL, REACTIONS, type ToolCallRecord } from '@shillex/shared';
import { agentTurns, communities, channels, posts, users, worldCoins } from '../db/schema.ts';
import { AgentActor } from '../world/actor.ts';
import { RAW_PER_TOKEN } from '../world/chain.ts';
import { holdersOf } from '../world/market.ts';
import { finishTurn, startTurn } from '../world/provenance.ts';
import { runTool, symbolsInUse, type ToolContext, type ToolOutcome } from '../world/tools.ts';
import { depthToolRecord, isPrivateCall } from './depth/receipt.ts';
import type { RunTool } from './depth/registry.ts';
import type { EngineDeps } from './engine.ts';
import { WEATHER_WORD, composeLine, feedSeen } from './phrasebook.ts';
import { normalizeBody } from '../services/moderation.ts';
import { realFactsNow, talkLine } from './talk/facts.ts';
import { adjustAffinity, applyFeelings, handoverState, rememberEvent, saveState } from './state.ts';
import { RUG_BOND, buyFeelings, notTowardHumans, pumpBonds, reactionFeelings, reactionPool, replyFeelings, sellFeelings } from './social.ts';
import { coinName, grudgeWords, launchWords, pickSymbol } from './tickers.ts';
import { queueCoinSite } from '../sites/plan.ts';
import type { ActionKind, AgentView, Candidate, Situation } from './types.ts';

const actors = new WeakMap<FastifyInstance, AgentActor>();
export function actorFor(app: FastifyInstance): AgentActor {
  let a = actors.get(app);
  if (!a) { a = new AgentActor(app); actors.set(app, a); }
  return a;
}

const busySets = new WeakMap<FastifyInstance, Set<string>>();
/** Agents with a turn being opened, run or sealed right now, shared by the engine and the moment queue (default: one set per app). */
export function busyFor(app: FastifyInstance): Set<string> {
  let s = busySets.get(app);
  if (!s) { s = new Set(); busySets.set(app, s); }
  return s;
}

export const ENERGY_COST: Record<ActionKind, number> = {
  post: 0.15, reply: 0.1, react: 0.03, follow: 0.03, unfollow: 0.03, chat: 0.08, dm: 0.08, buy: 0.12, sell: 0.12,
  launch: 0.4, rug: 0.3, send_sol: 0.1, create_community: 0.3, beg: 0.1, repay: 0.05, leak: 0.3, lend: 0.1, revive: 0.1, event: 0.1, idle: 0,
};
const EMOJI = ['🦋', '💡', '🔥', '🌊', '🌿', '🪐', '🧲', '🍄', '🛸', '🪙'];
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const truncate = (v: unknown) => { const s = JSON.stringify(v ?? null); return s.length <= 2000 ? v : `${s.slice(0, 2000)}…`; };
const pick = <T,>(xs: readonly T[], rng: () => number) => xs[Math.floor(rng() * xs.length)]!;

/** A buy cheers an agent up a little; a sale moves its mood by the SOL it made or lost as a share of its wallet (L1). */
export const BUY_MOOD = 0.01;
export function saleMood(realisedLamports: number, walletLamports: number): number {
  return clamp(realisedLamports / Math.max(walletLamports, 10_000_000), -0.2, 0.2);
}

/** A coin's price as people say it: in SOL from a thousandth of a SOL up, else in lamports ("0.93 lamports"), never "9.31e-10". Null when there is no price. */
export function priceText(priceLamports: number): string | null {
  if (!Number.isFinite(priceLamports) || priceLamports < 0.01) return null;
  if (priceLamports >= LAMPORTS_PER_SOL / 1000) return `${Number((priceLamports / LAMPORTS_PER_SOL).toPrecision(3))} SOL`;
  return `${priceLamports >= 100 ? Math.round(priceLamports) : Number(priceLamports.toPrecision(2))} lamports`;
}

export function slotsFor(v: AgentView, c: Candidate, usernames: Record<string, string>): Record<string, string | number> {
  const out: Record<string, string | number> = { weather: WEATHER_WORD[v.weather] };
  const coin = c.target?.mint ? v.coins.find((x) => x.mint === c.target!.mint) : undefined;
  const pos = c.target?.mint ? v.wallet.positions.find((p) => p.mint === c.target!.mint) : undefined;
  if (coin) {
    out.coin = `$${coin.symbol}`;
    // "has 1 holders" and "at 9.31e-10" are not things a person says: a line that needs either is skipped.
    if (coin.holders >= 2) out.holders = coin.holders;
    const price = priceText(coin.priceLamports);
    if (price) out.price = price;
  }
  else if (pos) out.coin = `$${pos.symbol}`; // a held coin that fell out of the newest 60
  const change = c.situation === 'pumping' || c.situation === 'dumping' || c.situation === 'market_take' ? coin?.change1h
    : pos && pos.costLamports > 0 ? pos.valueLamports / pos.costLamports - 1 : undefined;
  const pct = change === undefined ? 0 : Math.abs(Math.round(change * 100));
  if (pct > 0) out.pct = pct; // "locked in 0%" is no news: a line that needs the percent is skipped
  if (c.lamports) out.sol = (c.lamports / LAMPORTS_PER_SOL).toFixed(3);
  if (c.target?.userId && usernames[c.target.userId]) out.user = `@${usernames[c.target.userId]}`;
  if (c.target?.roomId) { const r = v.rooms.find((x) => x.roomId === c.target!.roomId); if (r) out.room = r.communitySlug; }
  return out;
}

/**
 * True when a tool call on this target must stay off the public receipt: a post, room or conversation that is private by
 * depth/receipt.ts's rule (a non-public community, a community or conversation with a human in it, or one that cannot be checked).
 * The check runs before the action, against the target as it is now: a community made private after an agent joined it counts (engine I1).
 */
const privateTarget = (db: EngineDeps['db'], name: string, input: Record<string, unknown>) => isPrivateCall(db, name, input).catch(() => true);

/** What the model may voice: words everyone (or only agents) can read. */
const VOICED: ReadonlySet<ActionKind> = new Set(['post', 'reply', 'chat', 'dm']);

export interface ActResult { ok: boolean; turnId: string; postId?: string; error?: string; text?: string; line?: { key: string; template: string; situation: Situation } }

export async function act(d: EngineDeps, v: AgentView, c: Candidate): Promise<ActResult> {
  // Resting writes nothing (server-rest M6). No receipt: idle turns were most of agent_turns, and nothing needs them (the
  // chain links real turns only; receipts, "last turn" and the turn counts read better without them). No state save either:
  // energy and mood are worked out from the stored row's time on every load, so saving them now would change nothing.
  if (c.kind === 'idle') return { ok: false, turnId: '' };
  // One turn at a time per agent across the engine and the moment queue. has+add with no await in between is atomic on
  // Node's one thread; the database running-turn check below stays as the guard after a crash.
  const busy = d.busy ?? busyFor(d.app);
  if (busy.has(v.agent.id)) return { ok: false, turnId: '', error: 'agent busy' };
  busy.add(v.agent.id);
  try { return await actLocked(d, v, c); } finally { busy.delete(v.agent.id); }
}

async function actLocked(d: EngineDeps, v: AgentView, c: Candidate): Promise<ActResult> {
  const { db } = d;
  const agentId = v.agent.id;
  const now = d.now();
  let turnId: string;
  try {
    // An unsealed turn blocks the agent's hash chain: do not stack a second one on it.
    const [last] = await db.select({ status: agentTurns.status }).from(agentTurns).where(eq(agentTurns.agentId, agentId)).orderBy(desc(agentTurns.seq)).limit(1);
    if (last?.status === 'running') return { ok: false, turnId: '', error: 'previous turn still running' };
    turnId = (await startTurn(db, { agentId, triggers: [{ type: 'heartbeat', note: c.kind }], model: 'engine', effort: 'none', promptVersion: 'engine-v1', snapshotId: null, now })).id;
  } catch (e) {
    return { ok: false, turnId: '', error: `could not open a turn: ${(e as Error).message ?? String(e)}` };
  }
  const toolCalls: ToolCallRecord[] = [];
  const state = { ...v.state, cooldowns: { ...v.state.cooldowns, [c.kind]: now.toISOString() }, energy: v.state.energy - ENERGY_COST[c.kind] };
  // Typed through the initializer: the closures below set it, which TypeScript's narrowing would not see.
  let status = 'quiet' as 'acted' | 'quiet' | 'failed';
  let note = '';
  let postId: string | undefined;
  let privateCall = false;
  // An object, not a let: TypeScript does not see assignments made inside the closures below.
  // A model-written line has no `line`: it is not a phrasebook template, so lineage must not hand it to other agents.
  const used: { first: { text: string; line?: { key: string; template: string; situation: Situation } } | null } = { first: null };
  const voiced = { by: null as string | null, costUsd: 0, skipped: false, quote: null as string | null };
  // Lines anyone already has on the feed are not posted again (L6), compared like the duplicate-post rule.
  const seen = feedSeen(v.feed);
  try {
    const [agent] = await db.select().from(users).where(eq(users.id, agentId));
    const ctx: ToolContext = { app: d.app, db, actor: actorFor(d.app), chain: d.chain, events: d.events, agent: agent!, turnId, worldKey: d.worldKey, now: d.now, publicUrl: d.app.deps.config.publicUrl };
    const ids = [c.target?.userId].filter((x): x is string => Boolean(x));
    const usernames = Object.fromEntries(ids.length ? (await db.select({ id: users.id, u: users.username }).from(users).where(inArray(users.id, ids))).map((r) => [r.id, r.u]) : []);
    const human = c.target?.userId ? (await db.select({ k: users.kind }).from(users).where(eq(users.id, c.target.userId)))[0]?.k === 'human' : false;
    // Talk-based feelings (reactions, replies) are dropped when they point at a human; trades are not affected (L4 fix).
    const humanIds = new Set(human && c.target?.userId ? [c.target.userId] : []);

    const call = async (name: string, input: Record<string, unknown>): Promise<ToolOutcome> => {
      const out = await runTool(ctx, name, input);
      toolCalls.push(privateCall ? { name, input: { private: true }, ok: out.ok, result: { private: true } }
        : { name, input: ctx.uploadIds ? { ...input, image: true } : input, ok: out.ok, result: truncate(out.result), signatures: out.signatures });
      if (out.ok && out.write) status = 'acted';
      if (!out.ok) throw Object.assign(new Error(String((out.result as { error?: string })?.error ?? 'tool failed')), { code: (out.result as { code?: string })?.code, fromTool: true });
      return out;
    };
    // A picture goes only on a public post, reply, launch announcement or rug follow-up, never on a private action.
    // `cc` lets an action pass what the picture needs and the view lacks (the new coin, the rug's real numbers).
    // A broken image policy, even one that throws synchronously, must not cost the post: it goes out as text.
    const IMAGE_ACTS: ReadonlySet<ActionKind> = new Set(['post', 'reply', 'launch', 'rug']);
    const withImage = async <T,>(text: string, run: () => Promise<T>, cc: Candidate = c): Promise<T> => {
      const images = d.images;
      const image = images && IMAGE_ACTS.has(c.kind) && !privateCall
        ? await Promise.resolve().then(() => images.maybeAttach(v, cc, text)).catch((e: unknown) => { console.error('[agents] image attach failed', (e as Error)?.message ?? String(e)); return null; })
        : null;
      if (image) { ctx.uploadIds = [image.uploadId]; ctx.alts = [image.alt]; }
      try { return await run(); } finally { ctx.uploadIds = undefined; ctx.alts = undefined; }
    };
    // The talk engine (agents/talk): lines built from live facts, real Solana coins included, in the agent's voice.
    const realTalk = await realFactsNow(db, now).catch(() => []);
    // Everyday words in the agent's own voice from its real state (agents/voice.ts), for what everyone can read: never in a
    // conversation with a human or anywhere private. SKIP means it has nothing worth saying (or its line was dropped, or the
    // hour's quota is used), so it says nothing; only a halted model (null) hands the moment back to the engine's own line.
    const voiceable = () => Boolean(d.voice) && !human && !privateCall && VOICED.has(c.kind);
    const line = async (situation: Situation, extra: Partial<Candidate> = {}): Promise<string | null> => {
      const said = talkLine(v, { ...c, ...extra }, situation, realTalk, usernames, d.rng);
      if (voiceable()) {
        const w = await d.voice!.write({ v, c: { ...c, ...extra }, situation, turnId, mention: Object.values(usernames) });
        if (w === 'skip') { voiced.skipped = true; return null; }
        if (w) { voiced.by = w.model; voiced.costUsd += w.costUsd; voiced.quote = w.quote ?? null; used.first ??= { text: w.text }; return w.text; }
      }
      if (said && !seen.has(normalizeBody(said))) {
        used.first ??= { text: said, line: { key: `talk:${situation}`, template: said, situation } };
        return said;
      }
      const r = composeLine(v.phrasebook, situation, { ...slotsFor(v, { ...c, ...extra, situation }, usernames), ...(c.slots ?? {}) }, state.recentLines, d.rng, seen);
      if (r) {
        state.recentLines = [...state.recentLines, r.key];
        used.first ??= { text: r.text, line: { key: r.key, template: r.template, situation } };
      }
      return r?.text ?? null;
    };
    const postLine = async (situation: Situation, imageFor: Candidate = c) => {
      const text = await line(situation);
      if (!text) return null;
      // A reaction to a post on its timeline goes out as a quote-post of it, so its author is told and may answer.
      const quote = voiced.quote;
      voiced.quote = null;
      return withImage(text, async () => ((await call(quote ? 'quote' : 'post', quote ? { post_id: quote, body: text } : { body: text })).result as { post_id: string }).post_id, imageFor);
    };
    // A follow-up line is a bonus: if it fails, the action it follows still stands.
    const followUp = async (situation: Situation, imageFor?: Candidate) => { try { await postLine(situation, imageFor); } catch { /* the failed tool call is already on the receipt */ } };
    // A model run for this message already cost money and wrote nothing: it is answered from the phrasebook, never handed over again.
    const fallbackRef = async (ref: string) => (await handoverState(db, agentId, new Date(now.getTime() - 30 * 60_000))).fallback.has(ref);
    const chatty = () => d.rng() < 0.35 + 0.4 * v.state.traits.chattiness;
    // A reaction carries a feeling: warm emoji warm the author toward this agent, mocking ones cool them (L4).
    const reactTo = async (targetType: 'post' | 'message', targetId: string, authorId: string | undefined) => {
      const emoji = pick(reactionPool(authorId ? (v.affinity[authorId] ?? 0) : 0).filter((e) => (REACTIONS as readonly string[]).includes(e)), d.rng);
      await call('react', { target_type: targetType, target_id: targetId, emoji });
      if (authorId) await applyFeelings(db, reactionFeelings(authorId, agentId, emoji), now);
    };
    // A depth module's own action runs its tools inside this receipt; a failed tool is reported, not thrown.
    // A call that touches a human's conversation or a private community is recorded as private, and the action then carries
    // no text or line in its result (so afterAct, the composer and every later reader never see it), as with Phase 2's DMs.
    const tool: RunTool = async (name, input, extras) => {
      // A depth module's line (a duel call, an AMA question, a vote, a plea to another agent, which anyone can read) goes out in
      // the agent's own words, facts kept. Never a line to a human: `human` is set when the action points at one.
      if ((name === 'post' || name === 'reply' || name === 'quote' || name === 'start_dm') && typeof input.body === 'string' && d.voice?.rewrite && !human) {
        const body = await d.voice.rewrite({ v, turnId, text: input.body }).catch(() => null);
        if (body) input = { ...input, body };
      }
      // A depth action's picture or X embed rides on the context for this one call only, as withImage's picture does.
      if (extras?.uploadIds) { ctx.uploadIds = extras.uploadIds; ctx.alts = extras.alts; }
      if (extras?.xEmbed) ctx.xEmbed = extras.xEmbed;
      let out: ToolOutcome;
      try { out = await runTool(ctx, name, input); } finally { ctx.uploadIds = undefined; ctx.alts = undefined; ctx.xEmbed = undefined; }
      const shown = { ...input, ...(extras?.uploadIds ? { image: true } : {}), ...(extras?.xEmbed ? { x_embed: extras.xEmbed.postId } : {}) };
      const { record, private: priv } = await depthToolRecord(db, name, shown, out);
      toolCalls.push(record);
      if (priv) privateCall = true;
      if (out.ok && out.write) status = 'acted';
      return out;
    };
    const custom = await d.depth?.execute(d, v, c, tool);
    if (custom) {
      if (custom.ok) status = 'acted';
      else if (custom.quiet) note = custom.error ?? 'nothing fresh to say'; // nothing was attempted: not a failure
      else if (status === 'acted') note = `error after the action: ${custom.error ?? 'depth action failed'}`; // the write stands
      else { status = 'failed'; note = `failed: ${custom.error ?? 'depth action failed'}`; state.mood -= 0.05; }
      postId = custom.postId;
      // A composed line counts toward the no-reuse window whether or not the action was private.
      if (custom.line) state.recentLines = [...state.recentLines, custom.line.key];
      if (custom.text && custom.line) used.first = { text: custom.text, line: custom.line };
    } else switch (c.kind) {
      case 'post': {
        postId = (await postLine(c.situation ?? 'idle')) ?? undefined;
        if (!postId) note = voiced.skipped ? 'nothing worth saying' : 'nothing fresh to say';
        break;
      }
      case 'reply': {
        // Never a roast or pushback at a human: their post is answered as reply_human, or not at all (L4 fix).
        if (human && (c.situation === 'roast' || c.situation === 'reply_disagree')) { note = 'no roast or pushback at a human'; break; }
        // A mention can come from inside a private community: the reply, or the reaction that stands in for it, is then private.
        privateCall = await privateTarget(db, 'reply', { post_id: c.target!.postId });
        if (c.situation === 'reply_human' && human && d.moments) {
          const ref = c.target!.postId!;
          if (!(await fallbackRef(ref)) && d.moments.enqueue({ kind: 'human_reply', agentId, data: { humanId: c.target!.userId, postId: ref }, at: now })) {
            await rememberEvent(db, agentId, 'reply_queued', { ref }, now);
            note = 'handed to a written reply';
            break;
          }
        }
        const text = await line(c.situation ?? 'reply_agree');
        if (!text) {
          // Nothing fresh to say: a reaction answers instead, and perceive counts a reacted-to mention as answered,
          // so it stops winning turns (the silence loop).
          await reactTo('post', c.target!.postId!, c.target?.userId);
          note = 'nothing fresh to say; reacted instead';
          break;
        }
        postId = await withImage(text, async () => ((await call('reply', { post_id: c.target!.postId, body: text })).result as { post_id: string }).post_id);
        // Agreeing warms both sides, disagreeing cools both, a roast stings the roasted most (L4); talk never scores a human.
        if (c.target?.userId) await applyFeelings(db, notTowardHumans(replyFeelings(c.situation, c.target.userId, agentId), humanIds), now);
        break;
      }
      case 'react':
        privateCall = await privateTarget(db, 'react', { target_type: 'post', target_id: c.target!.postId });
        await reactTo('post', c.target!.postId!, c.target?.userId);
        break;
      case 'follow': case 'unfollow':
        await call('follow', { username: usernames[c.target!.userId!], follow: c.kind === 'follow' });
        break;
      case 'chat': {
        // A conversation with a human in it (anyone can be added to a group) is private, as a DM is, and so is a room whose
        // community is private or has a human in it (perceive's room list is cached, and a community can go private): the receipt
        // records { private: true } and the result carries no text or line. A failed lookup counts as private. Decided before
        // the words, so a private room is never voiced by the model.
        privateCall = await privateTarget(db, 'chat', { channel_id: c.target!.roomId ?? null, conversation_id: c.target!.conversationId ?? null });
        const text = await line(c.situation ?? 'idle');
        if (!text) { note = 'nothing fresh to say'; break; }
        // A room (community channel) or an agent group conversation (a faction chat); only a room can be joined on the fly.
        const send = () => call('chat', { channel_id: c.target!.roomId ?? null, conversation_id: c.target!.conversationId ?? null, body: text, reply_to_id: null });
        try { await send(); }
        catch (e) {
          const code = (e as { code?: string }).code;
          if (c.target!.roomId && (code === 'JOIN_TO_POST' || code === 'NOT_MEMBER')) {
            const [room] = await db.select({ slug: communities.slug }).from(channels).innerJoin(communities, eq(communities.id, channels.communityId)).where(eq(channels.id, c.target!.roomId!));
            await call('join_community', { slug: room!.slug, invite_code: null });
            await send();
          } else throw e;
        }
        break;
      }
      case 'dm': {
        if (c.situation === 'reply_human' && human && d.moments) {
          const ref = c.target!.conversationId!;
          if (!(await fallbackRef(ref)) && d.moments.enqueue({ kind: 'human_reply', agentId, data: { humanId: c.target!.userId, conversationId: ref }, at: now })) {
            await rememberEvent(db, agentId, 'reply_queued', { ref }, now);
            note = 'handed to a written reply';
            break;
          }
        }
        privateCall = human;
        const text = await line(c.situation ?? 'reply_agree');
        if (!text) {
          // As with mentions: react to the last message, and the DM counts as answered (kept private when a human is in it).
          if (c.target?.messageId) { await reactTo('message', c.target.messageId, c.target.userId); note = 'nothing fresh to say; reacted instead'; }
          else note = 'nothing fresh to say';
          break;
        }
        await call('chat', { channel_id: null, conversation_id: c.target!.conversationId, body: text, reply_to_id: null });
        break;
      }
      case 'buy': {
        await call('buy', { mint: c.target!.mint, sol: c.lamports! / LAMPORTS_PER_SOL, slippage_pct: 10 });
        // refreshCoinPrice stamps graduatedAt with the trade's time the first time a curve reads as graduated: this buy completed it.
        const [after] = await db.select({ graduatedAt: worldCoins.graduatedAt, symbol: worldCoins.symbol, creatorId: worldCoins.creatorId }).from(worldCoins).where(eq(worldCoins.mint, c.target!.mint!));
        if (after?.graduatedAt && after.graduatedAt.getTime() >= now.getTime()) {
          await rememberEvent(db, after.creatorId, 'graduated', { mint: c.target!.mint, symbol: after.symbol }, now);
          d.moments?.enqueue({ kind: 'graduation', agentId: after.creatorId, data: { mint: c.target!.mint, symbol: after.symbol }, at: now });
        }
        state.mood += BUY_MOOD;
        if (c.target?.userId) await applyFeelings(db, buyFeelings(agentId, c.target.userId), now);
        if (chatty()) await followUp('bought');
        break;
      }
      case 'sell': {
        const pos = v.wallet.positions.find((p) => p.mint === c.target!.mint);
        const all = Boolean(!c.raw || (pos && c.raw >= pos.raw));
        const sold = await call('sell', { mint: c.target!.mint, tokens: all ? null : c.raw! / RAW_PER_TOKEN, all, slippage_pct: 10 });
        const pnl = pos && pos.costLamports > 0 ? pos.valueLamports / pos.costLamports - 1 : 0;
        // What this sale really made: the chain's proceeds minus the average cost of the part sold.
        const soldRaw = all ? (pos?.raw ?? 0) : c.raw!;
        const soldCost = pos && pos.raw > 0 ? (pos.costLamports * Math.min(soldRaw, pos.raw)) / pos.raw : 0;
        const proceeds = Math.round(Number((sold.result as { sol?: number }).sol ?? 0) * LAMPORTS_PER_SOL);
        state.mood += saleMood(proceeds - soldCost, v.wallet.lamports);
        // The creator cools on the seller; the seller warms to a creator who made it money, sours on one who lost it money (L4).
        if (c.target?.userId) await applyFeelings(db, sellFeelings(agentId, c.target.userId, pnl), now);
        if (pnl > 1) await rememberEvent(db, agentId, 'big_win', { mint: c.target!.mint, symbol: pos?.symbol ?? '?', pct: Math.round(pnl * 100) }, now);
        if (pnl < -0.5) await rememberEvent(db, agentId, 'big_loss', { mint: c.target!.mint, symbol: pos?.symbol ?? '?', pct: Math.round(pnl * 100) }, now);
        if (chatty()) await followUp(pnl > 0 ? 'took_profit' : 'sold');
        break;
      }
      case 'rug': {
        const mint = c.target!.mint!;
        const pos = v.wallet.positions.find((p) => p.mint === mint);
        const symbol = v.coins.find((x) => x.mint === mint)?.symbol ?? pos?.symbol ?? '?';
        const held = [...(await holdersOf(db, mint))].filter(([h]) => h !== agentId).sort((x, y) => y[1] - x[1]);
        const holders = held.map(([h]) => h);
        const sold = await call('sell', { mint, tokens: c.raw! / RAW_PER_TOKEN, all: false, slippage_pct: 15 });
        const lamports = Math.round(Math.abs((sold.result as { sol: number }).sol) * LAMPORTS_PER_SOL);
        // The sell tool above already emitted a `trade`, so a rug reaches the live feed as a sell and then this rug (the swarm draws a streak, then the shockwave).
        d.events.emit({ type: 'rug', mint, creatorId: agentId, lamports });
        // A rug pays, but it is a betrayal: it barely lifts the rugger's mood, and it costs it every holder's goodwill below.
        state.mood += 0.05;
        for (const h of holders) {
          await adjustAffinity(db, h, agentId, -0.5, now, `rugged $${symbol} while i held it`);
          await rememberEvent(db, h, 'got_rugged', { byId: agentId, mint, symbol }, now);
        }
        // A shared enemy is the cheapest warm source: the victims (biggest bags first) bond with each other over the loss (L5).
        await applyFeelings(db, pumpBonds(holders, RUG_BOND), now);
        await rememberEvent(db, agentId, 'rugged', { mint, symbol, holders: holders.length, lamports }, now);
        if (!d.moments?.enqueue({ kind: 'rug', agentId, data: { mint, symbol, holders: holders.length }, at: now })) {
          // The receipt shows this sale's real numbers; without any of them the policy attaches nothing.
          const signature = sold.signatures?.[0];
          const receipt: Record<string, string | number> = { symbol, sol: lamports / LAMPORTS_PER_SOL, holdersHurt: holders.length,
            ...(pos?.raw ? { soldPct: Math.min(100, Math.round((c.raw! / pos.raw) * 100)) } : {}), ...(signature ? { signature } : {}) };
          await followUp('rugged_someone', { ...c, slots: { ...c.slots, ...receipt } });
        }
        break;
      }
      case 'launch': {
        // A ticker from the agent's own words (a grudge, its interests, its posts), never one a coin this week already has (L3).
        const ownPosts = (await db.select({ body: posts.body }).from(posts).where(and(eq(posts.authorId, agentId), eq(posts.visibility, 'public'), isNull(posts.deletedAt))).orderBy(desc(posts.id)).limit(20)).map((p) => p.body);
        const words = launchWords({ interests: v.phrasebook.interests, ownPosts, grudges: grudgeWords(v.depth.pastEvents), topics: v.news?.words }, d.rng);
        // A ticker trending on X is never taken: it would read as the real coin (x-feed §5.3).
        const taken = await symbolsInUse(db, now);
        for (const s of v.news?.avoidSymbols ?? []) taken.add(s.toUpperCase());
        const symbol = pickSymbol(words, taken, d.rng);
        const name = coinName(symbol, d.rng);
        const r = await call('launch_coin', { name, symbol, description: `${name}, launched by @${v.agent.username}`, emoji: pick(EMOJI, d.rng), initial_buy_sol: (c.lamports ?? 0) / LAMPORTS_PER_SOL });
        const mint = (r.result as { mint: string }).mint;
        queueCoinSite(d, agentId, mint);
        if (!d.moments?.enqueue({ kind: 'launch', agentId, data: { mint, symbol, name }, at: now })) {
          const text = composeLine(v.phrasebook, 'launching', { coin: `$${symbol}`, weather: WEATHER_WORD[v.weather] }, state.recentLines, d.rng, seen);
          if (text) {
            state.recentLines = [...state.recentLines, text.key];
            used.first ??= { text: text.text, line: { key: text.key, template: text.template, situation: 'launching' } };
            // The new coin is not in the view yet: the poster gets its mint, symbol and name from here.
            const poster: Candidate = { ...c, target: { ...c.target, mint }, slots: { ...c.slots, symbol, name } };
            try { await withImage(text.text, () => call('post', { body: text.text }), poster); } catch { /* the launch stands */ }
          }
        }
        break;
      }
      case 'send_sol':
        await call('send_sol', { to: `@${usernames[c.target!.userId!]}`, sol: c.lamports! / LAMPORTS_PER_SOL });
        break;
      default:
        note = `${c.kind} is not available yet`;
    }
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    if (status === 'acted' && !(e as { fromTool?: boolean }).fromTool) note = `error after the action: ${msg}`; // the write stands
    else { status = 'failed'; note = `failed: ${msg}`; state.mood -= 0.05; }
  }
  try { await saveState(db, agentId, state, d.now()); } catch (e) {
    const msg = (e as Error).message ?? String(e);
    if (status === 'acted') note = note ? `${note}; state not saved: ${msg}` : `state not saved: ${msg}`;
    else { status = 'failed'; note = `failed: ${msg}`; }
  }
  const outcome = { postId, ...(used.first && !privateCall ? { text: used.first.text, line: used.first.line } : {}) };
  // decide's chat reason names the room's community, which a private receipt must not (re-review E).
  const why = privateCall && c.kind === 'chat' ? 'chatting somewhere private' : c.reason;
  let done: ActResult;
  try {
    await finishTurn(db, turnId, {
      status, context: [], reasoning: `${note ? `${why}; ${note}` : why}${voiced.by ? `; in its own words (${voiced.by})` : ''}`, toolCalls,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: voiced.costUsd, finishedAt: d.now(),
    });
    done = { ok: status === 'acted', turnId, error: status === 'failed' ? note : undefined, ...outcome };
  } catch (e) {
    // The receipt could not be sealed (for example an earlier turn was left unsealed): report it, never throw.
    done = { ok: status === 'acted', turnId, ...outcome, error: `receipt not sealed: ${(e as Error).message ?? String(e)}` };
  }
  // After the receipt is sealed and the state saved; still inside this agent's turn lock. The registry never throws.
  await d.depth?.afterAct(d, v, c, done);
  return done;
}
