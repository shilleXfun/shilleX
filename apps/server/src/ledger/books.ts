import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { ledgerAccounts, ledgerHoldings, ledgerJournal, ledgerPools } from '../db/schema.ts';
import { EXTERNAL, currentSeason, poolAccount } from './accounts.ts';

export interface Books { season: string; accountsTotal: number; poolsTotal: number; ledgerTotal: number; externalNet: number; mismatches: string[]; ok: boolean }

/**
 * The books for the current season. Every balance must equal its journal sum, and everything inside the ledger must equal
 * minus the outside world's journal sum (deposits + house stake − sent withdrawals). This is the invariant of spec §2.
 */
export async function books(db: Db): Promise<Books> {
  const season = await currentSeason(db);
  const [accounts, pools, holdings, sums, tokenSums] = await Promise.all([
    db.select().from(ledgerAccounts),
    db.select().from(ledgerPools),
    db.select().from(ledgerHoldings),
    db.select({ account: ledgerJournal.account, n: sql<number>`coalesce(sum(${ledgerJournal.lamportsDelta}), 0)::float8` })
      .from(ledgerJournal).where(eq(ledgerJournal.season, season)).groupBy(ledgerJournal.account),
    db.select({ account: ledgerJournal.account, mint: ledgerJournal.mint, n: sql<number>`coalesce(sum(${ledgerJournal.tokenDelta}), 0)::float8` })
      .from(ledgerJournal).where(and(eq(ledgerJournal.season, season), sql`${ledgerJournal.tokenDelta} <> 0`)).groupBy(ledgerJournal.account, ledgerJournal.mint),
  ]);
  const sol = new Map(sums.map((r) => [r.account, r.n]));
  const tok = new Map(tokenSums.map((r) => [`${r.account}|${r.mint}`, r.n]));
  const mismatches: string[] = [];
  for (const a of accounts) {
    if (a.lamports < 0) mismatches.push(`${a.publicKey} is negative (${a.lamports})`);
    if ((sol.get(a.publicKey) ?? 0) !== a.lamports) mismatches.push(`${a.publicKey}: balance ${a.lamports}, journal ${sol.get(a.publicKey) ?? 0}`);
  }
  for (const p of pools) {
    const acct = poolAccount(p.mint);
    if ((sol.get(acct) ?? 0) !== p.sol) mismatches.push(`${acct}: reserve ${p.sol}, journal ${sol.get(acct) ?? 0}`);
    if (-(tok.get(`${acct}|${p.mint}`) ?? 0) !== p.sold) mismatches.push(`${acct}: sold ${p.sold}, journal ${-(tok.get(`${acct}|${p.mint}`) ?? 0)}`);
  }
  for (const h of holdings) if ((tok.get(`${h.account}|${h.mint}`) ?? 0) !== h.raw) mismatches.push(`${h.account} ${h.mint}: holds ${h.raw}, journal ${tok.get(`${h.account}|${h.mint}`) ?? 0}`);
  const accountsTotal = accounts.reduce((n, a) => n + a.lamports, 0), poolsTotal = pools.reduce((n, p) => n + p.sol, 0);
  const ledgerTotal = accountsTotal + poolsTotal, externalNet = sol.get(EXTERNAL) ?? 0;
  if (ledgerTotal + externalNet !== 0) mismatches.push(`inside ${ledgerTotal} ≠ outside ${-externalNet}`);
  return { season, accountsTotal, poolsTotal, ledgerTotal, externalNet, mismatches, ok: mismatches.length === 0 };
}
