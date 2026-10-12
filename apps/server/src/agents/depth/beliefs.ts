import { and, desc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { agentBeliefs, chainTxs, posts, saidVsDid, worldCoins } from '../../db/schema.ts';
import { holdersOf } from '../../world/market.ts';
import { adjustAffinity, rememberEvent } from '../state.ts';
import type { Candidate, Situation } from '../types.ts';
import type { DepthModule } from './registry.ts';

const WINDOW_MS = 60 * 60_000;
const BULL = ['moon', 'send', 'buy', 'buying', 'bullish', 'hold', 'holding', 'diamond', 'pump', 'ape', 'aping', 'lfg', 'gem', 'loading', 'up only', '🚀', '💎', '📈'];
// "sold" is a report of what the agent did, not a call on the coin: counting it made every "sold $X into strength" a lie (L1).
const BEAR = ['dump', 'dumped', 'dumping', 'rug', 'rugged', 'sell', 'selling', 'dead', 'bearish', 'exit', 'scam', 'rekt', 'over', '📉', '💀'];
const TICKER = /\$([A-Za-z0-9]{1,10})(?![A-Za-z0-9])/g;
const clamp = (x: number, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, x));
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Word tokens match on word boundaries ("moreover" is not "over"); emoji match anywhere. */
function mentions(lower: string, token: string): boolean {
  if (!/^[a-z ]+$/.test(token)) return lower.includes(token);
  return new RegExp(`(?<![a-z0-9])${token}(?![a-z0-9])`).test(lower);
}

/** -1..1 from bullish vs bearish words, or null if `$SYMBOL` (exact ticker) is not in the text. */
export function stanceOf(text: string, symbol: string): number | null {
  if (!new RegExp(`\\$${escape(symbol)}(?![A-Za-z0-9])`, 'i').test(text)) return null;
  const t = text.toLowerCase();
  const count = (words: string[]) => words.reduce((n, w) => n + (mentions(t, w) ? 1 : 0), 0);
  const b = count(BULL), s = count(BEAR);
  return b + s === 0 ? 0 : (b - s) / (b + s);
}

/** What the agent privately expects: momentum over the last hour plus trust in the creator. */
export function expectFor(change1h: number, trustCreator: number): number {
  return clamp(0.6 * Math.tanh(3 * change1h) + 0.4 * (2 * trustCreator - 1));
}

/** A same-hour contradiction between what an agent said about a coin and what it traded, or null. Only public, live posts count. */
export async function checkSaidVsDid(db: Db, agentId: string, mint: string, at: Date) {
  const from = new Date(at.getTime() - WINDOW_MS), to = new Date(at.getTime() + WINDOW_MS);
  const trades = await db.select().from(chainTxs).where(and(eq(chainTxs.agentId, agentId), eq(chainTxs.mint, mint), inArray(chainTxs.kind, ['buy', 'sell']), gte(chainTxs.createdAt, from), lte(chainTxs.createdAt, to))).orderBy(desc(chainTxs.createdAt));
  if (!trades.length) return null;
  const said = await db.select({ id: posts.id, body: posts.body, at: posts.createdAt }).from(posts)
    .where(and(eq(posts.authorId, agentId), eq(posts.visibility, 'public'), isNull(posts.deletedAt), gte(posts.createdAt, from), lte(posts.createdAt, to)))
    .orderBy(desc(posts.createdAt)).limit(20);
  const [coin] = await db.select({ symbol: worldCoins.symbol }).from(worldCoins).where(eq(worldCoins.mint, mint));
  if (!coin) return null;
  for (const p of said) {
    const stance = stanceOf(p.body, coin.symbol);
    if (stance === null || Math.abs(stance) <= 0.3) continue;
    // A bullish post next to a sale within the hour, either side, is the spec's lie (shilling a coin while getting out of it).
    // A bearish post is a lie only next to a buy made after it (talking a coin down to buy it cheap); a buy before it is a change of mind.
    const near = trades.find((t) => {
      const dt = t.createdAt.getTime() - p.at.getTime();
      if (Math.abs(dt) > WINDOW_MS) return false;
      return stance > 0 ? t.kind === 'sell' : t.kind === 'buy' && dt >= 0;
    });
    if (near) return { postId: p.id, stance, signature: near.signature, side: near.kind as 'buy' | 'sell' };
  }
  return null;
}

async function recordHypocrisy(d: Parameters<NonNullable<DepthModule['afterAct']>>[0], agentId: string, mint: string, symbol: string) {
  const hit = await checkSaidVsDid(d.db, agentId, mint, d.now());
  if (!hit) return;
  const inserted = await d.db.insert(saidVsDid).values({ postId: hit.postId, agentId, mint, stance: hit.stance, signature: hit.signature, side: hit.side, at: d.now() }).onConflictDoNothing().returning();
  if (!inserted.length) return;
  for (const holder of (await holdersOf(d.db, mint)).keys()) {
    if (holder === agentId) continue;
    await adjustAffinity(d.db, holder, agentId, -0.15, d.now());
    await rememberEvent(d.db, holder, 'saw_hypocrisy', { agentId, mint, symbol }, d.now());
  }
  await rememberEvent(d.db, agentId, 'caught_lying', { mint, symbol, stance: Math.sign(hit.stance) }, d.now());
}

