import { and, desc, eq, sql } from 'drizzle-orm';
import type { MainnetMode, ReservesView } from '@shillex/shared';
import type { Db } from '../db/client.ts';
import { ledgerReconciliations, ledgerWithdrawals } from '../db/schema.ts';
import { newId } from '../lib/ids.ts';
import { books } from './books.ts';
import { FEE_MARGIN, type Custody } from './custody.ts';
import type { LedgerChain } from './ledger-chain.ts';
import type { MainnetHandles } from './routes.ts';

/** Unreadable checks in a row (30 minutes at the 10-minute cadence) before the books freeze anyway. */
export const UNREACHABLE_LIMIT = 3;
export type ReconciliationRow = typeof ledgerReconciliations.$inferSelect;

/**
 * Spec §5, every 10 minutes: the journal must match every balance, and the hot vault plus the cold address must cover the books.
 * A mismatch freezes trading and deposits (the engine runs talk-only, withdrawals wait for review). Only an admin unfreezes.
 */
export async function reconcile(d: { db: Db; chain: LedgerChain; custody: Custody | null; mode: MainnetMode; now: () => Date }): Promise<ReconciliationRow> {
  const b = await books(d.db), at = d.now();
  // A withdrawal being sent may already have left the vault (with its fee) before the books settle it: it counts as possibly gone.
  const [flight] = await d.db.select({ n: sql<number>`coalesce(sum(${ledgerWithdrawals.lamports} + ${FEE_MARGIN}), 0)::float8` })
    .from(ledgerWithdrawals).where(and(eq(ledgerWithdrawals.season, b.season), eq(ledgerWithdrawals.status, 'sending')));
  const required = Math.max(0, b.ledgerTotal - (flight?.n ?? 0));
  let onchain: number | null = null, error: string | null = null;
  if (d.custody) { try { onchain = await d.custody.reserves(); } catch (e) { error = (e as Error).message; } }
  const shortBy = onchain !== null && onchain < required ? required - onchain : 0;
  const ok = error ? null : b.ok && shortBy === 0;
  const row: ReconciliationRow = { id: newId(), season: b.season, mode: d.mode, at, ok, ledgerTotal: b.ledgerTotal, onchainTotal: onchain, details: { mismatches: b.mismatches, shortBy, error } };
  await d.db.insert(ledgerReconciliations).values(row);
  if (ok === false && !d.chain.frozen) {
    await d.chain.freeze(`The books did not reconcile at ${at.toISOString()}: ${shortBy ? `reserves short by ${shortBy} lamports` : b.mismatches.slice(0, 3).join('; ')}`);
  }
  if (ok === null && !d.chain.frozen) {
    const last = await d.db.select({ ok: ledgerReconciliations.ok }).from(ledgerReconciliations).where(eq(ledgerReconciliations.mode, d.mode)).orderBy(desc(ledgerReconciliations.at)).limit(UNREACHABLE_LIMIT);
    if (last.length === UNREACHABLE_LIMIT && last.every((r) => r.ok === null)) await d.chain.freeze(`Custody's RPC was unreachable for ${UNREACHABLE_LIMIT} checks in a row: ${error}`);
  }
  return row;
}

/**
 * The public proof-of-reserves page (spec §5): vault addresses, the books' total and when a check last passed. Both totals
 * come from the same check, so a deposit made since then never shows the world as owing more than it holds.
 */
export async function reservesView(db: Db, h: MainnetHandles): Promise<ReservesView> {
  const [last] = await db.select().from(ledgerReconciliations).orderBy(desc(ledgerReconciliations.at)).limit(1);
  const [pass] = await db.select({ at: ledgerReconciliations.at }).from(ledgerReconciliations).where(eq(ledgerReconciliations.ok, true)).orderBy(desc(ledgerReconciliations.at)).limit(1);
  return {
    mode: h.mode, network: h.custody?.network ?? null, hot: h.custody ? await h.custody.hot() : null, cold: h.custody?.cold ?? null,
    ledgerTotalSol: (last ? last.ledgerTotal : (await books(db)).ledgerTotal) / 1e9, onchainTotalSol: last?.onchainTotal == null ? null : last.onchainTotal / 1e9,
    lastCheckAt: last?.at.toISOString() ?? null, lastPassAt: pass?.at.toISOString() ?? null, frozen: h.chain.frozen !== null,
  };
}
