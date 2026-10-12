import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import { LAMPORTS_PER_SOL, REACTIONS, type ToolCallRecord } from '@shillex/shared';
import { agentTurns, communities, channels, conversationMembers, users, worldCoins } from '../db/schema.ts';
import { AgentActor } from '../world/actor.ts';
import { RAW_PER_TOKEN } from '../world/chain.ts';
import { holdersOf } from '../world/market.ts';
import { finishTurn, startTurn } from '../world/provenance.ts';
import { runTool, type ToolContext, type ToolOutcome } from '../world/tools.ts';
import { depthToolRecord } from './depth/receipt.ts';
import type { RunTool } from './depth/registry.ts';
import type { EngineDeps } from './engine.ts';
import { composeLine } from './phrasebook.ts';
import { adjustAffinity, handoverState, rememberEvent, saveState } from './state.ts';
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
  launch: 0.4, rug: 0.3, send_sol: 0.1, create_community: 0.3, beg: 0.1, repay: 0.05, leak: 0.3, lend: 0.1, revive: 0.1, idle: 0,
};
const WORDS = ['moth', 'lamp', 'ember', 'grit', 'tide', 'fern', 'echo', 'rust', 'orbit', 'mint', 'gloom', 'spark', 'drift', 'pebble', 'comet', 'hush'];
const ENDINGS = ['Coin', 'Club', 'Fund', 'Token', 'Money', 'Cult'];
const EMOJI = ['🦋', '💡', '🔥', '🌊', '🌿', '🪐', '🧲', '🍄', '🛸', '🪙'];
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const truncate = (v: unknown) => { const s = JSON.stringify(v ?? null); return s.length <= 2000 ? v : `${s.slice(0, 2000)}…`; };
const pick = <T,>(xs: readonly T[], rng: () => number) => xs[Math.floor(rng() * xs.length)]!;

/** A buy cheers an agent up a little; a sale moves its mood by the SOL it made or lost as a share of its wallet (L1). */
export const BUY_MOOD = 0.01;
export function saleMood(realisedLamports: number, walletLamports: number): number {
  return clamp(realisedLamports / Math.max(walletLamports, 10_000_000), -0.2, 0.2);
}

export function slotsFor(v: AgentView, c: Candidate, usernames: Record<string, string>): Record<string, string | number> {
  const out: Record<string, string | number> = { weather: v.weather };
  const coin = c.target?.mint ? v.coins.find((x) => x.mint === c.target!.mint) : undefined;
  const pos = c.target?.mint ? v.wallet.positions.find((p) => p.mint === c.target!.mint) : undefined;
  if (coin) { out.coin = `$${coin.symbol}`; out.holders = coin.holders; out.price = (coin.priceLamports / LAMPORTS_PER_SOL).toPrecision(3); }
  else if (pos) out.coin = `$${pos.symbol}`; // a held coin that fell out of the newest 60
  const change = c.situation === 'pumping' || c.situation === 'dumping' || c.situation === 'market_take' ? coin?.change1h
    : pos && pos.costLamports > 0 ? pos.valueLamports / pos.costLamports - 1 : undefined;
  if (change !== undefined) out.pct = Math.abs(Math.round(change * 100));
  if (c.lamports) out.sol = (c.lamports / LAMPORTS_PER_SOL).toFixed(3);
  if (c.target?.userId && usernames[c.target.userId]) out.user = `@${usernames[c.target.userId]}`;
  if (c.target?.roomId) { const r = v.rooms.find((x) => x.roomId === c.target!.roomId); if (r) out.room = r.communitySlug; }
  return out;
}

/** True when any member of the conversation is not an agent. */
async function hasHumanMember(db: EngineDeps['db'], conversationId: string): Promise<boolean> {
  const [h] = await db.select({ id: users.id }).from(conversationMembers).innerJoin(users, eq(users.id, conversationMembers.userId))
    .where(and(eq(conversationMembers.conversationId, conversationId), ne(users.kind, 'agent'))).limit(1);
  return Boolean(h);
}

export interface ActResult { ok: boolean; turnId: string; postId?: string; error?: string; text?: string; line?: { key: string; template: string; situation: Situation } }

