import { and, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { agents, ledgerDeposits, ledgerHoldings, ledgerPayoutChanges, ledgerWithdrawals, userWallets, users } from '../db/schema.ts';
import { walletOf } from '../world/wallets.ts';
import { lamportsOf } from './accounts.ts';
import type { Custody } from './custody.ts';

export const PAYOUT_HOLD_MS = 72 * 3_600_000;

/** The human's raised agent (RAISE: at most one per human), or null. */
export async function ownedAgent(db: Db, userId: string): Promise<{ id: string; username: string } | null> {
  const [a] = await db.select({ id: agents.userId, username: users.username }).from(agents).innerJoin(users, eq(users.id, agents.userId)).where(and(eq(agents.ownerId, userId), eq(agents.origin, 'raised')));
  return a ?? null;
}

/** True while the owner's agent holds ledger SOL or coins, or a deposit or withdrawal is still open (spec §4's payout lock). */
export async function holdsMainnetFunds(db: Db, userId: string): Promise<boolean> {
  const a = await ownedAgent(db, userId);
  if (a) {
    const w = await walletOf(db, a.id);
    if (w && (await lamportsOf(db, w.publicKey)) > 0) return true;
    if (w && (await db.select({ r: ledgerHoldings.raw }).from(ledgerHoldings).where(and(eq(ledgerHoldings.account, w.publicKey), gt(ledgerHoldings.raw, 0))).limit(1)).length) return true;
  }
  const [d] = await db.select({ n: sql<number>`count(*)::int` }).from(ledgerDeposits).where(and(eq(ledgerDeposits.userId, userId), eq(ledgerDeposits.status, 'pending')));
  const [x] = await db.select({ n: sql<number>`count(*)::int` }).from(ledgerWithdrawals).where(and(eq(ledgerWithdrawals.userId, userId), inArray(ledgerWithdrawals.status, ['queued', 'sending'])));
  return Boolean(d?.n || x?.n);
}

/**
 * A new payout wallet. While funds are held it waits 72 hours, so a stolen session can't redirect a withdrawal; otherwise the
 * caller applies it at once (returns null).
 */
export async function requestPayoutChange(db: Db, userId: string, address: string, now: Date): Promise<{ address: string; effectiveAt: Date } | null> {
  if (!(await holdsMainnetFunds(db, userId))) return null;
  const effectiveAt = new Date(now.getTime() + PAYOUT_HOLD_MS);
  await db.insert(ledgerPayoutChanges).values({ userId, address, requestedAt: now, effectiveAt })
    .onConflictDoUpdate({ target: ledgerPayoutChanges.userId, set: { address, requestedAt: now, effectiveAt } });
  return { address, effectiveAt };
}

export async function pendingPayoutChange(db: Db, userId: string) {
  const [p] = await db.select().from(ledgerPayoutChanges).where(eq(ledgerPayoutChanges.userId, userId));
  return p ?? null;
}

/** Applies every change whose hold is over: one payout wallet per user, still verified and still theirs. */
export async function applyDuePayoutChanges(db: Db, now: Date, notify?: (userId: string, summary: string) => Promise<void>): Promise<number> {
  const due = await db.select().from(ledgerPayoutChanges).where(lte(ledgerPayoutChanges.effectiveAt, now));
  let n = 0;
  for (const p of due) {
    let applied = false;
    await db.transaction(async (x) => {
      const tx = x as unknown as Db;
      const [w] = await tx.select().from(userWallets).where(and(eq(userWallets.address, p.address), eq(userWallets.userId, p.userId)));
      if (w?.verifiedAt) {
        await tx.update(userWallets).set({ isPayout: false }).where(eq(userWallets.userId, p.userId));
        await tx.update(userWallets).set({ isPayout: true }).where(eq(userWallets.address, p.address));
        applied = true;
      }
      await tx.delete(ledgerPayoutChanges).where(eq(ledgerPayoutChanges.userId, p.userId));
    });
    if (applied) { n++; await notify?.(p.userId, `Your payout wallet is now ${p.address.slice(0, 4)}…${p.address.slice(-4)}`); }
  }
  return n;
}

/** The running world's custody (set by bootMainnet; null without MAINNET=rehearsal|on), for code outside the ledger folder. */
let live: Custody | null = null;
export function setLiveCustody(c: Custody | null) { live = c; }
export const liveCustody = () => live;

/**
 * A raised agent leaving its owner (released or retired): what the owner put in goes back to them, never to the house or to
 * whoever the agent belongs to next. With custody running, the agent cashes out (sells what vesting allows) and everything
 * free is queued to the owner's payout wallet. Returns the lamports queued, 0 when there was nothing to send.
 */
export async function settleLeavingOwner(agentId: string, ownerId: string | null): Promise<number> {
  const c = live;
  if (!c || !ownerId) return 0;
  const out = await c.cashOut({ agentId, userId: ownerId }).catch((e: Error) => {
    console.error(`[mainnet] could not cash out ${agentId} for its leaving owner: ${e.message}`);
    return null;
  });
  if (out?.withdrawal) void c.processWithdrawals().catch((e) => console.error('[mainnet] withdrawals', e));
  return out?.withdrawal?.lamports ?? 0;
}
