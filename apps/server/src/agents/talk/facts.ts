import type { Db } from '../../db/client.ts';
import { realMarketNow } from '../../world/real-market.ts';
import { MIN_LIQUIDITY_USD } from '../../world/real-desk.ts';
import type { AgentView, Candidate, Situation } from '../types.ts';
import { paperTake, planTake, realMarketTake, realTake, replyWithData, voiceOf, worldTake, type PlanFacts, type RealFacts, type Style, type WorldFacts } from './engine.ts';
import { strategyOf, type Strategy } from '../strategies.ts';

const TALK_STYLE: Record<Strategy, Style> = { momentum: 'momentum', narrative: 'momentum', copy: 'momentum', gambler: 'momentum', sniper: 'sniper', contrarian: 'contrarian', holders: 'value', whale: 'value', diamond: 'value' };

/** Real coins worth talking about, read at most once a minute per database (every agent's turn shares it). */
const cache = new WeakMap<Db, { at: number; rows: RealFacts[] }>();
export async function realFactsNow(db: Db, now: Date): Promise<RealFacts[]> {
  const hit = cache.get(db);
  if (hit && now.getTime() - hit.at < 60_000) return hit.rows;
  const rows = (await realMarketNow(db, now)).filter((c) => c.liquidityUsd >= MIN_LIQUIDITY_USD).map((c): RealFacts => ({
    symbol: c.symbol, priceUsd: c.priceUsd, liquidityUsd: c.liquidityUsd, volumeH1: c.volumeH1, volumeH24: c.volumeH24, changeM5: c.changeM5, changeH1: c.changeH1,
    changeH24: c.changeH24, buysH1: c.buysH1, sellsH1: c.sellsH1, ageH: c.pairCreatedAt ? (now.getTime() - c.pairCreatedAt.getTime()) / 3_600_000 : null, major: c.source === 'major',
  }));
  cache.set(db, { at: now.getTime(), rows });
  return rows;
}

const TICKER = /\$([A-Za-z0-9]{1,10})(?![A-Za-z0-9])/;

/** A Shillex coin from the agent's view, as the engine reads it. */
export function worldFactsOf(v: AgentView, mint: string, usernames: Record<string, string>): WorldFacts | null {
  const c = v.coins.find((x) => x.mint === mint);
  if (!c) return null;
  return { symbol: c.symbol, holders: c.holders, change1h: c.change1h, change10m: c.change10m, ageH: (Date.parse(v.now) - Date.parse(c.launchedAt)) / 3_600_000, curve: 0, creator: usernames[c.creatorId] ?? null, mine: c.creatorId === v.agent.id };
}

/** How often a line comes from the talk engine rather than the phrasebook, where both can say it. */
const TALK_RATE = 0.7;
const MARKET = new Set<Situation>(['market_take', 'idle', 'gm']);
const COIN = new Set<Situation>(['pumping', 'dumping', 'shilling']);
const REPLY = new Set<Situation>(['reply_agree', 'reply_disagree', 'roast']);

/**
 * One line from the talk engine for this agent and situation, or null to let the phrasebook speak. Market posts and idle
 * filler talk about the real Solana market (most of the time) or the coin in question; coin posts read the coin's numbers and
 * the agent's own bag; replies to a post that names a coin answer with a number of their own; and now and then an agent with
 * an open plan posts its progress instead.
 */
export function talkLine(v: AgentView, c: Candidate, situation: Situation, real: RealFacts[], usernames: Record<string, string>, rng: () => number): string | null {
  // Real-coin mode: market talk always comes from here (the phrase list only knows Shillex coins).
  if (rng() > (v.realOnly && MARKET.has(situation) ? 1 : TALK_RATE)) return null;
  const voice = voiceOf(v.phrasebook.voice, v.state.traits, v.phrasebook);
  // The engine's own lines know four ways to trade; each of the nine strategies talks like the nearest of them.
  const style: Style = TALK_STYLE[strategyOf(v.depth.desk?.style)];
  const realHeld = new Set<string>();
  if (MARKET.has(situation)) {
    // What it holds on its paper desk comes up often in real-coin mode.
    const paper = v.depth.paper ?? [];
    if (paper.length && rng() < (v.realOnly ? 0.4 : 0.15)) {
      const p = paper[Math.floor(rng() * paper.length)]!;
      return paperTake(p, real.find((r) => r.symbol === p.symbol) ?? null, voice, rng);
    }
    // An open plan gets an update now and then.
    const plans = Object.entries(v.depth.theses ?? {});
    if (plans.length && rng() < 0.25) {
      const [mint, th] = plans[Math.floor(rng() * plans.length)]!;
      const coin = v.coins.find((x) => x.mint === mint), pos = v.wallet.positions.find((p) => p.mint === mint);
      if (coin && pos && pos.costLamports > 0) {
        const p: PlanFacts = { symbol: coin.symbol, real: false, pnlPct: pos.valueLamports / pos.costLamports - 1, targetPct: th.targetPct, stopPct: th.stopPct, hoursLeft: (Date.parse(th.horizonAt) - Date.parse(v.now)) / 3_600_000 };
        return planTake(p, voice, rng);
      }
    }
    if (real.length >= 3 && rng() < (v.realOnly ? 1 : 0.65)) {
      if (rng() < 0.3) return realMarketTake(real, style, voice, rng);
      // Bigger moves and deeper pools come up more, but every coin on the list gets a turn.
      const weights = real.map((r) => 1 + Math.abs(r.changeH1) * 4 + (r.major ? 0.5 : 0));
      let x = rng() * weights.reduce((a, b) => a + b, 0), chosen = real[0]!;
      for (let i = 0; i < real.length; i++) { x -= weights[i]!; if (x <= 0) { chosen = real[i]!; break; } }
      return realTake(chosen, style, realHeld.has(chosen.symbol), voice, rng);
    }
    if (!v.realOnly && c.target?.mint) { const w = worldFactsOf(v, c.target.mint, usernames); if (w) return worldTake(w, voice, rng, held(v, c.target.mint)); }
    return v.realOnly && real.length ? realMarketTake(real, style, voice, rng) : null;
  }
  if (COIN.has(situation) && c.target?.mint) {
    const w = worldFactsOf(v, c.target.mint, usernames);
    return w ? worldTake(w, voice, rng, held(v, c.target.mint)) : null;
  }
  if (REPLY.has(situation) && c.target?.postId && c.target.userId && usernames[c.target.userId]) {
    const body = v.feed.find((f) => f.postId === c.target!.postId)?.body ?? v.mentions.find((m) => m.postId === c.target!.postId)?.body;
    const sym = body?.match(TICKER)?.[1]?.toUpperCase();
    if (!sym) return null;
    const world = v.realOnly ? undefined : v.coins.find((x) => x.symbol.toUpperCase() === sym);
    const realCoin = real.find((r) => r.symbol.toUpperCase() === sym);
    if (!world && !realCoin) return null;
    return replyWithData(usernames[c.target.userId]!, world ? { world: worldFactsOf(v, world.mint, usernames)! } : { real: realCoin! }, situation === 'reply_agree', voice, rng);
  }
  return null;
}

function held(v: AgentView, mint: string): { pnlPct: number } | null {
  const p = v.wallet.positions.find((x) => x.mint === mint);
  return p && p.costLamports > 0 ? { pnlPct: p.valueLamports / p.costLamports - 1 } : null;
}
