import { and, eq, isNotNull } from 'drizzle-orm';
import { verify } from '@node-rs/argon2';
import { z } from 'zod';
import type { AccountProof } from '@shillex/shared';
import type { AppDeps } from '../deps.ts';
import { userWallets, type UserRow } from '../db/schema.ts';
import { errors } from '../lib/errors.ts';
import { WalletProofBody, verifyProof } from './wallet-auth.ts';

export const AccountProofBody = z.union([z.object({ password: z.string().min(1).max(128) }), z.object({ wallet: WalletProofBody })]);

/**
 * Proof the account holder is here (spec §5 Settings): the current password when the account has one; otherwise a fresh
 * `confirm` signature, bound to this user, by one of the account's verified wallets.
 */
export async function requireProof(deps: Pick<AppDeps, 'db' | 'config' | 'now'>, user: UserRow, proof: AccountProof): Promise<void> {
  if (user.passwordHash) {
    if (!('password' in proof) || !(await verify(user.passwordHash, proof.password))) throw errors.forbidden('PROOF_FAILED', 'That password is wrong');
    return;
  }
  if (!('wallet' in proof)) throw errors.forbidden('PROOF_FAILED', 'Confirm with one of your wallets');
  const { address } = await verifyProof(deps, proof.wallet, 'confirm', user.id);
  const [w] = await deps.db.select({ a: userWallets.address }).from(userWallets)
    .where(and(eq(userWallets.address, address), eq(userWallets.userId, user.id), isNotNull(userWallets.verifiedAt))).limit(1);
  if (!w) throw errors.forbidden('PROOF_FAILED', 'Sign with a wallet linked to this account');
}
