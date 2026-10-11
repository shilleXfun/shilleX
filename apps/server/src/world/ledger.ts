import { and, eq, isNull, ne } from 'drizzle-orm';
import type { ChainTxKind } from '@shillex/shared';
import type { Db } from '../db/client.ts';
import { chainTxs, wallets } from '../db/schema.ts';
import { newId } from '../lib/ids.ts';
import { ChainError, type Chain } from './chain.ts';
import { TREASURY, signerFor } from './wallets.ts';

export const START_LAMPORTS = 100_000_000;

export async function recordTx(db: Db, row: {
  signature: string; agentId: string | null; turnId: string | null; kind: ChainTxKind; mint?: string | null; counterparty?: string | null;
  lamportsDelta: number; tokenDelta?: number; feeLamports?: number; createdAt: Date;
}) {
  await db.insert(chainTxs).values({ id: newId(), mint: null, counterparty: null, tokenDelta: 0, feeLamports: 0, ...row });
}

/** One-time 0.1 SOL to every agent wallet that has never been funded. */
export class TreasuryEmpty extends Error {}

export async function fundAgents(db: Db, chain: Chain, key: Buffer, now: () => Date, lamports = START_LAMPORTS) {
  const treasury = await signerFor(db, TREASURY, key);
  const all = await db.select().from(wallets).where(ne(wallets.ownerId, TREASURY));
  let funded = 0;
  for (const w of all.filter((x) => !x.fundedAt)) {
    let r;
    try { r = await chain.sendSol(treasury, w.publicKey, lamports); }
    catch (e) {
      if (e instanceof ChainError && e.code === 'INSUFFICIENT_FUNDS') throw new TreasuryEmpty(`Treasury ran out after funding ${funded} agents; top it up with devnet SOL and run this again`);
      throw e;
    }
    await recordTx(db, { signature: r.signature, agentId: w.ownerId, turnId: null, kind: 'fund', counterparty: treasury.publicKey.toBase58(), lamportsDelta: lamports, createdAt: now() });
    await db.update(wallets).set({ fundedAt: now() }).where(and(eq(wallets.ownerId, w.ownerId), isNull(wallets.fundedAt)));
    funded++;
  }
  return { funded, skipped: all.length - funded };
}
