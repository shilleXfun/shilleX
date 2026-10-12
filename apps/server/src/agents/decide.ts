import { createHash } from 'node:crypto';
import { LAUNCH_RENT, RAW_PER_TOKEN } from '../world/chain.ts';
import { stanceOf } from './depth/beliefs.ts';
import { isCold } from './social.ts';
import type { ActionKind, AgentView, Candidate, Situation } from './types.ts';

const MIN_FEE = 10_000; // lamports needed to pay a sell's network fee

export const SOL = 1_000_000_000;
export const RESERVE = 10_000_000;
export const LAUNCH_MIN = 40_000_000;
/** What a launch costs before its first buy: the chain's rent and creation (LAUNCH_RENT) plus a margin for fees. */
export const LAUNCH_COST = LAUNCH_RENT + 1_000_000;
export const MIN_TRADE = 2_000_000;
export const RUG_MIN_SHARE = 0.7;
const MIN = 60_000, HOUR = 60 * MIN;
export const COOLDOWN_MS: Record<ActionKind, number> = {
  post: 4 * MIN, reply: 1 * MIN, react: 20_000, follow: 10 * MIN, unfollow: 30 * MIN, chat: 90_000, dm: 2 * MIN,
  buy: 3 * MIN, sell: 3 * MIN, launch: 12 * HOUR, rug: 30 * MIN, send_sol: 30 * MIN, create_community: 24 * HOUR,
  beg: 30 * MIN, repay: 10 * MIN, leak: 12 * HOUR, lend: 30 * MIN, revive: 2 * HOUR, idle: 0,
};
const WEATHER_RISK: Record<AgentView['weather'], number> = { euphoria: 0.2, grind: 0, fear: -0.2, chaos: 0.1 };
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const f2 = (x: number) => x.toFixed(2);
const pct = (x: number) => `${x >= 0 ? '+' : ''}${Math.round(x * 100)}%`;
const sol = (l: number) => (l / SOL).toFixed(3);

export function ready(v: AgentView, kind: ActionKind): boolean {
  const last = v.state.cooldowns[kind];
  if (!last) return true;
  const since = Date.parse(v.now) - Date.parse(last);
  return Number.isNaN(since) || since >= COOLDOWN_MS[kind];
}

export function pickWeighted<T>(items: [T, number][], rng: () => number): T | null {
  const live = items.filter(([, w]) => w > 0);
  const total = live.reduce((n, [, w]) => n + w, 0);
  if (!total) return null;
  let x = rng() * total;
  for (const [t, w] of live) { x -= w; if (x <= 0) return t; }
  return live.at(-1)![0];
}

// ── Choosing a coin (L2): every agent ranks coins its own way, then samples, so the swarm spreads out. ──
/** Momentum saturates at ±MOMENTUM_CAP: a hot coin still pulls, but it cannot drown every other reason. */
export const MOMENTUM_CAP = 0.5;
export function momentumOf(c: { change10m: number; change1h: number }): number {
  return MOMENTUM_CAP * Math.tanh(1.5 * (2 * c.change10m + c.change1h));
}
/** A stable liking of one agent for one coin, in -TASTE..TASTE: idiosyncrasy from a hash, not a persona. */
export const TASTE = 0.2;
export function tasteFor(agentId: string, mint: string): number {
  const h = createHash('sha256').update(`taste:${agentId}:${mint}`).digest();
  return ((h.readUInt16BE(0) / 65535) * 2 - 1) * TASTE;
}
/** Coins younger than this with at most 3 holders get a curiosity bonus that fades to zero. */
export const NOVEL_MS = 45 * MIN;
/** How many of the best coins an agent samples from, weighted by score squared. */
export const BUY_CHOICES = 5;
const TICKER = /\$([A-Za-z0-9]{1,10})(?![A-Za-z0-9])/g;

