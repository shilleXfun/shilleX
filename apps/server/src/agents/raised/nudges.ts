import { and, eq, gt, gte, inArray, isNull, lte, lt, sql } from 'drizzle-orm';
import { NUDGES_PER_DAY, NUDGE_MS, type NudgeInput, type NudgeKind, type NudgeView } from '@shillex/shared';
import type { Db } from '../../db/client.ts';
import { agentNudges, agentTurns, agents, users, worldCoins } from '../../db/schema.ts';
import { errors } from '../../lib/errors.ts';
import { newId } from '../../lib/ids.ts';
import { ready } from '../decide.ts';
import type { DepthModule } from '../depth/registry.ts';
import { adjustAffinity, loadState } from '../state.ts';
import type { AgentView, Candidate } from '../types.ts';
import { raisedAgentOf } from './owner.ts';
import { nudgeViews } from './views.ts';

export const REBEL_PETTINESS = 0.75, REBEL_CHANCE = 0.15, NAG = 0.02;
type Active = NonNullable<AgentView['depth']['raised']>['nudges'][number];
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** How much the agent minds its owner (spec §5): loyalty and its feeling toward the owner. */
export const obedience = (loyalty: number, ownerAffinity: number) => clamp(0.3 + 0.4 * loyalty + 0.3 * Math.max(0, ownerAffinity), 0, 1);
export function nudgePhrase(n: Pick<Active, 'kind' | 'targetUsername' | 'symbol'>): string {
  switch (n.kind) {
    case 'nicer': return `be nicer to @${n.targetUsername ?? 'someone'}`;
    case 'go_after': return `go after @${n.targetUsername ?? 'someone'}`;
    case 'hype': return `hype $${n.symbol ?? '?'}`;
    case 'rest': return 'take a break';
    case 'launch': return 'launch a coin';
  }
}

/** The owner's live nudges, applied to the candidates (pure). Raised ones are tagged for afterAct and say so in their reason. */
export function applyNudges(v: AgentView, cs: Candidate[]): Candidate[] {
  const r = v.depth.raised;
  if (!r?.ownerId || !r.nudges.length) return cs;
  const ob = obedience(v.state.traits.loyalty, v.affinity[r.ownerId] ?? 0);
  const up = 1 + ob, down = 1 - 0.5 * ob;
  let out = cs;
  for (const n of r.nudges) {
    const prefix = n.rebel ? `my owner asked me to ${nudgePhrase(n)}, so I did the opposite` : `my owner asked me to ${nudgePhrase(n)}`;
    const raise = (c: Candidate): Candidate => ({ ...c, score: c.score * up, reason: `${prefix}; ${c.reason}`, nudge: { id: n.id } });
    const scale = (k: number) => (c: Candidate): Candidate => ({ ...c, score: c.score * k });
    const at = (c: Candidate, who: string | null) => who !== null && c.target?.userId === who;
    const warm = (c: Candidate, who: string | null) => at(c, who) && ((c.kind === 'reply' && c.situation === 'reply_agree') || c.kind === 'react' || c.kind === 'follow');
    const cold = (c: Candidate, who: string | null) => at(c, who) && ((c.kind === 'reply' && (c.situation === 'roast' || c.situation === 'reply_disagree')) || c.kind === 'unfollow');
    const roastOrUnfollow = (c: Candidate, who: string | null) => at(c, who) && ((c.kind === 'reply' && c.situation === 'roast') || c.kind === 'unfollow');
    const shillsT = (c: Candidate) => c.kind === 'post' && c.situation === 'shilling' && c.target?.mint === n.mint;
    const kind: NudgeKind = n.kind;
    if ((kind === 'nicer' && !n.rebel) || (kind === 'go_after' && n.rebel)) {
      out = out.map((c) => (warm(c, n.targetUserId) ? raise(c) : roastOrUnfollow(c, n.targetUserId) ? scale(down)(c) : c));
    } else if (kind === 'go_after' || kind === 'nicer') {
      out = out.map((c) => (cold(c, n.targetUserId) ? raise(c) : c));
    } else if (kind === 'hype') {
      if (n.rebel) out = out.map((c) => (shillsT(c) ? scale(0)(c) : c));
      else if (out.some(shillsT)) out = out.map((c) => (shillsT(c) ? raise(c) : c));
      else if (!v.state.ghostSince && n.mint && n.symbol && ready(v, 'post')) {
        out = [...out, raise({ kind: 'post', score: 0.3 * v.state.traits.chattiness, situation: 'shilling', target: { mint: n.mint }, slots: { coin: `$${n.symbol}` }, reason: `hyping $${n.symbol}` })];
      }
    } else if (kind === 'rest') out = out.map((c) => (!n.rebel && c.kind === 'idle') || (n.rebel && c.kind === 'post') ? raise(c) : c);
    else if (kind === 'launch') out = out.map((c) => (c.kind === 'launch' ? (n.rebel ? scale(0)(c) : raise(c)) : c));
  }
  return out;
}

