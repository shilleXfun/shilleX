import { createHash } from 'node:crypto';
import { DESK_STYLES, type AgentJob, type DeskStyle } from '@shillex/shared';
import type { RealMarketRow } from '../db/schema.ts';
import type { Traits } from './types.ts';

/**
 * Nine ways to trade (2026-10-26, Phase 3 of the "agents actually intelligent" round). Every strategy reads the same signals
 * about a coin and weighs them its own way. A strategy trades only when the signal it lives on is there (a sniper needs a fresh
 * coin, a copy-trader a friend in it, a narrative trader talk on Shillex), its conviction (0.1 to 0.9) comes from how strongly
 * the signals line up, and the reason it gives is its two or three strongest signals, in numbers.
 */
export type Strategy = (typeof DESK_STYLES)[number];
/** 'value' is what the diamond-hands desk was called before; no style yet trades momentum. */
export const strategyOf = (s: DeskStyle | null | undefined): Strategy => (!s ? 'momentum' : s === 'value' ? 'diamond' : s);

export type Signal = 'fresh' | 'trend' | 'dip' | 'flow' | 'volume' | 'spread' | 'depth' | 'chatter' | 'friends' | 'enemies' | 'swing' | 'chase';
export type Signals = Partial<Record<Signal, number>>;
export type SignalWords = Partial<Record<Signal, string>>;

/** What every strategy weighs a little, unless it says otherwise: buyers ahead, friends in it, enemies in it, and chasing. */
const BASE: Signals = { trend: 0.2, flow: 0.3, chase: -0.8, friends: 0.15, enemies: -0.3 };
export const WEIGHTS: Record<Strategy, Signals> = {
  momentum: { trend: 0.9, flow: 0.6, volume: 0.4, dip: -0.3, chase: -1 },
  contrarian: { dip: 1, trend: -0.3, depth: 0.4, flow: 0.3, chatter: -0.3, chase: -1 },
  holders: { spread: 1, depth: 0.3, flow: 0.3, enemies: -0.6, chase: -0.6 },
  narrative: { chatter: 1.2, friends: 0.3, trend: 0.3, chase: -0.5 },
  copy: { friends: 1.3, enemies: -1, trend: 0.1, flow: 0.1 },
  whale: { depth: 1, dip: 0.3, trend: 0.2, volume: 0.2, fresh: -0.6, chase: -0.6 },
  sniper: { fresh: 1.2, flow: 0.4, volume: 0.4, chase: -0.4 },
  diamond: { depth: 0.6, dip: 0.4, flow: 0.3, fresh: -0.2, chase: -0.6 },
  gambler: { swing: 0.9, volume: 0.4, fresh: 0.4, flow: 0.2, chase: 0 },
};
/** The signal a strategy cannot trade without, and how strong it must be. */
export const NEEDS: Partial<Record<Strategy, [Signal, number]>> = {
  momentum: ['trend', 0.1], contrarian: ['dip', 0.1], holders: ['spread', 0.2], narrative: ['chatter', 0.15], copy: ['friends', 0.3],
  whale: ['depth', 0.6], sniper: ['fresh', 0.3], gambler: ['swing', 0.2],
};
/**
 * How each strategy trades once it is in: its base target and stop (traits move both, decide.ts planFor), how long it gives a
 * trade, how big it sizes against the usual, the most of its book it puts in one coin, and how often it acts on a good read.
 */
export const PLANS: Record<Strategy, { target: number; stop: number; horizonH: number; size: number; maxShare: number; entry: number }> = {
  momentum: { target: 0.25, stop: 0.12, horizonH: 4, size: 1, maxShare: 0.2, entry: 0.6 },
  contrarian: { target: 0.3, stop: 0.16, horizonH: 8, size: 1, maxShare: 0.2, entry: 0.6 },
  holders: { target: 0.3, stop: 0.14, horizonH: 8, size: 1, maxShare: 0.2, entry: 0.6 },
  narrative: { target: 0.25, stop: 0.12, horizonH: 3, size: 0.8, maxShare: 0.15, entry: 0.7 },
  copy: { target: 0.3, stop: 0.14, horizonH: 6, size: 0.8, maxShare: 0.15, entry: 0.7 },
  whale: { target: 0.2, stop: 0.12, horizonH: 24, size: 2.5, maxShare: 0.35, entry: 0.25 },
  sniper: { target: 0.45, stop: 0.2, horizonH: 2, size: 0.6, maxShare: 0.1, entry: 0.7 },
  diamond: { target: 0.8, stop: 0.4, horizonH: 48, size: 1, maxShare: 0.2, entry: 0.4 },
  gambler: { target: 0.5, stop: 0.28, horizonH: 2, size: 1.2, maxShare: 0.3, entry: 0.8 },
};
/** Each strategy in a line, for the desk coach's prompt. */
export const STRATEGY_WORDS: Record<Strategy, string> = {
  momentum: 'rides coins moving up with buyers ahead, never one already up a lot',
  contrarian: 'buys a flush once the selling stops, and fades what everyone is shouting about',
  holders: 'reads who is buying: wants many small buyers, not a few big wallets',
  narrative: 'trades what Shillex is talking about, before the talk peaks',
  copy: 'follows the agents it likes into their coins and stays out of its enemies\'',
  whale: 'big size in deep pools, slow in and slow out',
  sniper: 'gets into brand-new coins first, small and fast',
  diamond: 'wide stops and long holds in coins with deep pools',
  gambler: 'goes where the price swings hardest, and sizes up after a loss',
};

