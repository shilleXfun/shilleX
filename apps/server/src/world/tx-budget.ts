import { and, gt, notInArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { chainTxs } from '../db/schema.ts';

/**
 * The agents' chain budget (2026-10-26, Phase 3): a world-wide cap on chain transactions per hour, so the free public devnet RPC is
 * never run dry again (the stall of 2026-10-17 was an RPC out of credit). Paced: at most a sixth of the hour's cap in any ten
 * minutes, so trades spread over the hour instead of all landing in its first minutes. A trade over budget waits; it is never faked.
 * Counted from chain_txs (one row per signature, a transfer's 'receive' row shares its signature), so it holds across restarts
 * and deploys.
 */
export const TX_HOUR_MS = 3_600_000, TX_SLICE_MS = 600_000;
/** Ledger-only kinds, which never touch the devnet RPC. */
const OFF_CHAIN = ['opening', 'deposit', 'withdraw'];
/** A count is reused this long: every engine turn asks, and the answer moves only when a transaction lands. */
const MEMO_MS = 10_000;
const memo = new WeakMap<Db, { at: number; hour: number; slice: number }>();

async function counts(db: Db, now: Date): Promise<{ hour: number; slice: number }> {
  const m = memo.get(db);
  if (m && now.getTime() - m.at >= 0 && now.getTime() - m.at < MEMO_MS) return m;
  const slice = new Date(now.getTime() - TX_SLICE_MS).toISOString();
  const [r] = await db.select({
    hour: sql<number>`count(distinct ${chainTxs.signature})::int`,
    slice: sql<number>`count(distinct ${chainTxs.signature}) filter (where ${chainTxs.createdAt} > ${slice}::timestamptz)::int`,
  }).from(chainTxs).where(and(gt(chainTxs.createdAt, new Date(now.getTime() - TX_HOUR_MS)), notInArray(chainTxs.kind, OFF_CHAIN as never[])));
  const c = { at: now.getTime(), hour: Number(r?.hour ?? 0), slice: Number(r?.slice ?? 0) };
  memo.set(db, c);
  return c;
}

/** Transactions the agents may still send now: what is left of the hour's cap and of this ten minutes' share. 0 or less: wait. */
export async function txLeft(db: Db, capPerHour: number, now: Date): Promise<number> {
  if (capPerHour <= 0) return 0;
  const c = await counts(db, now);
  return Math.min(capPerHour - c.hour, Math.ceil(capPerHour / 6) - c.slice);
}

/** Forget the cached count (after a transaction this process sent, so the next ask sees it). */
export function txSpent(db: Db): void { memo.delete(db); }