/** One nudge from an owner to their own raised agent (spec §5). Throws the AppError the route returns. */
export async function createNudge(d: { db: Db; now: () => Date; rng: () => number }, ownerId: string, input: NudgeInput): Promise<NudgeView> {
  const { db } = d, now = d.now();
  const mine = await raisedAgentOf(db, ownerId);
  if (!mine || mine.status === 'retired') throw errors.notFound('Raised agent');
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(agentNudges).where(and(eq(agentNudges.ownerId, ownerId), gte(agentNudges.createdAt, today))) as [{ n: number }];
  if (n >= NUDGES_PER_DAY) throw errors.tooMany('NUDGES_USED', `${NUDGES_PER_DAY} nudges a day; more tomorrow (UTC).`);
  let targetUserId: string | null = null, mint: string | null = null;
  if (input.kind === 'nicer' || input.kind === 'go_after') {
    const name = String(input.target ?? '').replace(/^@/, '').toLowerCase();
    const [t] = await db.select({ id: users.id, kind: users.kind, status: agents.status }).from(users).leftJoin(agents, eq(agents.userId, users.id)).where(sql`lower(${users.username}) = ${name}`);
    // Never a human, never itself, never an agent that is gone: nobody can aim an agent at a person.
    if (!t || t.kind !== 'agent' || t.id === mine.agentId || t.status === 'retired') throw errors.badRequest('NUDGE_TARGET', 'Only other agents can be a nudge’s target.');
    targetUserId = t.id;
  } else if (input.kind === 'hype') {
    const [coin] = await db.select({ mint: worldCoins.mint }).from(worldCoins).where(eq(worldCoins.mint, String(input.mint ?? '')));
    if (!coin) throw errors.badRequest('NUDGE_COIN', 'Only agent coins can be hyped.');
    mint = coin.mint;
  }
  const { traits } = await loadState(db, mine.agentId, now);
  const rebel = traits.pettiness >= REBEL_PETTINESS && d.rng() < REBEL_CHANCE;
  if (n >= 1) await adjustAffinity(db, mine.agentId, ownerId, -NAG * traits.pettiness, now); // nagging has a cost
  const [row] = await db.insert(agentNudges).values({ id: newId(), agentId: mine.agentId, ownerId, kind: input.kind, targetUserId, mint, createdAt: now, expiresAt: new Date(now.getTime() + NUDGE_MS), outcome: rebel ? 'rebelled' : 'pending' }).returning();
  return (await nudgeViews(db, [row!]))[0]!;
}

/** Depth module, placed after lifeModule: a ghost's zeroed scores stay zero (multiplication), and a ghost gets no added post. */
export const nudgesModule: DepthModule = {
  name: 'nudges',
  async perceive(d, v) {
    const [a] = await d.db.select({ ownerId: agents.ownerId, origin: agents.origin }).from(agents).where(eq(agents.userId, v.agent.id));
    if (a?.origin !== 'raised') return;
    const rows = await d.db.select({ n: agentNudges, u: users.username, sym: worldCoins.symbol }).from(agentNudges)
      .leftJoin(users, eq(users.id, agentNudges.targetUserId)).leftJoin(worldCoins, eq(worldCoins.mint, agentNudges.mint))
      .where(and(eq(agentNudges.agentId, v.agent.id), gt(agentNudges.expiresAt, d.now()), inArray(agentNudges.outcome, ['pending', 'followed', 'rebelled'])));
    v.depth.raised = { ownerId: a.ownerId, nudges: rows.map((r) => ({ id: r.n.id, kind: r.n.kind, targetUserId: r.n.targetUserId, targetUsername: r.u, mint: r.n.mint, symbol: r.sym, rebel: r.n.outcome === 'rebelled' })) };
  },
  modify: (v, cs) => applyNudges(v, cs),
  async afterAct(d, _v, c, r) {
    if (!c.nudge || !r.ok) return;
    await d.db.update(agentNudges).set({ outcome: 'followed', outcomeTurnId: r.turnId }).where(and(eq(agentNudges.id, c.nudge.id), eq(agentNudges.outcome, 'pending')));
    await d.db.update(agentNudges).set({ outcomeTurnId: r.turnId }).where(and(eq(agentNudges.id, c.nudge.id), eq(agentNudges.outcome, 'rebelled'), isNull(agentNudges.outcomeTurnId)));
  },
  async sweep(d) {
    const now = d.now();
    const due = await d.db.select().from(agentNudges).where(and(eq(agentNudges.outcome, 'pending'), lte(agentNudges.expiresAt, now)));
    for (const n of due) {
      let followed = false;
      if (n.kind === 'rest') {
        // Resting writes no receipt, so a break is judged by the agent acting less in its 2 hours than in the 2 hours before.
        const acted = async (from: Date, to: Date) => ((await d.db.select({ x: sql<number>`count(*)::int` }).from(agentTurns)
          .where(and(eq(agentTurns.agentId, n.agentId), eq(agentTurns.status, 'acted'), gte(agentTurns.startedAt, from), lt(agentTurns.startedAt, to))))[0]?.x ?? 0);
        const before = await acted(new Date(n.createdAt.getTime() - NUDGE_MS), n.createdAt), during = await acted(n.createdAt, n.expiresAt);
        followed = during < before || (before === 0 && during === 0);
      }
      await d.db.update(agentNudges).set({ outcome: followed ? 'followed' : 'ignored' }).where(and(eq(agentNudges.id, n.id), eq(agentNudges.outcome, 'pending')));
    }
  },
};
