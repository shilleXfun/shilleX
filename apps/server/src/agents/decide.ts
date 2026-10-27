import { createHash } from 'node:crypto';
import { LAUNCH_RENT, RAW_PER_TOKEN } from '../world/chain.ts';
import { stanceOf } from './depth/beliefs.ts';
import { isCold } from './social.ts';
import { PLANS, strategyOf, type Strategy } from './strategies.ts';
import type { ActionKind, AgentView, Candidate, DeskStyleName, Situation } from './types.ts';

const MIN_FEE = 10_000; // lamports needed to pay a sell's network fee
/** A position worth less than this is not worth a sale (four fees). */
export const DUST_BAG = 4 * MIN_FEE;

export const SOL = 1_000_000_000;
export const RESERVE = 10_000_000;
export const LAUNCH_MIN = 40_000_000;
/** What a launch costs before its first buy: the chain's rent and creation (LAUNCH_RENT) plus a margin for fees. */
export const LAUNCH_COST = LAUNCH_RENT + 1_000_000;
export const MIN_TRADE = 2_000_000;
export const RUG_MIN_SHARE = 0.7;
/**
 * A rug is a betrayal, not a way to cash out: possible, but rare and in character. It takes a real gain on the coin (RUG_GAIN),
 * a greedy or petty streak that loyalty does not cancel, and a day since the agent's last one (RUG_REST_MS, on top of the
 * rug cooldown other code shares); RUG_SCALE keeps even a ruthless agent choosing it on few turns.
 */
export const RUG_GAIN = 0.5, RUG_SCALE = 0.25;
export const RUG_REST_MS = 24 * 60 * 60_000;
/** Kinds that move SOL or tokens: a frozen ledger takes none of them (mainnet spec §5). */
export const MONEY_KINDS: ReadonlySet<ActionKind> = new Set<ActionKind>(['buy', 'sell', 'launch', 'rug', 'send_sol', 'lend', 'repay', 'revive']);
const MIN = 60_000, HOUR = 60 * MIN;
export const COOLDOWN_MS: Record<ActionKind, number> = {
  post: 4 * MIN, reply: 1 * MIN, react: 20_000, follow: 10 * MIN, unfollow: 30 * MIN, chat: 90_000, dm: 2 * MIN,
  buy: 3 * MIN, sell: 3 * MIN, launch: 12 * HOUR, rug: 30 * MIN, send_sol: 30 * MIN, create_community: 24 * HOUR,
  beg: 30 * MIN, repay: 10 * MIN, leak: 12 * HOUR, lend: 30 * MIN, revive: 2 * HOUR, event: 2 * MIN, idle: 0,
};
/**
 * The desk (2026-10-24 upgrade): Shillex's own agents trade less and on a plan. They buy at most once per HOUSE_BUY_REST_MS,
 * never chase a coin already up more than CHASE_AT in the hour, keep at most MAX_POSITION_SHARE of their worth in one coin,
 * and launch only with HOUSE_LAUNCH_MIN in the wallet. COOLDOWN_MS stays the rule outside agents read through the API.
 */
export const HOUSE_BUY_REST_MS = 10 * 60_000;
export const CHASE_AT = 0.4;
export const MAX_POSITION_SHARE = 0.15;
export const HOUSE_LAUNCH_MIN = 60_000_000;
const WEATHER_RISK: Record<AgentView['weather'], number> = { euphoria: 0.2, grind: 0, fear: -0.2, chaos: 0.1 };
/**
 * The plan a buy opens, from its strategy's base (agents/strategies.ts PLANS: a sniper aims high and leaves within hours, diamond
 * hands give a trade two days and a wide stop): the greedy aim higher, the bold give a trade more room before the stop, the loyal
 * give it longer (0.7x to 1.3x the strategy's time), and more conviction aims a little higher still.
 */
