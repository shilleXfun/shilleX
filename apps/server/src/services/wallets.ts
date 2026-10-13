import { and, asc, eq, isNotNull } from 'drizzle-orm';
import type { WalletView } from '@shillex/shared';
import type { Config } from '../config.ts';
import type { Db } from '../db/client.ts';
import { userWallets, users, type UserRow } from '../db/schema.ts';

export const WALLET_IN_USE = 'This wallet is linked to another Shillex account. Sign in with it there and unlink it first.';

/** The account a verified wallet signs into. Humans only: agents never sign in with a wallet. */
export async function verifiedWalletOwner(db: Db, address: string): Promise<UserRow | null> {
  const [r] = await db.select({ u: users }).from(userWallets).innerJoin(users, eq(users.id, userWallets.userId))
    .where(and(eq(userWallets.address, address), isNotNull(userWallets.verifiedAt), eq(users.kind, 'human'))).limit(1);
  return r?.u ?? null;
}

export async function touchLogin(db: Db, address: string, now: Date): Promise<void> {
  await db.update(userWallets).set({ lastLoginAt: now }).where(eq(userWallets.address, address));
}

/** Parallel-build contract §4 (MAINNET): the user's verified payout wallet, the only place withdrawals may go. */
export async function payoutWallet(db: Db, userId: string): Promise<string | null> {
  const [r] = await db.select({ a: userWallets.address }).from(userWallets)
    .where(and(eq(userWallets.userId, userId), eq(userWallets.isPayout, true), isNotNull(userWallets.verifiedAt))).limit(1);
  return r?.a ?? null;
}

/** MAINNET seam: whether payout wallets exist yet. LOGIN ships it off; the mainnet plan returns its launch-gate state. */
export const payoutEnabled = (_config: Config): boolean => false;
/** MAINNET seam: true while the user's agent holds mainnet funds, which locks the payout wallet. LOGIN ships it false. */
export async function payoutHeld(_db: Db, _userId: string): Promise<boolean> { return false; }

const iso = (d: Date | null) => d?.toISOString() ?? null;
/** The owner's wallets in the order they were added: verified ones and typed (unverified) ones. */
export async function walletViews(db: Db, userId: string): Promise<WalletView[]> {
  const rows = await db.select().from(userWallets).where(eq(userWallets.userId, userId)).orderBy(asc(userWallets.createdAt), asc(userWallets.address));
  return rows.map((w) => ({ address: w.address, walletName: w.walletName, verified: w.verifiedAt !== null, verifiedAt: iso(w.verifiedAt), showOnProfile: w.showOnProfile, isPayout: w.isPayout, lastLoginAt: iso(w.lastLoginAt) }));
}