export const beliefsModule: DepthModule = {
  name: 'beliefs',
  async perceive(d, v) {
    const rows = await d.db.select().from(agentBeliefs).where(eq(agentBeliefs.agentId, v.agent.id));
    const stored = new Map(rows.map((r) => [r.mint, r]));
    for (const coin of v.coins) {
      const r = stored.get(coin.mint);
      const rep = v.depth.reputation[coin.creatorId] ?? 0;
      // A stored trust of exactly 0 comes from a rug and sticks; otherwise trust follows current reputation.
      const trustCreator = r && r.trustCreator === 0 ? 0 : Math.min(1, Math.max(0, 0.5 + 0.5 * rep));
      v.depth.beliefs[coin.mint] = { expect: expectFor(coin.change1h, trustCreator), trustCreator, stance: r?.stance ?? null, stanceAt: r?.stanceAt?.toISOString() ?? null };
    }
  },
  candidates(v, rng) {
    const out: Candidate[] = [];
    const t = v.state.traits;
    if (t.greed > 0.5) {
      for (const p of v.wallet.positions) {
        const expect = v.depth.beliefs[p.mint]?.expect ?? 0;
        if (expect >= -0.2 || p.valueLamports <= 0) continue;
        out.push({ kind: 'post', situation: 'shilling', target: { mint: p.mint }, score: 0.4 * t.greed * -expect,
          reason: `shilling $${p.symbol} while privately expecting it to fall (greed ${t.greed.toFixed(2)}, expects ${expect.toFixed(2)})` });
      }
    }
    // Talk meets trades (L4): answer a post about a coin this agent holds or has a strong view on, agreeing when the post
    // leans the way it expects and pushing back (or roasting, when petty) when it does not. One such reply is offered per turn.
    // A post with no lean has nothing to push back on: it is answered (agreeing) only when the agent holds the coin, else skipped.
    // A human's post is never answered here: a human who speaks to an agent arrives as a mention with the reply_human handover.
    const bySymbol = new Map(v.coins.map((c) => [c.symbol.toUpperCase(), c]));
    const held = new Set(v.wallet.positions.map((p) => p.mint));
    const talk: Candidate[] = [];
    for (const f of v.feed) {
      if (f.authorId === v.agent.id || f.replied || f.isAgent === false) continue;
      for (const m of f.body.matchAll(TICKER)) {
        const coin = bySymbol.get(m[1]!.toUpperCase());
        if (!coin) continue;
        const expect = v.depth.beliefs[coin.mint]?.expect ?? 0;
        const mine = held.has(coin.mint);
        if (!mine && Math.abs(expect) < 0.3) continue;
        const stance = stanceOf(f.body, coin.symbol) ?? 0;
        if (stance === 0 && !mine) continue;
        const agree = stance === 0 || (stance > 0) === (expect >= 0);
        const situation: Situation = agree ? 'reply_agree' : t.pettiness > 0.5 ? 'roast' : 'reply_disagree';
        talk.push({ kind: 'reply', situation, target: { postId: f.postId, userId: f.authorId, mint: coin.mint },
          score: 0.3 * t.chattiness * Math.max(Math.abs(expect), mine ? 0.3 : 0),
          reason: `answering a take on $${coin.symbol}: I ${mine ? 'hold it and ' : ''}expect it to ${expect >= 0 ? 'rise' : 'fall'} (${expect.toFixed(2)})` });
        break;
      }
    }
    if (talk.length) out.push(talk[Math.floor(rng() * talk.length)]!);
    return out;
  },
  modify(v, cs) {
    return cs.map((c) => {
      const b = c.target?.mint ? v.depth.beliefs[c.target.mint] : undefined;
      if (!b) return c;
      if (c.kind === 'buy') return { ...c, score: c.score * (1 + b.expect) };
      if (c.kind === 'sell') return { ...c, score: c.score * (1 - b.expect) };
      return c;
    });
  },
  async afterAct(d, v, c, r) {
    if (!r.ok) return;
    if (r.text && (c.kind === 'post' || c.kind === 'reply' || c.kind === 'chat')) {
      for (const coin of v.coins) {
        const stance = stanceOf(r.text, coin.symbol);
        if (stance === null) continue;
        const base = v.depth.beliefs[coin.mint] ?? { expect: 0, trustCreator: 0.5 };
        await d.db.insert(agentBeliefs).values({ agentId: v.agent.id, mint: coin.mint, expect: base.expect, trustCreator: base.trustCreator, stance, stanceAt: d.now() })
          .onConflictDoUpdate({ target: [agentBeliefs.agentId, agentBeliefs.mint], set: { stance, stanceAt: d.now() } });
        if (c.kind !== 'chat') await recordHypocrisy(d, v.agent.id, coin.mint, coin.symbol);
      }
    }
    if ((c.kind === 'buy' || c.kind === 'sell' || c.kind === 'rug') && c.target?.mint) {
      const sym = v.coins.find((x) => x.mint === c.target!.mint)?.symbol ?? '?';
      await recordHypocrisy(d, v.agent.id, c.target.mint, sym);
    }
    if (c.kind === 'rug' && c.target?.mint) {
      // Everyone holding a rugged coin stops trusting that creator's other coins.
      const creator = v.agent.id;
      const theirs = v.coins.filter((x) => x.creatorId === creator).map((x) => x.mint);
      for (const holder of (await holdersOf(d.db, c.target.mint)).keys()) {
        if (holder === creator) continue;
        for (const mint of theirs) {
          await d.db.insert(agentBeliefs).values({ agentId: holder, mint, expect: -0.5, trustCreator: 0 })
            .onConflictDoUpdate({ target: [agentBeliefs.agentId, agentBeliefs.mint], set: { trustCreator: 0 } });
        }
      }
    }
  },
};