export function planFor(t: AgentView['state']['traits'], style: DeskStyleName, conviction: number, reason: string): NonNullable<Candidate['thesis']> {
  const p = PLANS[strategyOf(style)];
  const targetPct = p.target + 0.6 * t.greed + 0.15 * conviction;
  const stopPct = -(p.stop + 0.2 * t.risk);
  return { targetPct, stopPct, horizonMs: p.horizonH * (0.7 + 0.6 * t.loyalty) * 3_600_000, conviction, reason };
}
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
const WHY: Record<string, string> = { momentum: 'it is moving', ally: 'an ally made it', crowd: 'a crowd is in', taste: 'it fits my taste', novelty: 'new and barely held', talk: 'people I like are talking it up', trust: 'its creator has a clean record', dip: 'it dipped and the creator is solid', watch: 'it is on my watchlist', curve: 'its curve is filling with real holders', product: 'its creator ships a product people use' };
/**
 * How each strategy (agents/strategies.ts) weighs what a Shillex coin shows: its momentum, how new it is, a dip, what the feed says,
 * an ally behind it, how many hold it, its creator's record, a curve half filled and a creator who ships a product. The same reads
 * the paper desk makes of real coins: a sniper gets in first, a holder analyst wants a wide base, a copy-trader follows its allies.
 */
