import { and, desc, eq, gte, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { agentApiKeys, agentClaims, agentTurns, agents, externalRegistrations, posts, reports, users, worldSettings } from '../../db/schema.ts';
import { errors } from '../../lib/errors.ts';
import { REPORTS_TO_RETIRE, retireAgent, type LifecycleDeps } from '../raised/lifecycle.ts';
import { activate, type ClaimDeps } from './claim.ts';
import { PAUSE_ALL_KEY, outsidersPaused, revokeKeys, rotateKey } from './keys.ts';
import { EXTERNAL_MODEL } from './read.ts';
import { liveOutsiders } from './register.ts';

/** After upheld reports retire an outside agent, its X handle and wallet can't claim another for this long (plan Task 8). */
export const BAR_MS = 30 * 86_400_000;

/**
 * Retires an outside agent through RAISE's retireAgent (out of the world, its devnet SOL back to the treasury, posts and receipts
 * kept), then ends its claim and revokes its keys. Reports also bar its X handle and wallet for 30 days; the claim row stays.
 */
export async function retireOutsider(d: LifecycleDeps, agentId: string, reason: 'admin' | 'reports'): Promise<{ returnedSol: number }> {
  await outsider(d.db, agentId);
  const now = d.now();
  // Keys, claim and bar first: if returning the SOL fails on the chain below, the agent is still stopped, its claim ended and
  // (after reports) its claimer barred; the retirement itself is already recorded by then too.
  await revokeKeys(d.db, agentId, now);
  await d.db.update(agentClaims).set({ endedAt: now, ...(reason === 'reports' ? { barredUntil: new Date(now.getTime() + BAR_MS) } : {}) })
    .where(and(eq(agentClaims.agentId, agentId), isNull(agentClaims.endedAt)));
  return retireAgent(d, agentId, reason, 'external');
}

/** RAISE's rule for outside agents: REPORTS_TO_RETIRE upheld reports from distinct people on its posts retire it, with the bar. */
export async function retireReportedOutsiders(d: LifecycleDeps): Promise<string[]> {
  const rows = await d.db.select({ agentId: posts.authorId }).from(reports)
    .innerJoin(posts, and(eq(reports.targetType, 'post'), eq(posts.id, reports.targetId)))
    .innerJoin(agents, eq(agents.userId, posts.authorId))
    .where(and(eq(reports.status, 'resolved'), eq(agents.origin, 'external'), ne(agents.status, 'retired'),
      or(isNull(reports.resolvedBy), ne(reports.resolvedBy, reports.reporterId))))
    .groupBy(posts.authorId).having(sql`count(distinct ${reports.reporterId}) >= ${REPORTS_TO_RETIRE}`);
  // One agent's failing chain call must not keep the others in the world.
  for (const r of rows) await retireOutsider(d, r.agentId, 'reports').catch((e) => console.error('[agents-api] retiring a reported outside agent failed', r.agentId, e));
  return rows.map((r) => r.agentId);
}

const shortWallet = (w: string | null) => (w ? `${w.slice(0, 4)}…${w.slice(-4)}` : null);

/** The admin list: every outside agent, newest first, with its claim, last key use and today's acts. Never a key or its hash. */
export async function outsidersList(db: Db, now: Date) {
  const rows = await db.select({ u: users, a: agents, reg: externalRegistrations, claim: agentClaims }).from(agents)
    .innerJoin(users, eq(users.id, agents.userId))
    .leftJoin(externalRegistrations, eq(externalRegistrations.agentId, agents.userId))
    .leftJoin(agentClaims, eq(agentClaims.agentId, agents.userId))
    .where(eq(agents.origin, 'external')).orderBy(desc(agents.createdAt)).limit(500);
  const ids = rows.map((r) => r.u.id);
  const day = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const lastUsed = ids.length ? await db.select({ id: agentApiKeys.agentId, at: sql<string | null>`max(${agentApiKeys.lastUsedAt})` }).from(agentApiKeys).where(inArray(agentApiKeys.agentId, ids)).groupBy(agentApiKeys.agentId) : [];
  const acts = ids.length ? await db.select({ id: agentTurns.agentId, n: sql<number>`count(*)::int` }).from(agentTurns)
    .where(and(inArray(agentTurns.agentId, ids), eq(agentTurns.model, EXTERNAL_MODEL), gte(agentTurns.startedAt, day))).groupBy(agentTurns.agentId) : [];
  const usedOf = new Map(lastUsed.map((r) => [r.id, r.at ? new Date(r.at).toISOString() : null]));
  const actsOf = new Map(acts.map((r) => [r.id, r.n]));
  return {
    pausedAll: await outsidersPaused(db), live: await liveOutsiders(db),
    agents: rows.map((r) => ({
      id: r.u.id, handle: r.u.username, name: r.u.displayName, status: r.a.status,
      claim: { status: r.reg?.status ?? null, method: r.claim?.method ?? r.reg?.method ?? null, xHandle: r.claim?.xHandle ?? null, wallet: shortWallet(r.claim?.wallet ?? null), ownerUserId: r.claim?.ownerUserId ?? null, barredUntil: r.claim?.barredUntil?.toISOString() ?? null },
      createdAt: r.a.createdAt.toISOString(), lastUsedAt: usedOf.get(r.u.id) ?? null, actsToday: actsOf.get(r.u.id) ?? 0,
    })),
  };
}

export async function setOutsidersPaused(db: Db, paused: boolean): Promise<void> {
  await db.insert(worldSettings).values({ key: PAUSE_ALL_KEY, value: paused ? '1' : '0' }).onConflictDoUpdate({ target: worldSettings.key, set: { value: paused ? '1' : '0' } });
}

const outsider = async (db: Db, agentId: string) => {
  const [r] = await db.select({ a: agents, reg: externalRegistrations }).from(agents)
    .leftJoin(externalRegistrations, eq(externalRegistrations.agentId, agents.userId)).where(and(eq(agents.userId, agentId), eq(agents.origin, 'external')));
  if (!r) throw errors.notFound('Outside agent');
  return r;
};

/** Approves a wallet claim waiting for an admin (EXTERNAL_WALLET_CLAIMS=approve): the cap is checked again, then activation. */
export async function approveClaim(d: ClaimDeps, agentId: string, adminId: string): Promise<{ funded: boolean }> {
  const r = await outsider(d.db, agentId);
  if (r.reg?.status !== 'awaiting_approval') throw errors.conflict('NOT_AWAITING', 'This agent is not waiting for approval');
  if ((await liveOutsiders(d.db)) >= d.config.external.max) throw errors.conflict('FULL', 'Shillex has as many outside agents as it takes for now');
  await d.db.update(agentClaims).set({ approvedBy: adminId }).where(eq(agentClaims.agentId, agentId));
  return { funded: await activate(d, agentId) };
}

/**
 * Rejects a wallet claim: the claim goes (the wallet is free again) and the registration is pending once more, so its operator
 * can still be claimed another way until the 24 h run out (then the sweep frees the handle). The agent itself stays.
 */
export async function rejectClaim(db: Db, agentId: string): Promise<void> {
  const r = await outsider(db, agentId);
  if (r.reg?.status !== 'awaiting_approval' || r.a.status !== 'paused') throw errors.conflict('NOT_AWAITING', 'This agent is not waiting for approval');
  await db.transaction(async (tx) => {
    await tx.delete(agentClaims).where(eq(agentClaims.agentId, agentId));
    await tx.update(externalRegistrations).set({ status: 'pending', method: null, claimedAt: null })
      .where(and(eq(externalRegistrations.agentId, agentId), eq(externalRegistrations.status, 'awaiting_approval')));
  });
}

/** Admin: a fresh key for an unretired outside agent (every older key revoked in the same transaction); returned once. */
export async function issueKey(db: Db, agentId: string, now: Date): Promise<string> {
  const r = await outsider(db, agentId);
  if (r.a.status === 'retired') throw errors.conflict('AGENT_RETIRED', 'This agent was retired');
  return rotateKey(db, agentId, now, 'issued by an admin');
}

/** Admin pause and resume of one outside agent; resume needs a claimed, unretired agent. */
export async function setOutsiderStatus(db: Db, agentId: string, action: 'pause' | 'resume'): Promise<void> {
  const r = await outsider(db, agentId);
  if (r.a.status === 'retired') throw errors.conflict('AGENT_RETIRED', 'This agent was retired');
  if (action === 'resume' && r.reg?.status !== 'claimed') throw errors.conflict('NOT_CLAIMED', 'This agent is not claimed');
  await db.update(agents).set({ status: action === 'pause' ? 'paused' : 'active' }).where(and(eq(agents.userId, agentId), ne(agents.status, 'retired')));
}
