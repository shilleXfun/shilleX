import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { ledgerAccounts, ledgerHoldings, ledgerJournal, ledgerPools, wallets, type JournalKind } from '../db/schema.ts';
import { newId } from '../lib/ids.ts';
import { ChainError } from '../world/chain.ts';
import { getSetting } from '../world/launchpad.ts';

export type { JournalKind };
export const HOUSE = 'house';
/** The world outside the books: deposits come from it and withdrawals go to it. Its journal sum is minus everything inside. */
export const EXTERNAL = 'external';
/** SOL paid out to an owner or the cold address but not sent on-chain yet. */
export const WITHDRAWALS = 'withdrawals';
const POOL = 'pool:';
export const poolAccount = (mint: string) => `${POOL}${mint}`;
export const SEASON_KEY = 'mainnet_season';
export const FROZEN_KEY = 'mainnet_frozen';

export interface Entry { kind: JournalKind; ref: string; season: string; at: Date; mint?: string | null }

/** The current season ('dev' until a season starts, Task 14). Journal rows carry it, and the books read only it. */
export async function currentSeason(db: Db): Promise<string> { return (await getSetting(db, SEASON_KEY)) || 'dev'; }

/** An agent wallet's owner. Only agent wallets (and the internal accounts) hold SOL on the ledger. */
export async function ownerOfKey(db: Db, publicKey: string): Promise<string> {
  const [w] = await db.select({ ownerId: wallets.ownerId }).from(wallets).where(eq(wallets.publicKey, publicKey));
  if (!w) throw new ChainError('UNKNOWN_ACCOUNT', 'Only agent wallets hold SOL on the ledger');
  return w.ownerId;
}

export async function lamportsOf(db: Db, account: string): Promise<number> {
  if (account.startsWith(POOL)) {
    const [p] = await db.select({ s: ledgerPools.sol }).from(ledgerPools).where(eq(ledgerPools.mint, account.slice(POOL.length)));
    return p?.s ?? 0;
  }
  const [a] = await db.select({ l: ledgerAccounts.lamports }).from(ledgerAccounts).where(eq(ledgerAccounts.publicKey, account));
  return a?.l ?? 0;
}

/** Creates the account row at 0 if it is missing (internal accounts own themselves). */
async function ensure(tx: Db, account: string) {
  if (account === EXTERNAL || account.startsWith(POOL)) return;
  const ownerId = account === HOUSE || account === WITHDRAWALS ? account : await ownerOfKey(tx, account);
  await tx.insert(ledgerAccounts).values({ publicKey: account, ownerId, lamports: 0 }).onConflictDoNothing();
}

/** Row-locks an account (or a pool) for the rest of the transaction and returns its SOL. */
async function lock(tx: Db, account: string): Promise<number> {
  if (account === EXTERNAL) return Number.POSITIVE_INFINITY;
  if (account.startsWith(POOL)) {
    const [p] = await tx.select({ s: ledgerPools.sol }).from(ledgerPools).where(eq(ledgerPools.mint, account.slice(POOL.length))).for('update');
    if (!p) throw new ChainError('UNKNOWN_MINT', `No bonding-curve pool for ${account.slice(POOL.length)}`);
    return p.s;
  }
  const [a] = await tx.select({ l: ledgerAccounts.lamports }).from(ledgerAccounts).where(eq(ledgerAccounts.publicKey, account)).for('update');
  return a?.l ?? 0;
}

/** Throws INSUFFICIENT_FUNDS unless `account` holds at least `lamports` (and locks it). */
export async function need(tx: Db, account: string, lamports: number) {
  const have = await lock(tx, account);
  if (have < lamports) throw new ChainError('INSUFFICIENT_FUNDS', `Not enough SOL: the account has ${have / 1e9} SOL and this needs ${lamports / 1e9} SOL`);
}

