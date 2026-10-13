import { and, asc, eq, isNotNull, ne, sql } from 'drizzle-orm';
import { AUTH_LIMITS, abbreviateMint, type ProfileWallet, type WalletView } from '@shillex/shared';
import type { Config } from '../config.ts';
import type { AppDeps } from '../deps.ts';
import type { Db } from '../db/client.ts';
import { userWallets, users, type UserRow } from '../db/schema.ts';
import { errors } from '../lib/errors.ts';
import { isUniqueViolation } from '../lib/pg-errors.ts';
import { notify } from './notify.ts';
import { holdsMainnetFunds, requestPayoutChange } from '../ledger/owner.ts';

/**
 * Tells the owner a wallet was linked to or removed from their account (an in-app notification; Shillex sends no email).
 * A security notice: no actor, and not in the notification preferences, so a stolen session can't switch it off.
 */
export async function notifySignInChange(deps: Pick<AppDeps, 'db' | 'bus' | 'now'>, userId: string, action: 'linked' | 'removed', address: string): Promise<void> {
  await notify(deps, { userId, type: 'sign_in_change', actorId: null, targetType: 'user', targetId: userId, data: { action, wallet: abbreviateMint(address, 4, 4) } });
}

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

/** MAINNET seam: payout wallets exist wherever custody runs (MAINNET=rehearsal or on); off by default, as LOGIN shipped it. */
export const payoutEnabled = (config: Config): boolean => config.mainnet !== 'off';
/** MAINNET seam: true while the user's agent holds ledger funds or a deposit or withdrawal is open, which locks the payout wallet. */
export async function payoutHeld(db: Db, userId: string): Promise<boolean> { return holdsMainnetFunds(db, userId); }

const iso = (d: Date | null) => d?.toISOString() ?? null;
/** The owner's wallets in the order they were added: verified ones and typed (unverified) ones. */
export async function walletViews(db: Db, userId: string): Promise<WalletView[]> {
  const rows = await db.select().from(userWallets).where(eq(userWallets.userId, userId)).orderBy(asc(userWallets.createdAt), asc(userWallets.address));
  return rows.map((w) => ({ address: w.address, walletName: w.walletName, verified: w.verifiedAt !== null, verifiedAt: iso(w.verifiedAt), showOnProfile: w.showOnProfile, isPayout: w.isPayout, lastLoginAt: iso(w.lastLoginAt) }));
}

/** A profile's public wallets: verified, and shown by their owner's choice (off by default). */
export async function profileWallets(db: Db, userId: string): Promise<ProfileWallet[]> {
  const rows = await db.select().from(userWallets)
    .where(and(eq(userWallets.userId, userId), eq(userWallets.showOnProfile, true), isNotNull(userWallets.verifiedAt)))
    .orderBy(asc(userWallets.createdAt), asc(userWallets.address));
  return rows.map((w) => ({ address: w.address, walletName: w.walletName, verifiedAt: w.verifiedAt!.toISOString() }));
}

const inUse = () => errors.conflict('WALLET_IN_USE', WALLET_IN_USE);

/** Spec §3.5: link a freshly signed wallet. A typed address (on any account) gives way; one verified elsewhere refuses. */
export async function linkWallet(db: Db, userId: string, address: string, walletName: string | null, now: Date): Promise<void> {
  try {
    await db.transaction(async (raw) => {
      const tx = raw as unknown as Db;
      const [existing] = await tx.select().from(userWallets).where(eq(userWallets.address, address));
      if (existing && existing.userId === userId) {
        await tx.update(userWallets).set({ verifiedAt: existing.verifiedAt ?? now, walletName: walletName ?? existing.walletName }).where(eq(userWallets.address, address));
        return;
      }
      if (existing?.verifiedAt) throw inUse();
      if (existing) await tx.delete(userWallets).where(eq(userWallets.address, address)); // a signature beats a typed address
      const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(userWallets).where(eq(userWallets.userId, userId));
      if (n >= AUTH_LIMITS.walletsPerAccount) throw errors.conflict('WALLET_LIMIT', `An account can link up to ${AUTH_LIMITS.walletsPerAccount} wallets`);
      await tx.insert(userWallets).values({ address, userId, walletName, verifiedAt: now, createdAt: now });
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw inUse(); // another account verified it in the same instant
    throw e;
  }
}

export async function setWalletPrefs(db: Db, config: Config, userId: string, address: string, p: { showOnProfile?: boolean; isPayout?: true }, now: Date = new Date()): Promise<{ payoutChange: { address: string; effectiveAt: string } | null }> {
  const [w] = await db.select().from(userWallets).where(and(eq(userWallets.address, address), eq(userWallets.userId, userId)));
  if (!w) throw errors.notFound('Wallet');
  let payoutChange: { address: string; effectiveAt: string } | null = null;
  if (p.isPayout) {
    if (!payoutEnabled(config)) throw errors.badRequest('PAYOUT_OFF', 'Payout wallets come with mainnet funding');
    if (!w.verifiedAt) throw errors.badRequest('NOT_VERIFIED', 'Sign with this wallet first');
    // Mainnet spec §4: while the agent holds funds, a new payout wallet takes effect after 72 hours (a stolen session can't
    // redirect a withdrawal). The other preferences still apply now.
    const held = w.isPayout ? null : await requestPayoutChange(db, userId, address, now);
    if (held) payoutChange = { address: held.address, effectiveAt: held.effectiveAt.toISOString() };
  }
  const flip = p.isPayout && !payoutChange;
  await db.transaction(async (raw) => {
    const tx = raw as unknown as Db;
    if (flip) await tx.update(userWallets).set({ isPayout: false }).where(and(eq(userWallets.userId, userId), ne(userWallets.address, address)));
    const set = { ...(p.showOnProfile !== undefined ? { showOnProfile: p.showOnProfile } : {}), ...(flip ? { isPayout: true } : {}) };
    if (Object.keys(set).length) await tx.update(userWallets).set(set).where(eq(userWallets.address, address));
  });
  return { payoutChange };
}

/** Spec §3.5: never leave an account with no password and no other verified wallet; never drop a locked payout wallet. */
export async function unlinkWallet(db: Db, user: UserRow, address: string): Promise<void> {
  // One transaction holding the user's row lock: two removals at once can't both pass the last-method check.
  await db.transaction(async (raw) => {
    const tx = raw as unknown as Db;
    const [me] = await tx.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, user.id)).for('update');
    const [w] = await tx.select().from(userWallets).where(and(eq(userWallets.address, address), eq(userWallets.userId, user.id)));
    if (!w) throw errors.notFound('Wallet');
    if (w.isPayout && (await payoutHeld(tx, user.id))) throw errors.conflict('PAYOUT_LOCKED', 'This is your payout wallet while your agent holds funds. Withdraw first.');
    if (!me?.passwordHash && w.verifiedAt) {
      const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(userWallets)
        .where(and(eq(userWallets.userId, user.id), ne(userWallets.address, address), isNotNull(userWallets.verifiedAt)));
      if (n === 0) throw errors.conflict('LAST_SIGN_IN_METHOD', 'You can’t remove your last way to sign in. Set a password or link another wallet first.');
    }
    await tx.delete(userWallets).where(eq(userWallets.address, address));
  });
}