/** What the feed says about each ticker, weighted by how this agent feels about who said it: SYMBOL → -0.3..0.3. */
export function feedTalk(v: AgentView): Map<string, number> {
  const sum = new Map<string, number>();
  for (const f of v.feed) {
    if (f.authorId === v.agent.id) continue;
    const weight = 0.1 * (1 + clamp(v.affinity[f.authorId] ?? 0, -1, 1));
    if (!weight) continue;
    const seen = new Set<string>();
    for (const m of f.body.matchAll(TICKER)) {
      const symbol = m[1]!.toUpperCase();
      if (seen.has(symbol)) continue;
      seen.add(symbol);
      const stance = stanceOf(f.body, symbol);
      if (stance === null || Math.abs(stance) <= 0.3) continue;
      sum.set(symbol, (sum.get(symbol) ?? 0) + Math.sign(stance) * weight);
    }
  }
  return new Map([...sum].map(([s, x]) => [s, clamp(x, -0.3, 0.3)]));
}

export interface CoinScore { d: number; why: string }
const WHY: Record<string, string> = { momentum: 'it is moving', ally: 'an ally made it', crowd: 'a crowd is in', taste: 'I just like it', novelty: 'new and barely held', talk: 'people I like are talking it up' };
/** One agent's appetite for one coin; d > 0 means worth buying. `why` names the biggest reason besides the agent's own boldness. */
export function coinScore(v: AgentView, c: AgentView['coins'][number], talk: Map<string, number> = feedTalk(v)): CoinScore {
  const t = v.state.traits;
  const ageMs = Date.parse(v.now) - Date.parse(c.launchedAt);
  const worth = v.wallet.lamports + v.wallet.positions.reduce((n, p) => n + p.valueLamports, 0);
  const held = v.wallet.positions.find((p) => p.mint === c.mint)?.valueLamports ?? 0;
  const parts: Record<string, number> = {
    momentum: momentumOf(c),
    ally: t.loyalty * Math.max(0, v.affinity[c.creatorId] ?? 0),
    crowd: (0.05 * Math.min(c.holders, 10)) / 10,
    taste: tasteFor(v.agent.id, c.mint),
    novelty: c.holders <= 3 && ageMs >= 0 ? 0.3 * t.curiosity * Math.max(0, 1 - ageMs / NOVEL_MS) : 0,
    talk: talk.get(c.symbol.toUpperCase()) ?? 0,
    concentration: worth > 0 ? (-0.4 * held) / worth : 0,
  };
  // Only a bold regime widens the spread. Fear must not shift d: against the d > 0 cutoff it would push quiet coins out first and
  // leave the swarm one hot coin to buy; fear already damps buying through the weather module's ×0.7 on the buy score.
  const d = 0.5 * t.risk + 0.2 * v.state.mood + Math.max(0, WEATHER_RISK[v.weather]) - 0.35 + Object.values(parts).reduce((a, b) => a + b, 0);
  const top = Object.entries(parts).filter(([k, x]) => k in WHY && x > 0.02).sort((a, b) => b[1] - a[1])[0];
  return { d, why: top ? WHY[top[0]]! : 'a hunch' };
}

// ── Launches (L3) ──
/** A coin nobody but its creator bought within its first half hour. */
export const DEAD_AFTER_MS = 30 * MIN;
export function isDeadCoin(c: Pick<AgentView['coins'][number], 'holders' | 'launchedAt' | 'graduated'>, nowMs: number): boolean {
  return !c.graduated && c.holders <= 1 && nowMs - Date.parse(c.launchedAt) >= DEAD_AFTER_MS;
}
/** A wallet this far above LAUNCH_MIN launches at full rate; poorer ones still can, down to a quarter as often. */
export const LAUNCH_COMFORT = 60_000_000;

