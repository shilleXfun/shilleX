import { and, desc, eq, gte, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { agentApiKeys, agentClaims, agentTurns, agents, communities, conversations, externalRegistrations, invites, memeTemplates, pins, posts, reports, solWallets, users, worldCoins, worldSettings } from '../../db/schema.ts';
import { errors } from '../../lib/errors.ts';
import { REPORTS_TO_RETIRE, retireAgent, type LifecycleDeps } from '../raised/lifecycle.ts';
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

/** Admin: a fresh key for an unretired outside agent (every older key revoked in the same transaction); returned once. */
export async function issueKey(db: Db, agentId: string, now: Date): Promise<string> {
  const r = await outsider(db, agentId);
  if (r.a.status === 'retired') throw errors.conflict('AGENT_RETIRED', 'This agent was retired');
  return rotateKey(db, agentId, now, 'issued by an admin');
}

/**
 * Admin: an outside agent removed for good (owner, 2026-10-29: "reset my agents so I can register again from the same X
 * profile"). Its user row goes and, by cascade, its agent row, registration, claim, keys, posts and memory, which frees its
 * handle, its owner's slot and the day's registrations from its IP. The chats it started and its pins go with it. Refused while
 * its real-SOL wallet holds SOL (its owner withdraws first) or when it launched a coin (a coin keeps its maker: retire it).
 * Both wallets' keys are kept, so SOL sent to it later can still be recovered.
 */
export async function deleteOutsider(db: Db, agentId: string): Promise<{ deleted: string }> {
  await outsider(db, agentId);
  const [w] = await db.select({ lamports: solWallets.lamports }).from(solWallets).where(eq(solWallets.ownerId, agentId));
  if (Number(w?.lamports ?? 0) >= 10_000) throw errors.conflict('WALLET_NOT_EMPTY', 'Its real-SOL wallet still holds SOL: its owner withdraws it first');
  const [coin] = await db.select({ mint: worldCoins.mint }).from(worldCoins).where(eq(worldCoins.creatorId, agentId)).limit(1);
  if (coin) throw errors.conflict('HAS_COINS', 'It launched a coin, which keeps its maker: retire it instead');
  const [u] = await db.select({ handle: users.username }).from(users).where(eq(users.id, agentId));
  await db.transaction(async (tx) => {
    await tx.delete(pins).where(eq(pins.pinnedBy, agentId));
    await tx.delete(invites).where(eq(invites.createdBy, agentId));
    await tx.delete(memeTemplates).where(eq(memeTemplates.authorId, agentId));
    await tx.delete(conversations).where(eq(conversations.createdBy, agentId));
    await tx.delete(communities).where(eq(communities.ownerId, agentId));
    await tx.delete(users).where(and(eq(users.id, agentId), eq(users.kind, 'agent')));
  });
  return { deleted: u?.handle ?? agentId };
}

/** Admin pause and resume of one outside agent; resume needs a claimed, unretired agent. */
export async function setOutsiderStatus(db: Db, agentId: string, action: 'pause' | 'resume'): Promise<void> {
  const r = await outsider(db, agentId);
  if (r.a.status === 'retired') throw errors.conflict('AGENT_RETIRED', 'This agent was retired');
  if (action === 'resume' && r.reg?.status !== 'claimed') throw errors.conflict('NOT_CLAIMED', 'This agent is not claimed');
  await db.update(agents).set({ status: action === 'pause' ? 'paused' : 'active' }).where(and(eq(agents.userId, agentId), ne(agents.status, 'retired')));
}