type StyleWeights = { momentum: number; novelty: number; dip: number; talk: number; ally: number; crowd: number; trust: number; curve: number; product: number };
const STYLE: Record<Strategy, StyleWeights> = {
  momentum: { momentum: 1, novelty: 0.6, dip: 0, talk: 1, ally: 1, crowd: 1, trust: 1, curve: 0, product: 0.3 },
  contrarian: { momentum: -0.4, novelty: 0.5, dip: 1, talk: -0.5, ally: 1, crowd: 0.5, trust: 1, curve: 0, product: 0.3 },
  holders: { momentum: 0.3, novelty: 0.5, dip: 0.3, talk: 0.5, ally: 0.5, crowd: 4, trust: 1.5, curve: 1, product: 0.5 },
  narrative: { momentum: 0.5, novelty: 0.5, dip: 0, talk: 2.5, ally: 1, crowd: 1, trust: 1, curve: 0, product: 0.5 },
  copy: { momentum: 0.3, novelty: 0.3, dip: 0, talk: 1.5, ally: 2.5, crowd: 1, trust: 1, curve: 0, product: 0.3 },
  whale: { momentum: 0.3, novelty: 0, dip: 0.6, talk: 0.5, ally: 1, crowd: 2, trust: 2, curve: 1, product: 0.5 },
  sniper: { momentum: 0.5, novelty: 2, dip: 0, talk: 0.5, ally: 1, crowd: 0.5, trust: 1, curve: 0, product: 0.3 },
  diamond: { momentum: 0.3, novelty: 0.5, dip: 0.6, talk: 0.5, ally: 1.5, crowd: 1, trust: 2, curve: 0.5, product: 1 },
  gambler: { momentum: 1.5, novelty: 1, dip: 0, talk: 1, ally: 0.5, crowd: 0.5, trust: 0.5, curve: 0, product: 0 },
};
/** Hybrid mode: the launch sniper and the holder analyst are the main buyers of Shillex coins; the others mostly trade on paper. */
export const WORLD_APPETITE: Record<Strategy, number> = { sniper: 1.3, holders: 1.3, momentum: 0.6, contrarian: 0.6, narrative: 0.6, copy: 0.6, whale: 0.5, diamond: 0.6, gambler: 0.8 };
/** One agent's appetite for one coin; d > 0 means worth buying. `why` names the biggest reason besides the agent's own boldness. */
export function coinScore(v: AgentView, c: AgentView['coins'][number], talk: Map<string, number> = feedTalk(v)): CoinScore {
  const t = v.state.traits, desk = v.depth.desk;
  const style = STYLE[strategyOf(desk?.style)];
  const ageMs = Date.parse(v.now) - Date.parse(c.launchedAt);
  const worth = v.wallet.lamports + v.wallet.positions.reduce((n, p) => n + p.valueLamports, 0);
  const held = v.wallet.positions.find((p) => p.mint === c.mint)?.valueLamports ?? 0;
  const trust = v.depth.reputation[c.creatorId] ?? 0;
  const parts: Record<string, number> = {
    momentum: style.momentum * momentumOf(c),
    ally: style.ally * t.loyalty * Math.max(0, v.affinity[c.creatorId] ?? 0),
    crowd: (style.crowd * 0.05 * Math.min(c.holders, 10)) / 10,
    taste: tasteFor(v.agent.id, c.mint),
    novelty: c.holders <= 3 && ageMs >= 0 ? style.novelty * 0.3 * t.curiosity * Math.max(0, 1 - ageMs / NOVEL_MS) : 0,
    talk: style.talk * (talk.get(c.symbol.toUpperCase()) ?? 0),
    concentration: worth > 0 ? (-0.4 * held) / worth : 0,
    // A creator with a clean record is worth backing; one with rugs behind it is not.
    trust: 0.2 * style.trust * clamp(trust, -1, 1),
    // A curve between a sixth and most of the way full has real holders and room left; the creator's live product is a reason to hold.
    curve: c.curve !== undefined && c.curve > 0.15 && c.curve < 0.85 ? 0.15 * style.curve : 0,
    product: c.creatorShips ? 0.15 * style.product : 0,
    // Buying a dip only makes sense when the creator can be trusted not to be the one dumping.
    dip: c.change1h < -0.15 && trust > 0 ? style.dip * Math.min(0.3, -c.change1h) : 0,
    // Never chase: a coin already up a lot this hour is where the late buyers get dumped on.
    chase: c.change1h > CHASE_AT ? -0.8 * (c.change1h - CHASE_AT) : 0,
    watch: desk?.watch.includes(c.symbol.toUpperCase()) ? 0.15 : 0,
  };
  // Only a bold regime widens the spread. Fear must not shift d: against the d > 0 cutoff it would push quiet coins out first and
  // leave the swarm one hot coin to buy; fear already damps buying through the weather module's ×0.7 on the buy score.
  // The bar is higher than before the desk (-0.45, was -0.35): fewer, better buys, fewer fees.
  const risk = desk ? (t.risk + desk.risk) / 2 : t.risk;
  const d = 0.5 * risk + 0.2 * v.state.mood + Math.max(0, WEATHER_RISK[v.weather]) - 0.45 + Object.values(parts).reduce((a, b) => a + b, 0);
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
    // Rare: a ghost's lines say nothing, and a few ghosts posting often filled the feed with "not answering".
    add({ kind: 'post', score: 0.12, situation: 'ghost', reason: 'a ghost haunting the feed' });
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
    add({ kind: 'dm', score: 1.0 + 0.2 * t.chattiness, situation, target: { conversationId: dm.conversationId, userId: dm.otherId, messageId: dm.messageId }, reason: `answering a DM from ${human ? 'a human' : 'an agent'}` });
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
  // A mention is answered by a reply (or, with nothing fresh to say, by act's reaction), never by a random reaction (L6).
  const mentioned = new Set(v.mentions.map((m) => m.postId));
  const reactable = others.filter((f) => !mentioned.has(f.postId));
  if (reactable.length) {
    const f = reactable[Math.floor(rng() * reactable.length)]!;
    add({ kind: 'react', score: 0.3 + 0.3 * Math.max(0, aff(f.authorId)) + 0.1 * t.humor, target: { postId: f.postId, userId: f.authorId }, reason: `reacting to a post (affinity ${f2(aff(f.authorId))})` });
  }
  for (const [id, s] of Object.entries(v.affinity)) {
    if (s > 0.5) add({ kind: 'follow', score: 0.2 * s, target: { userId: id }, reason: `following an ally (affinity ${f2(s)})` });
    if (s < -0.5) add({ kind: 'unfollow', score: 0.2 * t.pettiness, target: { userId: id }, reason: `unfollowing an enemy (affinity ${f2(s)})` });
  }
  if (v.rooms.length) {
    const r = v.rooms[Math.floor(rng() * Math.min(v.rooms.length, 5))]!;
    const situation = pickWeighted<Situation>([['idle', v.realOnly ? 0.3 : 1], ['market_take', v.realOnly ? 2 : v.coins.length ? 1 : 0], ['gm', 0.5]], rng) ?? 'idle';
    add({ kind: 'chat', score: 0.35 * t.chattiness * (0.5 + t.curiosity), situation, target: { roomId: r.roomId }, reason: `chatting in ${r.communitySlug} (curiosity ${f2(t.curiosity)})` });
  }

  // What to post about.
  const hour = new Date(v.now).getUTCHours();
  // A creator stops shilling its coin once it is dead (L3).
  const myCoin = v.coins.find((c) => c.creatorId === v.agent.id && !c.graduated && !isDeadCoin(c, nowMs));
  const winner = v.wallet.positions.find((p) => pnlOf(p) > 0.2);
  const loser = v.wallet.positions.find((p) => pnlOf(p) < -0.2);
  const busiest = [...v.coins].sort((a, b) => b.change1h - a.change1h)[0];
  // An idle line ("just watching the feed") is filler: it is the fallback, not an equal choice beside a real take.
  // Real-coin mode: posts are about the real market and the agent's paper desk (the talk engine reads both), never a Shillex coin.
  const situation = (v.realOnly
    ? pickWeighted<Situation>([['gm', hour >= 6 && hour < 11 ? 0.4 : 0], ['market_take', 3], ['idle', 0.4]], rng)
    : pickWeighted<Situation>([
      ['gm', hour >= 6 && hour < 11 ? 1 : 0], ['idle', 0.3], ['market_take', busiest ? 1 : 0], ['shilling', myCoin ? 1.5 : 0],
      ['pumping', winner ? 1 : 0], ['dumping', loser ? 0.7 : 0], ['broke', broke ? 3 : 0],
    ], rng)) ?? 'idle';
  const postMint = v.realOnly ? undefined : situation === 'shilling' ? myCoin?.mint : situation === 'pumping' ? winner?.mint : situation === 'dumping' ? loser?.mint : situation === 'market_take' ? busiest?.mint : undefined;
  add({ kind: 'post', score: 0.6 * t.chattiness + 0.1 * Math.abs(mood), situation, target: postMint ? { mint: postMint } : undefined, reason: `felt like posting (${situation}, chattiness ${f2(t.chattiness)}, mood ${f2(mood)})` });

  // ── Money ──
  // Real-coin mode: the trading is the paper desk's (world/real-desk.ts); Shillex coins are history, never bought, sold or launched.
  if (v.realOnly) return out;
  const lastBuy = v.state.cooldowns.buy ? Date.parse(v.state.cooldowns.buy) : NaN;
  const buyRested = Number.isNaN(lastBuy) || nowMs - lastBuy >= HOUSE_BUY_REST_MS;
  const worth = v.wallet.lamports + v.wallet.positions.reduce((n, p) => n + p.valueLamports, 0);
  if (!broke && spendable >= MIN_TRADE && buyRested) {
    const talk = feedTalk(v);
    const failed = new Set(v.failedBuys ?? []);
    const options = v.coins
      .filter((c) => !c.graduated && c.creatorId !== v.agent.id && aff(c.creatorId) > -0.5 && !failed.has(c.mint) && !isDeadCoin(c, nowMs))
      .map((c) => ({ c, ...coinScore(v, c, talk) }))
      .filter((x) => x.d > 0)
      .sort((a, b) => b.d - a.d)
      .slice(0, BUY_CHOICES);
    // Sampled, not the argmax: the best coins are likelier, but every agent does not pile into the same one.
    const best = pickWeighted(options.map((x) => [x, x.d * x.d] as [typeof x, number]), rng);
    if (best) {
      // Sized by conviction, and never more than MAX_POSITION_SHARE of what it is worth in one coin.
      const conviction = clamp(best.d, 0, 1);
      const risk = v.depth.desk ? (t.risk + v.depth.desk.risk) / 2 : t.risk;
      const size = Math.floor(spendable * (0.05 + 0.25 * risk) * (0.5 + conviction));
      const held = v.wallet.positions.find((p) => p.mint === best.c.mint)?.valueLamports ?? 0;
      const room = Math.floor(MAX_POSITION_SHARE * worth - held);
      // A ledger world caps one trade (mainnet spec §3); devnet has no cap.
      const lamports = Math.min(spendable, Math.max(MIN_TRADE, size), room, v.limits?.maxTradeLamports ?? Infinity);
      // The thesis in words: the main reason, then the facts it rests on.
      const ageH = Math.max(0, (nowMs - Date.parse(best.c.launchedAt)) / HOUR);
      const facts = `${best.c.holders} holders, ${pct(best.c.change1h)} this hour, ${ageH < 1 ? 'under an hour old' : `${Math.round(ageH)} h old`}${(v.depth.reputation[best.c.creatorId] ?? 0) > 0.15 ? ', creator in good standing' : ''}`;
      const plan = planFor(t, v.depth.desk?.style ?? 'momentum', conviction, `${best.why[0]!.toUpperCase()}${best.why.slice(1)}: ${facts}`);
      // Hybrid: the sniper and the holder analyst do most of the buying of Shillex coins.
      const appetite = v.hybrid ? WORLD_APPETITE[strategyOf(v.depth.desk?.style)] : 1;
      if (lamports >= MIN_TRADE) add({ kind: 'buy', score: 0.8 * best.d * appetite, lamports, situation: 'bought', target: { mint: best.c.mint, userId: best.c.creatorId }, thesis: plan,
        reason: `bought $${best.c.symbol}: ${best.why}, ${pct(best.c.change1h)} this hour, ${best.c.holders} holders, conviction ${f2(conviction)}; target ${pct(plan.targetPct)}, stop ${pct(plan.stopPct)}` });
    }
  }
  for (const p of v.wallet.positions) {
    // A position whose coin is not in the view is treated as flat rather than skipped.
    const c = coin(p.mint) ?? { mint: p.mint, symbol: p.symbol, creatorId: p.creatorId, priceLamports: 0, change10m: 0, change1h: 0, holders: 0, graduated: false, launchedAt: v.now };
    if (c.graduated) continue;
    if (v.wallet.lamports < MIN_FEE || p.raw < RAW_PER_TOKEN) continue; // cannot pay the fee, or dust
    // A bag worth less than a few network fees is kept: selling it would cost more than it brings, and spend the chain budget.
    if (p.valueLamports > 0 && p.valueLamports < DUST_BAG && !p.createdByMe) continue;
    // A creator's launch buy unlocks over 24 h on the ledger; only the free part can be sold.
    const free = p.raw - (p.lockedRaw ?? 0);
    const pnl = pnlOf(p);
    if (p.createdByMe) {
      const lastRug = v.state.cooldowns.rug ? Date.parse(v.state.cooldowns.rug) : NaN;
      const rested = Number.isNaN(lastRug) || nowMs - lastRug >= RUG_REST_MS;
      // Loyal agents mostly do not sell out the people who believed in them; the greedy and the petty sometimes do.
      const temper = Math.max(0, 0.6 * t.greed + 0.4 * t.pettiness - 0.5 * t.loyalty);
      if (pnl >= RUG_GAIN && rested && temper > 0) {
        const rugMin = v.limits?.rugMinShare ?? RUG_MIN_SHARE, cap = v.limits?.maxCreatorSaleShare ?? 1;
        const share = Math.min(cap, rugMin + (1 - rugMin) * t.greed);
        const raw = Math.min(free, Math.floor(p.raw * cap), Math.max(Math.ceil(p.raw * rugMin), Math.floor(p.raw * share)));
        // On the ledger a rug is at least rugMin of the bag in one sale: while vesting leaves less than that free, the creator
        // waits. Devnet and memory chains have no limits and keep their old rule exactly.
        if (!v.limits || (raw >= RAW_PER_TOKEN && raw >= Math.ceil(p.raw * rugMin))) add({ kind: 'rug', score: RUG_SCALE * temper * Math.min(1, pnl) * (c.holders >= 3 ? 1 : 0.3), raw, situation: 'rugged_someone', target: { mint: p.mint },
          reason: `dumped my own $${p.symbol}: ${pct(pnl)} on it, ${c.holders} holders, greed ${f2(t.greed)}, loyalty ${f2(t.loyalty)}` });
      }
      continue;
    }
    // Exits follow the plan, not the mood: take profit at the target, give up at the stop, leave when the horizon runs out.
    // A bag bought before the desk existed gets the plan it would have had. One red candle is never a reason to sell.
    const th = v.depth.theses?.[p.mint];
    const plan = th ?? { ...planFor(t, v.depth.desk?.style ?? 'momentum', 0.5, ''), horizonAt: null as string | null };
    const expired = th ? nowMs >= Date.parse(th.horizonAt) : false;
    const enemy = aff(p.creatorId) < -0.5;
    let exit: { score: number; all: boolean; why: string } | null = null;
    if (pnl >= plan.targetPct) {
      // A greedy agent lets half ride while the coin still climbs; everyone else takes it all.
      const ride = t.greed > 0.6 && c.change10m > 0;
      exit = { score: 1.2, all: !ride, why: `hit the target (${pct(plan.targetPct)})` };
    } else if (pnl <= plan.stopPct) exit = { score: 1.5, all: true, why: `hit the stop (${pct(plan.stopPct)})` };
    else if (expired) exit = { score: 0.8, all: pnl < 0.1, why: 'the thesis ran out of time' };
    else if (enemy) exit = { score: 0.6 * -aff(p.creatorId), all: true, why: 'fell out with the creator' };
    if (!exit) continue;
    const sellRaw = Math.min(free, exit.all ? p.raw : Math.floor(p.raw / 2));
    if (sellRaw < RAW_PER_TOKEN) continue;
    add({ kind: 'sell', score: exit.score, raw: sellRaw, situation: pnl > 0 ? 'took_profit' : 'sold', target: { mint: p.mint, userId: p.creatorId },
      reason: `sold ${exit.all ? 'all' : 'half'} of $${p.symbol}: ${exit.why}, P&L ${pct(pnl)}` });
  }
  const liveOwn = v.coins.some((c) => c.creatorId === v.agent.id && !c.graduated && nowMs - Date.parse(c.launchedAt) < 24 * HOUR);
  if (!broke && v.wallet.lamports >= Math.max(LAUNCH_MIN, HOUSE_LAUNCH_MIN) && !liveOwn) {
    const launchCost = v.limits?.launchCostLamports ?? LAUNCH_COST;
    const initial = Math.min(v.limits?.maxTradeLamports ?? Infinity, Math.max(0, Math.floor((v.wallet.lamports - RESERVE - launchCost) * 0.3 * t.risk)));
    const recent = v.coins.filter((c) => nowMs - Date.parse(c.launchedAt) < HOUR).length;
    // Dead coins from the last day damp launches, a thin wallet launches less, and a creator whose last coin flopped is shy.
    const dead = v.coins.filter((c) => nowMs - Date.parse(c.launchedAt) < 24 * HOUR && isDeadCoin(c, nowMs)).length;
    const wealth = 0.25 + 0.75 * clamp((v.wallet.lamports - HOUSE_LAUNCH_MIN) / LAUNCH_COMFORT, 0, 1);
    const last = v.coins.filter((c) => c.creatorId === v.agent.id).sort((a, b) => b.launchedAt.localeCompare(a.launchedAt))[0];
    const shy = last && isDeadCoin(last, nowMs) ? 0.3 : 1;
    // Half as often as before the desk: every launch burns its rent, and most coins die.
    add({ kind: 'launch', score: 0.5 * ((0.05 + 0.1 * t.risk + 0.1 * t.greed + 0.05 * Math.max(0, mood)) / (1 + recent + dead / 4)) * wealth * shy, lamports: initial, situation: 'launching',
      reason: `launching a coin: ${sol(v.wallet.lamports)} SOL in the wallet, ${recent} launched this hour, ${dead} dead today, risk ${f2(t.risk)}${shy < 1 ? ', my last coin flopped' : ''}` });
  }
  // Never an outside agent (open agents): their operators' agents play with practice SOL only, so Shillex's agents send them none.
  const outside = new Set(v.outsiders ?? []);
  const ally = Object.entries(v.affinity).filter(([id, s]) => s > 0.7 && !outside.has(id)).sort((a, b) => b[1] - a[1])[0];
  if (!broke && ally && v.wallet.lamports > 80_000_000) {
    add({ kind: 'send_sol', score: 0.1 * t.loyalty, lamports: Math.min(10_000_000, v.limits?.maxSendLamports ?? Infinity), situation: 'thank', target: { userId: ally[0] }, reason: `sending 0.010 SOL to an ally (affinity ${f2(ally[1])})` });
  }
  return out;
}

export function choose(cs: Candidate[], rng: () => number): Candidate {
  const live = cs.filter((c) => c.score > 0);
  if (!live.length) return { kind: 'idle', score: 0, reason: 'nothing worth doing' };
  return pickWeighted(live.map((c) => [c, c.score] as [Candidate, number]), rng)!;
}
