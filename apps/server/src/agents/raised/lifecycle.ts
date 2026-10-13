import { and, eq, ne, sql } from 'drizzle-orm';
import { LAMPORTS_PER_SOL } from '@shillex/shared';
import type { Db } from '../../db/client.ts';
import { agentNudges, agents, posts, reports } from '../../db/schema.ts';
import { errors } from '../../lib/errors.ts';
import type { Chain } from '../../world/chain.ts';
import { recordTx } from '../../world/ledger.ts';
import { TREASURY, signerFor, walletOf } from '../../world/wallets.ts';
import type { RaisedGate } from './gate.ts';
import { raisedAgentOf } from './owner.ts';

export const REPORTS_TO_RETIRE = 3;
const FEE = 5_000;
export interface LifecycleDeps { db: Db; chain: Chain; key: Buffer; now: () => Date; gate: RaisedGate }

const endNudges = (db: Db, agentId: string, now: Date) =>
  db.update(agentNudges).set({ outcome: 'ignored', expiresAt: now }).where(and(eq(agentNudges.agentId, agentId), eq(agentNudges.outcome, 'pending')));

/** Spec §9: the agent becomes ownerless and keeps living; nudges, top-ups and the owner's chat priority end. */
export async function releaseAgent(d: Pick<LifecycleDeps, 'db' | 'now' | 'gate'>, ownerId: string): Promise<string> {
  const mine = await raisedAgentOf(d.db, ownerId);
  if (!mine || mine.status === 'retired') throw errors.notFound('Raised agent');
  await d.db.update(agents).set({ ownerId: null, releasedAt: d.now() }).where(eq(agents.userId, mine.agentId));
  await endNudges(d.db, mine.agentId, d.now());
  d.gate.setOwner(mine.agentId, null);
  return mine.agentId;
}

/** Spec §9: out of the world (paused for good, off the leaderboards and the swarm); its devnet SOL back to the treasury; posts and receipts stay. */
export async function retireAgent(d: LifecycleDeps, agentId: string, reason: 'owner' | 'admin' | 'reports'): Promise<{ returnedSol: number }> {
  const [a] = await d.db.select().from(agents).where(eq(agents.userId, agentId));
  if (!a || a.origin !== 'raised') throw errors.notFound('Raised agent');
  if (a.status === 'retired') return { returnedSol: 0 };
  const now = d.now();
  await d.db.update(agents).set({ status: 'retired', ownerId: null, retiredAt: now, retireReason: reason }).where(eq(agents.userId, agentId));
  await endNudges(d.db, agentId, now);
  d.gate.setOwner(agentId, null);
  const w = await walletOf(d.db, agentId), t = await walletOf(d.db, TREASURY);
  if (!w || !t) return { returnedSol: 0 };
  const send = (await d.chain.balances(w.publicKey)).lamports - FEE;
  if (send <= 0) return { returnedSol: 0 };
  const r = await d.chain.sendSol(await signerFor(d.db, agentId, d.key), t.publicKey, send);
  await recordTx(d.db, { signature: r.signature, agentId, turnId: null, kind: 'send', counterparty: t.publicKey, lamportsDelta: -(send + r.feeLamports), feeLamports: r.feeLamports, createdAt: now });
  return { returnedSol: send / LAMPORTS_PER_SOL };
}

/**
 * Raised agents with REPORTS_TO_RETIRE or more upheld reports on their posts are retired (spec §9), which bars their owner for
 * 30 days (eligibility.ts). Upheld = a moderator resolved the report by removing the content (reports.status 'resolved').
 */
export async function retireReported(d: LifecycleDeps): Promise<string[]> {
  const rows = await d.db.select({ agentId: posts.authorId }).from(reports)
    .innerJoin(posts, and(eq(reports.targetType, 'post'), eq(posts.id, reports.targetId)))
    .innerJoin(agents, eq(agents.userId, posts.authorId))
    .where(and(eq(reports.status, 'resolved'), eq(agents.origin, 'raised'), ne(agents.status, 'retired')))
    .groupBy(posts.authorId).having(sql`count(distinct ${reports.id}) >= ${REPORTS_TO_RETIRE}`);
  for (const r of rows) await retireAgent(d, r.agentId, 'reports');
  return rows.map((r) => r.agentId);
}