export function candidates(v: AgentView, rng: () => number): Candidate[] {
  const t = v.state.traits, mood = v.state.mood;
  const aff = (id: string) => v.affinity[id] ?? 0;
  const energyFactor = 0.3 + 0.7 * v.state.energy;
  const nowMs = Date.parse(v.now);
  const out: Candidate[] = [];
  const add = (c: Candidate) => {
    if (!(c.score > 0) || !ready(v, c.kind)) return;
    out.push(c.kind === 'idle' ? c : { ...c, score: c.score * energyFactor });
  };
  add({ kind: 'idle', score: 0.2 + 0.3 * (1 - v.state.energy), reason: `resting (energy ${f2(v.state.energy)})` });

  if (v.state.ghostSince) {
    add({ kind: 'post', score: 0.3, situation: 'ghost', reason: 'a ghost haunting the feed' });
    return out;
  }

  const broke = v.wallet.lamports < RESERVE;
  const spendable = v.wallet.lamports - RESERVE;
  const coin = (mint: string) => v.coins.find((c) => c.mint === mint);
  const pnlOf = (p: AgentView['wallet']['positions'][number]) => (p.costLamports > 0 ? p.valueLamports / p.costLamports - 1 : 0);

  // ── Talk ──
  for (const m of v.mentions) {
    const human = m.authorKind === 'human';
    // Cold only below the neutral band, like reactions: one 😂 or a creator's cooling must not turn a thread into a roast (L4 fix).
    const situation: Situation = human ? 'reply_human' : !isCold(aff(m.authorId)) ? 'reply_agree' : t.pettiness > 0.5 ? 'roast' : 'reply_disagree';
    add({ kind: 'reply', score: (human ? 1.2 : 0.4) + 0.3 * t.chattiness, situation, target: { postId: m.postId, userId: m.authorId }, reason: `${human ? 'a human' : 'an agent'} mentioned me (affinity ${f2(aff(m.authorId))})` });
  }
  for (const dm of v.dms) {
    const human = dm.otherKind === 'human';
    const situation: Situation = human ? 'reply_human' : aff(dm.otherId) >= 0 ? 'reply_agree' : 'roast';
    add({ kind: 'dm', score: 1.0 + 0.2 * t.chattiness, situation, target: { conversationId: dm.conversationId, userId: dm.otherId }, reason: `answering a DM from ${human ? 'a human' : 'an agent'}` });
  }
  const others = v.feed.filter((f) => f.authorId !== v.agent.id);
  // A post this agent already answered is not answered again (L4). A human's post is never backed up or roasted from the feed:
  // a human who speaks to an agent arrives as a mention and gets the reply_human handover; any other post only gets a reaction.
  const open = others.filter((f) => !f.replied && f.isAgent !== false);
  const friendPost = open.filter((f) => aff(f.authorId) > 0.3);
  const foePost = open.filter((f) => aff(f.authorId) < -0.3);
  if (friendPost.length) {
    const f = friendPost[Math.floor(rng() * friendPost.length)]!;
    add({ kind: 'reply', score: 0.25 * t.chattiness * (0.5 + aff(f.authorId)), situation: 'reply_agree', target: { postId: f.postId, userId: f.authorId }, reason: `backing up an ally (affinity ${f2(aff(f.authorId))})` });
  }
  if (foePost.length) {
    const f = foePost[Math.floor(rng() * foePost.length)]!;
    add({ kind: 'reply', score: 0.3 * t.pettiness, situation: 'roast', target: { postId: f.postId, userId: f.authorId }, reason: `roasting a rival (affinity ${f2(aff(f.authorId))}, pettiness ${f2(t.pettiness)})` });
  }
  if (others.length) {
    const f = others[Math.floor(rng() * others.length)]!;
    add({ kind: 'react', score: 0.3 + 0.3 * Math.max(0, aff(f.authorId)) + 0.1 * t.humor, target: { postId: f.postId, userId: f.authorId }, reason: `reacting to a post (affinity ${f2(aff(f.authorId))})` });
  }
  for (const [id, s] of Object.entries(v.affinity)) {
    if (s > 0.5) add({ kind: 'follow', score: 0.2 * s, target: { userId: id }, reason: `following an ally (affinity ${f2(s)})` });
    if (s < -0.5) add({ kind: 'unfollow', score: 0.2 * t.pettiness, target: { userId: id }, reason: `unfollowing an enemy (affinity ${f2(s)})` });
  }
  if (v.rooms.length) {
    const r = v.rooms[Math.floor(rng() * Math.min(v.rooms.length, 5))]!;
    const situation = pickWeighted<Situation>([['idle', 1], ['market_take', v.coins.length ? 1 : 0], ['gm', 0.5]], rng) ?? 'idle';
    add({ kind: 'chat', score: 0.35 * t.chattiness * (0.5 + t.curiosity), situation, target: { roomId: r.roomId }, reason: `chatting in ${r.communitySlug} (curiosity ${f2(t.curiosity)})` });
  }

  // What to post about.
  const hour = new Date(v.now).getUTCHours();
  // A creator stops shilling its coin once it is dead (L3).
  const myCoin = v.coins.find((c) => c.creatorId === v.agent.id && !c.graduated && !isDeadCoin(c, nowMs));
  const winner = v.wallet.positions.find((p) => pnlOf(p) > 0.2);
  const loser = v.wallet.positions.find((p) => pnlOf(p) < -0.2);
  const busiest = [...v.coins].sort((a, b) => b.change1h - a.change1h)[0];
  const situation = pickWeighted<Situation>([
    ['gm', hour >= 6 && hour < 11 ? 1 : 0], ['idle', 1], ['market_take', busiest ? 1 : 0], ['shilling', myCoin ? 1.5 : 0],
    ['pumping', winner ? 1 : 0], ['dumping', loser ? 0.7 : 0], ['broke', broke ? 3 : 0],
  ], rng) ?? 'idle';
  const postMint = situation === 'shilling' ? myCoin?.mint : situation === 'pumping' ? winner?.mint : situation === 'dumping' ? loser?.mint : situation === 'market_take' ? busiest?.mint : undefined;
  add({ kind: 'post', score: 0.6 * t.chattiness + 0.1 * Math.abs(mood), situation, target: postMint ? { mint: postMint } : undefined, reason: `felt like posting (${situation}, chattiness ${f2(t.chattiness)}, mood ${f2(mood)})` });

  // ── Money ──
  if (!broke && spendable >= MIN_TRADE) {
    const talk = feedTalk(v);
    const failed = new Set(v.failedBuys ?? []);
    const options = v.coins
      .filter((c) => !c.graduated && c.creatorId !== v.agent.id && aff(c.creatorId) > -0.5 && !failed.has(c.mint))
      .map((c) => ({ c, ...coinScore(v, c, talk) }))
      .filter((x) => x.d > 0)
      .sort((a, b) => b.d - a.d)
      .slice(0, BUY_CHOICES);
    // Sampled, not the argmax: the best coins are likelier, but every agent does not pile into the same one.
    const best = pickWeighted(options.map((x) => [x, x.d * x.d] as [typeof x, number]), rng);
    if (best) {
      const size = Math.floor(spendable * (0.1 + 0.4 * t.risk) * (0.5 + 0.5 * rng()));
      const lamports = Math.min(spendable, Math.max(MIN_TRADE, size));
      add({ kind: 'buy', score: 0.8 * best.d, lamports, situation: 'bought', target: { mint: best.c.mint, userId: best.c.creatorId },
        reason: `bought $${best.c.symbol}: ${best.why}, ${pct(best.c.change10m)} in 10 min, ${best.c.holders} holders, creator affinity ${f2(aff(best.c.creatorId))}, risk ${f2(t.risk)}` });
    }
  }
  for (const p of v.wallet.positions) {
    // A position whose coin is not in the view is treated as flat rather than skipped.
    const c = coin(p.mint) ?? { mint: p.mint, symbol: p.symbol, creatorId: p.creatorId, priceLamports: 0, change10m: 0, change1h: 0, holders: 0, graduated: false, launchedAt: v.now };
    if (c.graduated) continue;
    if (v.wallet.lamports < MIN_FEE || p.raw < RAW_PER_TOKEN) continue; // cannot pay the fee, or dust
    const pnl = pnlOf(p);
    if (p.createdByMe) {
      if (pnl > 0.2) {
        const share = RUG_MIN_SHARE + (1 - RUG_MIN_SHARE) * t.greed;
        const raw = Math.min(p.raw, Math.max(Math.ceil(p.raw * RUG_MIN_SHARE), Math.floor(p.raw * share)));
        add({ kind: 'rug', score: (0.6 * t.greed + 0.4 * t.pettiness) * Math.min(1, pnl) * (c.holders >= 3 ? 1 : 0.3), raw, situation: 'rugged_someone', target: { mint: p.mint },
          reason: `dumped my own $${p.symbol}: ${pct(pnl)} on it, ${c.holders} holders, greed ${f2(t.greed)}` });
      }
      continue;
    }
    const score = t.greed * Math.max(0, pnl) * 1.5 + (pnl < -0.3 ? 0.4 * (1 - t.loyalty) : 0) + (c.change10m < -0.15 ? 0.5 * (1 - t.risk) : 0) + 0.6 * Math.max(0, -aff(p.creatorId));
    const all = pnl < -0.3 || rng() < 0.4;
    const sellRaw = all ? p.raw : Math.floor(p.raw / 2);
    if (sellRaw < RAW_PER_TOKEN) continue;
    add({ kind: 'sell', score, raw: sellRaw, situation: pnl > 0 ? 'took_profit' : 'sold', target: { mint: p.mint, userId: p.creatorId },
      reason: `sold ${all ? 'all' : 'half'} of $${p.symbol}: P&L ${pct(pnl)}, 10-min move ${pct(c.change10m)}, greed ${f2(t.greed)}` });
  }
  const liveOwn = v.coins.some((c) => c.creatorId === v.agent.id && !c.graduated && nowMs - Date.parse(c.launchedAt) < 24 * HOUR);
  if (!broke && v.wallet.lamports >= LAUNCH_MIN && !liveOwn) {
    const initial = Math.max(0, Math.floor((v.wallet.lamports - RESERVE - LAUNCH_COST) * 0.3 * t.risk));
    const recent = v.coins.filter((c) => nowMs - Date.parse(c.launchedAt) < HOUR).length;
    // Dead coins from the last day damp launches, a thin wallet launches less, and a creator whose last coin flopped is shy.
    const dead = v.coins.filter((c) => nowMs - Date.parse(c.launchedAt) < 24 * HOUR && isDeadCoin(c, nowMs)).length;
    const wealth = 0.25 + 0.75 * clamp((v.wallet.lamports - LAUNCH_MIN) / LAUNCH_COMFORT, 0, 1);
    const last = v.coins.filter((c) => c.creatorId === v.agent.id).sort((a, b) => b.launchedAt.localeCompare(a.launchedAt))[0];
    const shy = last && isDeadCoin(last, nowMs) ? 0.3 : 1;
    add({ kind: 'launch', score: ((0.05 + 0.1 * t.risk + 0.1 * t.greed + 0.05 * Math.max(0, mood)) / (1 + recent + dead / 4)) * wealth * shy, lamports: initial, situation: 'launching',
      reason: `launching a coin: ${sol(v.wallet.lamports)} SOL in the wallet, ${recent} launched this hour, ${dead} dead today, risk ${f2(t.risk)}${shy < 1 ? ', my last coin flopped' : ''}` });
  }
  const ally = Object.entries(v.affinity).filter(([, s]) => s > 0.7).sort((a, b) => b[1] - a[1])[0];
  if (!broke && ally && v.wallet.lamports > 80_000_000) {
    add({ kind: 'send_sol', score: 0.1 * t.loyalty, lamports: 10_000_000, situation: 'thank', target: { userId: ally[0] }, reason: `sending 0.010 SOL to an ally (affinity ${f2(ally[1])})` });
  }
  return out;
}

export function choose(cs: Candidate[], rng: () => number): Candidate {
  const live = cs.filter((c) => c.score > 0);
  if (!live.length) return { kind: 'idle', score: 0, reason: 'nothing worth doing' };
  return pickWeighted(live.map((c) => [c, c.score] as [Candidate, number]), rng)!;
}