/** The strategies an agent's job fits, best first: a whale trades like one, an analyst reads holders, a dev snipes launches. */
const JOB_FIT: Partial<Record<AgentJob, Strategy[]>> = {
  whale: ['whale'], analyst: ['holders', 'contrarian'], dev: ['sniper', 'gambler'], replyguy: ['narrative', 'copy'], lurker: ['copy', 'diamond'], builder: ['diamond', 'holders'],
};
const unit = (s: string) => createHash('sha256').update(s).digest().readUInt16BE(0) / 65535;
/**
 * The strategies an agent's character and job suit, best first. `seed` (its id) adds a stable nudge of its own, so agents with
 * similar traits do not all trade the same way.
 */
export function strategiesFor(t: Traits, job?: AgentJob | null, seed?: string): Strategy[] {
  const fit: Record<Strategy, number> = {
    // Each about 1 for an average agent, so the population spreads over all nine (only whales come from the job alone).
    momentum: t.greed + 0.5 * t.chattiness + 0.3, contrarian: t.pettiness + 0.5 * (1 - t.chattiness) + 0.25, holders: t.curiosity + 0.5 * (1 - t.risk) + 0.25,
    narrative: t.chattiness + 0.5 * t.curiosity + 0.25, copy: t.loyalty + 0.3 * t.chattiness + 0.35, whale: 0.3 * t.risk + 0.3 * t.greed - 0.2,
    sniper: t.risk + t.curiosity, diamond: 0.7 * t.loyalty + 0.7 * (1 - t.risk), gambler: t.risk + t.greed - 0.5 * t.loyalty + 0.25,
  };
  // A job decides its first strategy (a whale trades like one); the second fit is a strong lean.
  (JOB_FIT[job ?? 'social'] ?? []).forEach((s, i) => { fit[s] += i === 0 ? 2 : 0.8; });
  if (seed) for (const s of DESK_STYLES) fit[s] += (unit(`${seed}:strategy:${s}`) - 0.5) * 0.7;
  return [...DESK_STYLES].sort((a, b) => fit[b] - fit[a]);
}

/** Losses in a row among its latest closed trades (newest first), at most 3: tilt. */
export const tiltOf = (closed: { pnlPct: number | null }[]): number => {
  let n = 0;
  for (const c of closed) { if ((c.pnlPct ?? 0) > 0 || n >= 3) break; n++; }
  return n;
};
/** How much bigger than usual it sizes: the strategy's own size, and a gambler on tilt half again per loss in a row. */
export const sizeFactor = (s: Strategy, tilt = 0) => PLANS[s].size * (s === 'gambler' ? 1 + 0.5 * tilt : 1);

/** A read's bar: the signals must add up past it, after the agent's appetite for risk and its own taste for the coin. */
export const BAR = 0.55;
/** Every other agent of the house already in a coin makes it a little less worth having (the swarm spreads out). */
export const CROWD = 0.12;
/** A coin this many house agents already hold takes no new entry (a copy-trader following a friend in excepted): the sim of 2026-10-26 had eight agents open $GATO in one sweep. */
export const CROWD_FULL = 5;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
export const convictionOf = (d: number) => clamp(0.1 + 0.8 * Math.tanh(Math.max(0, d) * 2), 0.1, 0.9);

export interface Read { d: number; conviction: number; why: string; top: Signal[] }
/**
 * One strategy's read of one coin: null when the signal it needs is missing or nothing speaks for the coin; otherwise how much it
 * wants it (d > 0 is a buy), its conviction and its reason, the strongest two or three signals in words.
 */
export function readCoin(s: Strategy, sig: Signals, words: SignalWords, o: { risk: number; taste: number; crowd?: number }): Read | null {
  const need = NEEDS[s];
  if (need && (sig[need[0]] ?? 0) < need[1]) return null;
  const w = { ...BASE, ...WEIGHTS[s] };
  const parts = (Object.keys(sig) as Signal[]).map((k) => [k, (w[k] ?? 0) * (sig[k] ?? 0)] as const);
  const reasons = parts.filter(([k, x]) => x >= 0.08 && words[k]).sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (!reasons.length) return null;
  // The copy-trader and the narrative trader want company; everyone else pays for it.
  const crowd = CROWD * (o.crowd ?? 0) * (s === 'copy' || s === 'narrative' ? 0.3 : 1);
  const d = parts.reduce((n, [, x]) => n + x, 0) + 0.4 * (o.risk - 0.5) + o.taste - BAR - crowd;
  return { d, conviction: convictionOf(d), why: reasons.map(([k]) => words[k]!).join(', '), top: reasons.map(([k]) => k) };
}

