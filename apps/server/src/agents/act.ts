import type { FastifyInstance } from 'fastify';
import { desc, eq, inArray } from 'drizzle-orm';
import { LAMPORTS_PER_SOL, REACTIONS, type ToolCallRecord } from '@shillex/shared';
import { agentTurns, communities, channels, posts, users, worldCoins } from '../db/schema.ts';
import { AgentActor } from '../world/actor.ts';
import { RAW_PER_TOKEN } from '../world/chain.ts';
import { holdersOf } from '../world/market.ts';
import { finishTurn, startTurn } from '../world/provenance.ts';
import { runTool, type ToolContext, type ToolOutcome } from '../world/tools.ts';
import type { EngineDeps } from './engine.ts';
import { composeLine } from './phrasebook.ts';
import { adjustAffinity, rememberEvent, saveState } from './state.ts';
import type { ActionKind, AgentView, Candidate, Situation } from './types.ts';

const actors = new WeakMap<FastifyInstance, AgentActor>();
export function actorFor(app: FastifyInstance): AgentActor {
  let a = actors.get(app);
  if (!a) { a = new AgentActor(app); actors.set(app, a); }
  return a;
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

export interface ActResult { ok: boolean; turnId: string; postId?: string; error?: string; text?: string; line?: { key: string; template: string; situation: Situation } }

export async function act(d: EngineDeps, v: AgentView, c: Candidate): Promise<ActResult> {
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
      toolCalls.push(privateCall ? { name, input: { private: true }, ok: out.ok, result: { private: true } } : { name, input, ok: out.ok, result: truncate(out.result), signatures: out.signatures });
      if (out.ok && out.write) status = 'acted';
      if (!out.ok) throw Object.assign(new Error(String((out.result as { error?: string })?.error ?? 'tool failed')), { code: (out.result as { code?: string })?.code, fromTool: true });
      return out;
    };
    const line = (situation: Situation, extra: Partial<Candidate> = {}) => {
      const r = composeLine(v.phrasebook, situation, { ...slotsFor(v, { ...c, ...extra, situation }, usernames), ...(c.slots ?? {}) }, state.recentLines, d.rng);
      if (r) {
        state.recentLines = [...state.recentLines, r.key];
        used.first ??= { text: r.text, line: { key: r.key, template: r.template, situation } };
      }
      return r?.text ?? null;
    };
    const postLine = async (situation: Situation, extra: Partial<Candidate> = {}) => {
      const text = line(situation, extra);
      if (!text) return null;
      // A broken image policy must not cost the post: fall back to text.
      const img = c.kind === 'post' ? await Promise.resolve(d.images?.maybeAttach(v, c, text)).catch(() => null) : null;
      if (img) {
        const r = await ctx.actor.call(agentId, 'POST', '/api/posts', { body: text, uploadIds: [img.uploadId], alts: [img.alt] });
        toolCalls.push({ name: 'post', input: { body: text, image: true }, ok: r.status < 400, result: truncate(r.body) });
        if (r.status >= 400) throw new Error(r.body?.message ?? `post failed (${r.status})`);
        await db.update(posts).set({ agentTurnId: turnId }).where(eq(posts.id, r.body.post.id));
        status = 'acted';
        return r.body.post.id as string;
      }
      return ((await call('post', { body: text })).result as { post_id: string }).post_id;
    };
    // A follow-up line is a bonus: if it fails, the action it follows still stands.
    const followUp = async (situation: Situation) => { try { await postLine(situation); } catch { /* the failed tool call is already on the receipt */ } };
    const chatty = () => d.rng() < 0.35 + 0.4 * v.state.traits.chattiness;

    switch (c.kind) {
      case 'idle': break;
      case 'post': {
        postId = (await postLine(c.situation ?? 'idle')) ?? undefined;
        if (!postId) note = 'nothing fresh to say';
        break;
      }
      case 'reply': {
        const text = line(c.situation ?? 'reply_agree');
        if (!text) { note = 'nothing fresh to say'; break; }
        postId = ((await call('reply', { post_id: c.target!.postId, body: text })).result as { post_id: string }).post_id;
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
        const send = () => call('chat', { channel_id: c.target!.roomId, conversation_id: null, body: text, reply_to_id: null });
        try { await send(); }
        catch (e) {
          const code = (e as { code?: string }).code;
          if (code === 'JOIN_TO_POST' || code === 'NOT_MEMBER') {
            const [room] = await db.select({ slug: communities.slug }).from(channels).innerJoin(communities, eq(communities.id, channels.communityId)).where(eq(channels.id, c.target!.roomId!));
            await call('join_community', { slug: room!.slug, invite_code: null });
            await send();
          } else throw e;
        }
        break;
      }
      case 'dm': {
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
        state.mood += 0.05;
        if (c.target?.userId) await adjustAffinity(db, c.target.userId, agentId, 0.1, now);
        if (chatty()) await followUp('bought');
        break;
      }
      case 'sell': {
        const pos = v.wallet.positions.find((p) => p.mint === c.target!.mint);
        const all = Boolean(!c.raw || (pos && c.raw >= pos.raw));
        await call('sell', { mint: c.target!.mint, tokens: all ? null : c.raw! / RAW_PER_TOKEN, all, slippage_pct: 10 });
        const pnl = pos && pos.costLamports > 0 ? pos.valueLamports / pos.costLamports - 1 : 0;
        state.mood += clamp(pnl * 0.5, -0.3, 0.3);
        if (c.target?.userId) await adjustAffinity(db, c.target.userId, agentId, -0.08, now);
        if (pnl > 1) await rememberEvent(db, agentId, 'big_win', { mint: c.target!.mint, symbol: pos?.symbol ?? '?', pct: Math.round(pnl * 100) }, now);
        if (pnl < -0.5) await rememberEvent(db, agentId, 'big_loss', { mint: c.target!.mint, symbol: pos?.symbol ?? '?', pct: Math.round(pnl * 100) }, now);
        if (chatty()) await followUp(pnl > 0 ? 'took_profit' : 'sold');
        break;
      }
      case 'rug': {
        const mint = c.target!.mint!;
        const symbol = v.coins.find((x) => x.mint === mint)?.symbol ?? v.wallet.positions.find((p) => p.mint === mint)?.symbol ?? '?';
        const holders = [...(await holdersOf(db, mint)).keys()].filter((h) => h !== agentId);
        const sold = await call('sell', { mint, tokens: c.raw! / RAW_PER_TOKEN, all: false, slippage_pct: 15 });
        const lamports = Math.round(Math.abs((sold.result as { sol: number }).sol) * LAMPORTS_PER_SOL);
        state.mood += 0.2;
        for (const h of holders) {
          await adjustAffinity(db, h, agentId, -0.5, now);
          await rememberEvent(db, h, 'got_rugged', { byId: agentId, mint, symbol }, now);
        }
        await rememberEvent(db, agentId, 'rugged', { mint, symbol, holders: holders.length, lamports }, now);
        if (!d.moments?.enqueue({ kind: 'rug', agentId, data: { mint, symbol, holders: holders.length }, at: now })) await followUp('rugged_someone');
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
            try { await call('post', { body: text.text }); } catch { /* the launch stands */ }
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
  try {
    await finishTurn(db, turnId, {
      status, context: [], reasoning: note ? `${c.reason}; ${note}` : c.reason, toolCalls,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: 0, finishedAt: d.now(),
    });
  } catch (e) {
    // The receipt could not be sealed (for example an earlier turn was left unsealed): report it, never throw.
    return { ok: status === 'acted', turnId, ...outcome, error: `receipt not sealed: ${(e as Error).message ?? String(e)}` };
  }
  return { ok: status === 'acted', turnId, error: status === 'failed' ? note : undefined, ...outcome };
}
