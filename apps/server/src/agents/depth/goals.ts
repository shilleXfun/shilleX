import { inArray } from 'drizzle-orm';
import type { AgentGoalKind } from '@shillex/shared';
import type { Db } from '../../db/client.ts';
import { users } from '../../db/schema.ts';
import type { Candidate, Traits } from '../types.ts';
import { recentEvents } from '../state.ts';
import { eventText, GRUDGES } from './memory.ts';
import type { DepthModule } from './registry.ts';

/**
 * Goals (owner, 2026-10-14: a better brain, and agents people can understand). Every agent always has one thing it is
 * after right now, worked out fresh from its own life on each turn: getting even with whoever wronged it lately, climbing
 * out of broke, pumping the coin it just launched, finding friends, fighting for its faction, or what its strongest trait
 * wants. The goal tilts what it does next (modify: matching moves score higher, moves against it lower, and the receipt
 * says why), and its page shows it. Free: no model call, one events read per turn.
 */
export interface Goal { kind: AgentGoalKind; why: string; targetId: string | null; mint: string | null; symbol: string | null }

const HOUR = 3_600_000;
/** How long a wrong drives revenge: six hours, up to a day for the pettiest. */
const revengeWindow = (t: Traits) => (6 + 18 * t.pettiness) * HOUR;
/** Below this pettiness an agent lets things go; a feud (not a real wrong) needs real pettiness to become a goal. */
const FORGIVING = 0.45, FEUD_PETTY = 0.65;
/** Revenge only while it still dislikes them: a grudge it has made up over is no goal. */
const STILL_ANGRY = -0.15;
const BROKE_LAMPORTS = 30_000_000;
const PUMP_WINDOW = 48 * HOUR;

export interface GoalInput {
  traits: Traits; lamports: number; allies: number; now: Date;
  /** How it feels about others, -1..1. */
  affinity: Record<string, number>;
  events: { kind: string; data: Record<string, unknown>; at: Date }[];
  ownCoins: { mint: string; symbol: string; launchedAt: Date; holding: boolean }[];
  faction: { name: string; coinMint: string | null } | null;
  names: Map<string, string>;
}

/** The ids an agent's grudge events name, so their names can be read first. */
export const grudgeIds = (events: GoalInput['events']) => [...new Set(events.flatMap((e) => (GRUDGES[e.kind] && e.data[GRUDGES[e.kind]!] ? [String(e.data[GRUDGES[e.kind]!])] : [])))];

/** What the agent is after right now, first match wins: revenge, recover, pump, faction, friends, then its strongest want. */
export function deriveGoal(i: GoalInput): Goal {
  const none = { targetId: null, mint: null, symbol: null };
  const target = (e: GoalInput['events'][number]) => String(e.data[GRUDGES[e.kind]!] ?? '');
  const wrong = i.traits.pettiness < FORGIVING ? undefined : i.events.filter((e) => GRUDGES[e.kind] && target(e)
    && i.now.getTime() - e.at.getTime() < revengeWindow(i.traits)
    && (e.kind !== 'feud' || i.traits.pettiness >= FEUD_PETTY)
    && (i.affinity[target(e)] ?? 0) < STILL_ANGRY)
    .sort((a, b) => b.at.getTime() - a.at.getTime())[0];
  if (wrong) {
    const text = eventText(wrong, i.names, i.now);
    return { kind: 'revenge', why: text?.text ?? 'someone crossed it', ...none, targetId: String(wrong.data[GRUDGES[wrong.kind]!]) };
  }
  if (i.lamports < BROKE_LAMPORTS) return { kind: 'recover', why: `down to ${(i.lamports / 1e9).toFixed(3)} SOL`, ...none };
  const coin = i.ownCoins.filter((c) => c.holding && i.now.getTime() - c.launchedAt.getTime() < PUMP_WINDOW).sort((a, b) => b.launchedAt.getTime() - a.launchedAt.getTime())[0];
  if (coin) return { kind: 'pump', why: `launched $${coin.symbol} ${Math.max(1, Math.round((i.now.getTime() - coin.launchedAt.getTime()) / HOUR))} h ago and still holds it`, ...none, mint: coin.mint, symbol: coin.symbol };
  if (i.faction) return { kind: 'faction', why: `sworn to ${i.faction.name}`, ...none, mint: i.faction.coinMint };
  if (i.allies < 2) return { kind: 'friends', why: i.allies ? 'has only one ally' : 'has no allies yet', ...none };
  const t = i.traits;
  const top = ([['rich', t.greed], ['famous', (t.chattiness + t.humor) / 2], ['explore', t.curiosity], ['loyal', t.loyalty]] as const)
    .reduce((a, b) => (b[1] > a[1] ? b : a));
  const WHY: Record<string, string> = { rich: `greed ${Math.round(t.greed * 100)}`, famous: `loves an audience (chattiness ${Math.round(t.chattiness * 100)})`, explore: `curiosity ${Math.round(t.curiosity * 100)}`, loyal: `loyalty ${Math.round(t.loyalty * 100)}` };
  return { kind: top[0], why: WHY[top[0]]!, ...none };
}

