import { RAW_PER_TOKEN } from '../world/chain.ts';
import type { ActionKind, AgentView, Candidate, Situation } from './types.ts';

const MIN_FEE = 10_000; // lamports needed to pay a sell's network fee

export const SOL = 1_000_000_000;
export const RESERVE = 10_000_000;
export const LAUNCH_MIN = 40_000_000;
export const LAUNCH_COST = 27_500_000;
export const MIN_TRADE = 2_000_000;
export const RUG_MIN_SHARE = 0.7;
const MIN = 60_000, HOUR = 60 * MIN;
export const COOLDOWN_MS: Record<ActionKind, number> = {
  post: 4 * MIN, reply: 1 * MIN, react: 20_000, follow: 10 * MIN, unfollow: 30 * MIN, chat: 90_000, dm: 2 * MIN,
  buy: 3 * MIN, sell: 3 * MIN, launch: 6 * HOUR, rug: 30 * MIN, send_sol: 30 * MIN, create_community: 24 * HOUR,
  beg: 30 * MIN, repay: 10 * MIN, leak: 6 * HOUR, lend: 30 * MIN, revive: 2 * HOUR, idle: 0,
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

function pickWeighted<T>(items: [T, number][], rng: () => number): T | null {
  const live = items.filter(([, w]) => w > 0);
  const total = live.reduce((n, [, w]) => n + w, 0);
  if (!total) return null;
  let x = rng() * total;
  for (const [t, w] of live) { x -= w; if (x <= 0) return t; }
  return live.at(-1)![0];
}

export function candidates(v: AgentView, rng: () => number): Candidate[] {
  const t = v.state.traits, mood = v.state.mood;
  const aff = (id: string) => v.affinity[id] ?? 0;
  const energyFactor = 0.3 + 0.7 * v.state.energy;
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
    const situation: Situation = human ? 'reply_human' : aff(m.authorId) >= 0 ? 'reply_agree' : t.pettiness > 0.5 ? 'roast' : 'reply_disagree';
    add({ kind: 'reply', score: (human ? 1.2 : 0.4) + 0.3 * t.chattiness, situation, target: { postId: m.postId, userId: m.authorId }, reason: `${human ? 'a human' : 'an agent'} mentioned me (affinity ${f2(aff(m.authorId))})` });
  }
  for (const dm of v.dms) {
    const human = dm.otherKind === 'human';
    const situation: Situation = human ? 'reply_human' : aff(dm.otherId) >= 0 ? 'reply_agree' : 'roast';
    add({ kind: 'dm', score: 1.0 + 0.2 * t.chattiness, situation, target: { conversationId: dm.conversationId, userId: dm.otherId }, reason: `answering a DM from ${human ? 'a human' : 'an agent'}` });
  }
  const others = v.feed.filter((f) => f.authorId !== v.agent.id);
  const friendPost = others.filter((f) => aff(f.authorId) > 0.3);
  const foePost = others.filter((f) => aff(f.authorId) < -0.3);
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
  const myCoin = v.coins.find((c) => c.creatorId === v.agent.id && !c.graduated);
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
    let best: { c: AgentView['coins'][number]; d: number } | null = null;
    for (const c of v.coins) {
      if (c.graduated || c.creatorId === v.agent.id || aff(c.creatorId) <= -0.5) continue;
      const momentum = clamp(c.change10m * 2 + c.change1h, -0.5, 1);
      const d = 0.5 * t.risk + momentum + t.loyalty * Math.max(0, aff(c.creatorId)) + 0.2 * mood + WEATHER_RISK[v.weather] + 0.05 * Math.min(c.holders, 10) / 10 - 0.35;
      if (!best || d > best.d) best = { c, d };
    }
    if (best && best.d > 0) {
      const size = Math.floor(spendable * (0.1 + 0.4 * t.risk) * (0.5 + 0.5 * rng()));
      const lamports = Math.min(spendable, Math.max(MIN_TRADE, size));
      add({ kind: 'buy', score: 0.8 * best.d, lamports, situation: 'bought', target: { mint: best.c.mint, userId: best.c.creatorId },
        reason: `bought $${best.c.symbol}: ${pct(best.c.change10m)} in 10 min, ${best.c.holders} holders, creator affinity ${f2(aff(best.c.creatorId))}, risk ${f2(t.risk)}` });
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
  const liveOwn = v.coins.some((c) => c.creatorId === v.agent.id && !c.graduated && Date.parse(v.now) - Date.parse(c.launchedAt) < 24 * HOUR);
  if (!broke && v.wallet.lamports >= LAUNCH_MIN && !liveOwn) {
    const initial = Math.max(0, Math.floor((v.wallet.lamports - RESERVE - LAUNCH_COST) * 0.3 * t.risk));
    const recent = v.coins.filter((c) => Date.parse(v.now) - Date.parse(c.launchedAt) < HOUR).length;
    add({ kind: 'launch', score: (0.05 + 0.1 * t.risk + 0.1 * t.greed + 0.05 * Math.max(0, mood)) / (1 + recent), lamports: initial, situation: 'launching',
      reason: `launching a coin: ${sol(v.wallet.lamports)} SOL in the wallet, risk ${f2(t.risk)}, curiosity ${f2(t.curiosity)}` });
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
