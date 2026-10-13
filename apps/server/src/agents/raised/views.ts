import { and, desc, eq, gt, gte, lt, lte, sql } from 'drizzle-orm';
import { NUDGES_PER_DAY, type HatchRequestView, type NudgeView, type RaisedAgentView } from '@shillex/shared';
import type { Db } from '../../db/client.ts';
import { agentHatches, agentNudges, agentSeeds, agents, users, worldCoins, type AgentHatchRow, type AgentNudgeRow } from '../../db/schema.ts';
import { userSummaries } from '../../services/hydrate.ts';
import { toUserSummary } from '../../services/users.ts';
import { grantsOf, topUpStatus, type GrantDeps } from './grants.ts';

export async function requestView(db: Db, r: AgentHatchRow): Promise<HatchRequestView> {
  const position = r.status === 'queued'
    ? ((await db.select({ n: sql<number>`count(*)::int` }).from(agentHatches).where(and(eq(agentHatches.status, 'queued'), lt(agentHatches.createdAt, r.createdAt))))[0]?.n ?? 0) + 1
    : null;
  return { id: r.id, handle: r.handle, status: r.status, reason: r.reason, position, createdAt: r.createdAt.toISOString() };
}

export async function nudgeViews(db: Db, rows: AgentNudgeRow[]): Promise<NudgeView[]> {
  const people = await userSummaries(db, rows.map((n) => n.targetUserId).filter((x): x is string => Boolean(x)));
  const mints = rows.map((n) => n.mint).filter((x): x is string => Boolean(x));
  const coins = new Map(mints.length ? (await db.select({ mint: worldCoins.mint, symbol: worldCoins.symbol }).from(worldCoins)).map((c) => [c.mint, c.symbol]) : []);
  return rows.map((n) => ({
    id: n.id, kind: n.kind, target: n.targetUserId ? people.get(n.targetUserId) ?? null : null, symbol: n.mint ? coins.get(n.mint) ?? null : null,
    createdAt: n.createdAt.toISOString(), expiresAt: n.expiresAt.toISOString(), outcome: n.outcome, outcomeTurnId: n.outcomeTurnId,
  }));
}

/** The owner's private view of their agent (RaisedAgentView). Serve it only to that owner (and admins). */
export async function raisedAgentView(db: Db, grants: GrantDeps, agentId: string, ownerId: string, now: Date): Promise<RaisedAgentView> {
  const [u] = await db.select().from(users).where(eq(users.id, agentId));
  const [a] = await db.select({ status: agents.status }).from(agents).where(eq(agents.userId, agentId));
  const [seed] = await db.select({ d: agentSeeds.description }).from(agentSeeds).where(eq(agentSeeds.agentId, agentId));
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(agentNudges).where(and(eq(agentNudges.ownerId, ownerId), gte(agentNudges.createdAt, today))) as [{ n: number }];
  const active = await db.select().from(agentNudges).where(and(eq(agentNudges.agentId, agentId), gt(agentNudges.expiresAt, now))).orderBy(desc(agentNudges.createdAt));
  const history = await db.select().from(agentNudges).where(and(eq(agentNudges.agentId, agentId), lte(agentNudges.expiresAt, now))).orderBy(desc(agentNudges.createdAt)).limit(20);
  return {
    user: toUserSummary(u!), status: a!.status, description: seed?.d ?? '',
    grants: await grantsOf(db, agentId), topUp: await topUpStatus(grants, agentId),
    nudges: { leftToday: Math.max(0, NUDGES_PER_DAY - n), active: await nudgeViews(db, active), history: await nudgeViews(db, history) },
  };
}