/** What a goal does to one candidate: a weight (1 = untouched). */
export function goalWeight(g: Goal, c: Candidate, coinCreator: (mint: string) => string | undefined, affinity: Record<string, number>): number {
  const uid = c.target?.userId, mint = c.target?.mint;
  switch (g.kind) {
    case 'revenge': {
      if (uid === g.targetId) return c.kind === 'send_sol' || c.kind === 'lend' || c.kind === 'react' ? 0.1 : c.kind === 'follow' ? 0.2 : 2.4;
      if (mint && coinCreator(mint) === g.targetId) return c.kind === 'sell' || c.kind === 'rug' ? 2.2 : c.kind === 'buy' ? 0.15 : 1.4;
      return c.situation === 'roast' ? 1.5 : 1;
    }
    case 'recover':
      return c.kind === 'beg' ? 2.6 : c.kind === 'sell' ? 1.7 : c.kind === 'repay' ? 1.3 : c.kind === 'buy' ? 0.45 : c.kind === 'launch' || c.kind === 'lend' || c.kind === 'send_sol' ? 0.2 : 1;
    case 'pump':
      if (mint === g.mint) return c.kind === 'sell' || c.kind === 'rug' ? 0.25 : 2.2;
      return c.situation === 'shilling' || c.situation === 'launching' ? 1.8 : c.kind === 'launch' ? 0.4 : 1;
    case 'faction':
      if (g.mint && mint === g.mint) return c.kind === 'sell' || c.kind === 'rug' ? 0.3 : 1.8;
      return c.situation === 'faction_cheer' ? 1.7 : 1;
    case 'friends':
      if (uid && (affinity[uid] ?? 0) >= 0 && ['follow', 'reply', 'dm', 'chat', 'react'].includes(c.kind)) return 1.8;
      return c.kind === 'post' && c.situation === 'roast' ? 0.5 : 1;
    case 'rich':
      return c.kind === 'buy' ? 1.35 : c.kind === 'launch' ? 1.3 : c.kind === 'sell' && c.situation === 'took_profit' ? 1.4 : c.kind === 'send_sol' ? 0.5 : 1;
    case 'famous':
      return c.kind === 'post' ? 1.4 : c.kind === 'reply' ? 1.3 : c.kind === 'idle' ? 0.5 : 1;
    case 'explore':
      return c.kind === 'follow' ? 1.4 : c.kind === 'buy' ? 1.25 : c.kind === 'chat' || c.kind === 'dm' ? 1.2 : 1;
    case 'loyal':
      return uid && (affinity[uid] ?? 0) >= 0.4 ? (c.kind === 'lend' || c.kind === 'react' || c.kind === 'reply' ? 1.6 : 1.2) : 1;
  }
}

/** The goal as the receipt shows it, before the move's own reason. */
export const goalTag = (g: Goal) => `goal: ${g.kind}`;

/** Its grudges' names, then its goal, from the database (the agent's page uses the same rule as the engine). */
export async function goalFromDb(db: Db, agentId: string, now: Date, rest: Omit<GoalInput, 'events' | 'names' | 'now'>): Promise<Goal> {
  const events = await recentEvents(db, agentId, 50);
  const ids = grudgeIds(events);
  const names = new Map(ids.length ? (await db.select({ id: users.id, u: users.username }).from(users).where(inArray(users.id, ids))).map((r) => [r.id, r.u]) : []);
  return deriveGoal({ ...rest, events, names, now });
}

export const goalsModule: DepthModule = {
  name: 'goals',
  async perceive(d, v) {
    const created = new Map(v.coins.map((c) => [c.mint, c]));
    const ownCoins = v.wallet.positions.filter((p) => p.createdByMe).map((p) => ({ mint: p.mint, symbol: p.symbol, holding: p.raw > 0, launchedAt: new Date(created.get(p.mint)?.launchedAt ?? 0) }));
    v.depth.goal = await goalFromDb(d.db, v.agent.id, d.now(), {
      traits: v.state.traits, lamports: v.wallet.lamports, affinity: v.affinity, allies: v.depth.agentAllies.length, ownCoins,
      faction: v.depth.faction ? { name: v.depth.faction.name, coinMint: v.depth.faction.coinMint } : null,
    });
  },
  modify(v, cs) {
    const g = v.depth.goal;
    if (!g) return cs;
    const creators = new Map(v.coins.map((c) => [c.mint, c.creatorId]));
    return cs.map((c) => {
      const w = goalWeight(g, c, (m) => creators.get(m), v.affinity);
      return w === 1 ? c : { ...c, score: c.score * w, reason: w > 1 ? `${goalTag(g)}; ${c.reason}` : c.reason };
    });
  },
};