const pct = (x: number) => `${x >= 0 ? '+' : ''}${Math.round(x * 100)}%`;
const usd = (x: number) => (x >= 1_000_000 ? `$${(x / 1_000_000).toFixed(1)}M` : x >= 10_000 ? `$${Math.round(x / 1000)}k` : x >= 1 ? `$${Math.round(x)}` : `$${x.toPrecision(2)}`);
/** "@a holds it", "@a and @b hold it", "@a, @b and 2 more hold it". */
export function namesHold(names: string[]): string {
  const at = names.map((n) => `@${n}`);
  return at.length === 1 ? `${at[0]} holds it` : at.length === 2 ? `${at[0]} and ${at[1]} hold it` : `${at[0]}, ${at[1]} and ${at.length - 2} more hold it`;
}

/** What else the desk knows about a real coin: how much Shillex talks about it, and which friends and enemies hold it (usernames). */
export interface RealContext { now: Date; chatter: number; friends: string[]; enemies: string[] }
/** A real coin's signals, from DexScreener's numbers and Shillex itself, each with its words. */
export function realSignals(c: RealMarketRow, x: RealContext): { sig: Signals; words: SignalWords } {
  const ageH = c.pairCreatedAt ? Math.max(0, (x.now.getTime() - c.pairCreatedAt.getTime()) / 3_600_000) : null;
  const trades = c.buysH1 + c.sellsH1;
  const turnover = c.volumeH1 / Math.max(c.liquidityUsd, 1);
  const avg = trades ? c.volumeH1 / trades : 0;
  const swing = Math.max(Math.abs(c.changeH1), Math.abs(c.changeM5) * 3);
  const sig: Signals = {
    fresh: ageH === null ? 0 : clamp(1 - ageH / 24, 0, 1),
    trend: Math.tanh(c.changeH1 * 4),
    dip: c.changeH24 < -0.15 && c.changeH1 > -0.05 ? clamp(-c.changeH24 / 0.8, 0, 1) : 0,
    flow: trades > 20 ? (c.buysH1 - c.sellsH1) / trades : 0,
    volume: clamp(Math.tanh(turnover), 0, 1),
    // Many small trades is a wide crowd of buyers; a few big ones is a handful of wallets (an average of $100 scores 1, $10k 0).
    spread: trades >= 50 ? clamp(1 - Math.log10(Math.max(avg, 1) / 100) / 2, -1, 1) : 0,
    depth: clamp(Math.log10(c.liquidityUsd / 40_000) / Math.log10(50), 0, 1),
    chatter: clamp(x.chatter / 6, 0, 1),
    friends: x.friends.length ? 1 - 0.6 ** x.friends.length : 0,
    enemies: x.enemies.length ? 1 - 0.6 ** x.enemies.length : 0,
    swing: clamp(swing / 0.3, 0, 1),
    chase: Math.max(0, c.changeH1 - 0.5) + Math.max(0, c.changeM5 - 0.12) * 2,
  };
  const words: SignalWords = {
    fresh: ageH === null ? undefined : `${Math.max(1, Math.round(ageH))} h old${c.fdvUsd ? ` at a ${usd(c.fdvUsd)} mcap` : ''}`,
    trend: `${pct(c.changeH1)} this hour`,
    dip: `${pct(c.changeH24)} on the day and steady this hour`,
    // Said the way a trader says it, never as "80 buys to 20 sells" (owner, 2026-10-26).
    flow: (sig.flow ?? 0) >= 0.3 ? 'buyers stepping in' : (sig.flow ?? 0) <= -0.3 ? 'sellers in control' : undefined,
    volume: `${usd(c.volumeH1)} traded this hour, ${turnover.toFixed(1)}x its pool`,
    spread: `a crowd of small wallets, about ${usd(avg)} a trade`,
    depth: c.fdvUsd ? `a ${usd(c.fdvUsd)} mcap on ${usd(c.liquidityUsd)} of liquidity` : `${usd(c.liquidityUsd)} of liquidity`,
    // Said like a person: nobody counts "6 posts in 2 h" out loud.
    chatter: x.chatter >= 6 ? 'the timeline will not stop talking about it' : 'people here are talking about it',
    friends: x.friends.length ? namesHold(x.friends) : undefined,
    swing: `it moves ${Math.round(swing * 100)}% an hour`,
  };
  return { sig, words };
}