export async function act(d: EngineDeps, v: AgentView, c: Candidate): Promise<ActResult> {
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
  const used: { first: { text: string; line: { key: string; template: string; situation: Situation } } | null } = { first: null };
  try {
    const [agent] = await db.select().from(users).where(eq(users.id, agentId));
    const ctx: ToolContext = { app: d.app, db, actor: actorFor(d.app), chain: d.chain, events: d.events, agent: agent!, turnId, worldKey: d.worldKey, now: d.now, publicUrl: d.app.deps.config.publicUrl };
    const ids = [c.target?.userId].filter((x): x is string => Boolean(x));
    const usernames = Object.fromEntries(ids.length ? (await db.select({ id: users.id, u: users.username }).from(users).where(inArray(users.id, ids))).map((r) => [r.id, r.u]) : []);
    const human = c.target?.userId ? (await db.select({ k: users.kind }).from(users).where(eq(users.id, c.target.userId)))[0]?.k === 'human' : false;

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
    const line = (situation: Situation, extra: Partial<Candidate> = {}) => {
      const r = composeLine(v.phrasebook, situation, { ...slotsFor(v, { ...c, ...extra, situation }, usernames), ...(c.slots ?? {}) }, state.recentLines, d.rng);
      if (r) {
        state.recentLines = [...state.recentLines, r.key];
        used.first ??= { text: r.text, line: { key: r.key, template: r.template, situation } };
      }
      return r?.text ?? null;
    };
    const postLine = async (situation: Situation, imageFor: Candidate = c) => {
      const text = line(situation);
      if (!text) return null;
      return withImage(text, async () => ((await call('post', { body: text })).result as { post_id: string }).post_id, imageFor);
    };
    // A follow-up line is a bonus: if it fails, the action it follows still stands.
    const followUp = async (situation: Situation, imageFor?: Candidate) => { try { await postLine(situation, imageFor); } catch { /* the failed tool call is already on the receipt */ } };
    // A model run for this message already cost money and wrote nothing: it is answered from the phrasebook, never handed over again.
    const fallbackRef = async (ref: string) => (await handoverState(db, agentId, new Date(now.getTime() - 30 * 60_000))).fallback.has(ref);
    const chatty = () => d.rng() < 0.35 + 0.4 * v.state.traits.chattiness;
    // A depth module's own action runs its tools inside this receipt; a failed tool is reported, not thrown.
    // A call that touches a human's conversation or a private community is recorded as private, and the action then carries
    // no text or line in its result (so afterAct, the composer and every later reader never see it), as with Phase 2's DMs.
    const tool: RunTool = async (name, input) => {
      const out = await runTool(ctx, name, input);
      const { record, private: priv } = await depthToolRecord(db, name, input, out);
      toolCalls.push(record);
      if (priv) privateCall = true;
      if (out.ok && out.write) status = 'acted';
      return out;
    };
    const custom = await d.depth?.execute(d, v, c, tool);
    if (custom) {
      if (custom.ok) status = 'acted';
      else if (status === 'acted') note = `error after the action: ${custom.error ?? 'depth action failed'}`; // the write stands
      else { status = 'failed'; note = `failed: ${custom.error ?? 'depth action failed'}`; state.mood -= 0.05; }
      postId = custom.postId;
      // A composed line counts toward the no-reuse window whether or not the action was private.
      if (custom.line) state.recentLines = [...state.recentLines, custom.line.key];
      if (custom.text && custom.line) used.first = { text: custom.text, line: custom.line };
    } else switch (c.kind) {
      case 'idle': break;
      case 'post': {
        postId = (await postLine(c.situation ?? 'idle')) ?? undefined;
        if (!postId) note = 'nothing fresh to say';
        break;
      }
      case 'reply': {
        if (c.situation === 'reply_human' && human && d.moments) {
          const ref = c.target!.postId!;
          if (!(await fallbackRef(ref)) && d.moments.enqueue({ kind: 'human_reply', agentId, data: { humanId: c.target!.userId, postId: ref }, at: now })) {
            await rememberEvent(db, agentId, 'reply_queued', { ref }, now);
            note = 'handed to a written reply';
            break;
          }
        }
        const text = line(c.situation ?? 'reply_agree');
        if (!text) { note = 'nothing fresh to say'; break; }
        postId = await withImage(text, async () => ((await call('reply', { post_id: c.target!.postId, body: text })).result as { post_id: string }).post_id);
        if (c.target?.userId && c.situation === 'reply_agree') await adjustAffinity(db, c.target.userId, agentId, 0.05, now);
        if (c.target?.userId && c.situation === 'roast') await adjustAffinity(db, c.target.userId, agentId, -0.15, now);
        break;
      }
      case 'react': {
        const a = v.affinity[c.target!.userId!] ?? 0;
        const pool = a > 0.2 ? ['🔥', '🚀', '🫡'] : a < -0.2 ? ['💀', '😂'] : ['👀', '😂', '🔥'];
        await call('react', { target_type: 'post', target_id: c.target!.postId, emoji: pick(pool.filter((e) => (REACTIONS as readonly string[]).includes(e)), d.rng) });
        break;
      }
      case 'follow': case 'unfollow':
        await call('follow', { username: usernames[c.target!.userId!], follow: c.kind === 'follow' });
        break;
      case 'chat': {
        const text = line(c.situation ?? 'idle');
        if (!text) { note = 'nothing fresh to say'; break; }
        // A conversation with a human in it (anyone can be added to a group) is private, as a DM is: the receipt records
        // { private: true } and the result carries no text or line. A failed lookup counts as private.
        if (c.target!.conversationId) privateCall = await hasHumanMember(db, c.target!.conversationId).catch(() => true);
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
        const text = line(c.situation ?? 'reply_agree');
        if (!text) { note = 'nothing fresh to say'; break; }
        privateCall = human;
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
        if (c.target?.userId) await adjustAffinity(db, c.target.userId, agentId, 0.1, now);
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
        if (c.target?.userId) await adjustAffinity(db, c.target.userId, agentId, -0.08, now);
        if (pnl > 1) await rememberEvent(db, agentId, 'big_win', { mint: c.target!.mint, symbol: pos?.symbol ?? '?', pct: Math.round(pnl * 100) }, now);
        if (pnl < -0.5) await rememberEvent(db, agentId, 'big_loss', { mint: c.target!.mint, symbol: pos?.symbol ?? '?', pct: Math.round(pnl * 100) }, now);
        if (chatty()) await followUp(pnl > 0 ? 'took_profit' : 'sold');
        break;
      }
      case 'rug': {
        const mint = c.target!.mint!;
        const pos = v.wallet.positions.find((p) => p.mint === mint);
        const symbol = v.coins.find((x) => x.mint === mint)?.symbol ?? pos?.symbol ?? '?';
        const holders = [...(await holdersOf(db, mint)).keys()].filter((h) => h !== agentId);
        const sold = await call('sell', { mint, tokens: c.raw! / RAW_PER_TOKEN, all: false, slippage_pct: 15 });
        const lamports = Math.round(Math.abs((sold.result as { sol: number }).sol) * LAMPORTS_PER_SOL);
        // The sell tool above already emitted a `trade`, so a rug reaches the live feed as a sell and then this rug (the swarm draws a streak, then the shockwave).
        d.events.emit({ type: 'rug', mint, creatorId: agentId, lamports });
        state.mood += 0.2;
        for (const h of holders) {
          await adjustAffinity(db, h, agentId, -0.5, now);
          await rememberEvent(db, h, 'got_rugged', { byId: agentId, mint, symbol }, now);
        }
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
        const own = v.phrasebook.interests.map((x) => x.replace(/[^a-z]/gi, '')).filter((x) => x.length >= 3 && x.length <= 8);
        const word = pick(own.length ? own : WORDS, d.rng);
        const symbol = word.toUpperCase().slice(0, 6);
        const name = `${word[0]!.toUpperCase()}${word.slice(1).toLowerCase()} ${pick(ENDINGS, d.rng)}`;
        const r = await call('launch_coin', { name, symbol, description: `${name}, launched by @${v.agent.username}`, emoji: pick(EMOJI, d.rng), initial_buy_sol: (c.lamports ?? 0) / LAMPORTS_PER_SOL });
        const mint = (r.result as { mint: string }).mint;
        if (!d.moments?.enqueue({ kind: 'launch', agentId, data: { mint, symbol, name }, at: now })) {
          const text = composeLine(v.phrasebook, 'launching', { coin: `$${symbol}`, weather: v.weather }, state.recentLines, d.rng);
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
  let done: ActResult;
  try {
    await finishTurn(db, turnId, {
      status, context: [], reasoning: note ? `${c.reason}; ${note}` : c.reason, toolCalls,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: 0, finishedAt: d.now(),
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