async function adjust(tx: Db, account: string, delta: number) {
  if (account === EXTERNAL) return;
  if (account.startsWith(POOL)) {
    await tx.update(ledgerPools).set({ sol: sql`${ledgerPools.sol} + ${delta}` }).where(eq(ledgerPools.mint, account.slice(POOL.length)));
    return;
  }
  await tx.update(ledgerAccounts).set({ lamports: sql`${ledgerAccounts.lamports} + ${delta}` }).where(eq(ledgerAccounts.publicKey, account));
}

/**
 * Moves SOL inside an open transaction: locks both sides in a stable order (two moves in opposite directions can't deadlock),
 * checks the payer, updates both balances and writes the journal pair. A zero amount or a move to oneself writes nothing.
 */
export async function move(tx: Db, m: Entry & { from: string; to: string; lamports: number }) {
  if (m.lamports === 0 || m.from === m.to) return;
  if (!Number.isSafeInteger(m.lamports) || m.lamports < 0) throw new ChainError('BAD_AMOUNT', 'Amounts are whole, positive lamports');
  await ensure(tx, m.from); await ensure(tx, m.to);
  for (const a of [m.from, m.to].sort()) await lock(tx, a);
  await need(tx, m.from, m.lamports);
  await adjust(tx, m.from, -m.lamports); await adjust(tx, m.to, m.lamports);
  await tx.insert(ledgerJournal).values([
    { id: newId(), season: m.season, kind: m.kind, account: m.from, counter: m.to, mint: m.mint ?? null, lamportsDelta: -m.lamports, tokenDelta: 0, ref: m.ref, createdAt: m.at },
    { id: newId(), season: m.season, kind: m.kind, account: m.to, counter: m.from, mint: m.mint ?? null, lamportsDelta: m.lamports, tokenDelta: 0, ref: m.ref, createdAt: m.at },
  ]);
}

/** Moves tokens between a holder and its pool (a pool's tokens are its `sold` counter, negated) and writes the journal pair. */
export async function moveTokens(tx: Db, m: Entry & { from: string; to: string; mint: string; raw: number }) {
  if (m.raw === 0 || m.from === m.to) return;
  if (!Number.isSafeInteger(m.raw) || m.raw < 0) throw new ChainError('BAD_AMOUNT', 'Token amounts are whole, positive base units');
  if (m.from.startsWith(POOL)) await tx.update(ledgerPools).set({ sold: sql`${ledgerPools.sold} + ${m.raw}` }).where(eq(ledgerPools.mint, m.mint));
  else {
    const [h] = await tx.select({ raw: ledgerHoldings.raw }).from(ledgerHoldings).where(and(eq(ledgerHoldings.account, m.from), eq(ledgerHoldings.mint, m.mint))).for('update');
    if ((h?.raw ?? 0) < m.raw) throw new ChainError('INSUFFICIENT_TOKENS', `Holds ${h?.raw ?? 0} raw units, tried to move ${m.raw}`);
    await tx.update(ledgerHoldings).set({ raw: sql`${ledgerHoldings.raw} - ${m.raw}` }).where(and(eq(ledgerHoldings.account, m.from), eq(ledgerHoldings.mint, m.mint)));
  }
  if (m.to.startsWith(POOL)) await tx.update(ledgerPools).set({ sold: sql`${ledgerPools.sold} - ${m.raw}` }).where(eq(ledgerPools.mint, m.mint));
  else await tx.insert(ledgerHoldings).values({ account: m.to, mint: m.mint, raw: m.raw })
    .onConflictDoUpdate({ target: [ledgerHoldings.account, ledgerHoldings.mint], set: { raw: sql`${ledgerHoldings.raw} + ${m.raw}` } });
  await tx.insert(ledgerJournal).values([
    { id: newId(), season: m.season, kind: m.kind, account: m.from, counter: m.to, mint: m.mint, lamportsDelta: 0, tokenDelta: -m.raw, ref: m.ref, createdAt: m.at },
    { id: newId(), season: m.season, kind: m.kind, account: m.to, counter: m.from, mint: m.mint, lamportsDelta: 0, tokenDelta: m.raw, ref: m.ref, createdAt: m.at },
  ]);
}
