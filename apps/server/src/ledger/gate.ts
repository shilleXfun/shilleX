import { and, asc, eq, sql } from 'drizzle-orm';
import type { Config } from '../config.ts';
import type { Db } from '../db/client.ts';
import { adminAudit, ledgerReconciliations, ledgerWithdrawals } from '../db/schema.ts';
import { getSetting, setSetting } from '../world/launchpad.ts';
import { PRACTICE_SEASONS, currentSeason } from './accounts.ts';
import { audit, verifyAudit } from './audit.ts';
import { books } from './books.ts';
import { currentNotice } from './consent.ts';
import type { Custody } from './custody.ts';
import { assertCustodyNetwork, isAddress, type CustodyRpc } from './rpc.ts';
import { parseMainnetKey } from './vault.ts';

const DAY = 86_400_000;
export const REHEARSAL_DAYS = 14;
const CHECKS_PER_DAY = 144; // one every 10 minutes

export const LEGAL_KEY = 'legal_review';
/** What the owner types on /admin to record the review (spec §9.4). */
export const LEGAL_CONFIRMATION = 'I confirm a lawyer reviewed Shillex mainnet and I accept the risk';
export interface LegalReview { reviewer: string; date: string; note: string; confirmedBy: string }

/** Only the admin form calls this. The gate trusts the setting only when its audit row agrees (legalReviewValid). */
export async function recordLegalReview(db: Db, adminId: string, r: LegalReview, now: Date): Promise<void> {
  const auditId = await audit(db, adminId, 'legal_review', { ...r }, now);
  await setSetting(db, LEGAL_KEY, JSON.stringify({ ...r, auditId }));
}

export async function legalReview(db: Db): Promise<(LegalReview & { auditId: string }) | null> {
  const raw = await getSetting(db, LEGAL_KEY);
  return raw ? JSON.parse(raw) : null;
}

/** The review counts only with its audit row: same reviewer, date, note and admin, and an intact audit chain. */
export async function legalReviewValid(db: Db): Promise<boolean> {
  const r = await legalReview(db);
  if (!r) return false;
  const [row] = await db.select().from(adminAudit).where(eq(adminAudit.id, r.auditId));
  if (!row || row.action !== 'legal_review') return false;
  const p = JSON.parse(row.payload) as LegalReview;
  return p.reviewer === r.reviewer && p.date === r.date && p.note === r.note && p.confirmedBy === r.confirmedBy && (await verifyAudit(db));
}

/** Spec §9.5: at least 14 days of clean checks since the last failure, 90% of them present, and one withdrawal actually paid. */
export async function rehearsalStatus(db: Db, now: Date): Promise<{ ok: boolean; why: string }> {
  const rows = await db.select({ at: ledgerReconciliations.at, ok: ledgerReconciliations.ok }).from(ledgerReconciliations)
    .where(eq(ledgerReconciliations.mode, 'rehearsal')).orderBy(asc(ledgerReconciliations.at));
  if (!rows.length) return { ok: false, why: 'no rehearsal has run yet (MAINNET=rehearsal on devnet)' };
  let lastFail = -1;
  rows.forEach((r, i) => { if (r.ok === false) lastFail = i; });
  const streak = rows.slice(lastFail + 1);
  if (!streak.length) return { ok: false, why: 'the last rehearsal check failed; the 14 days start again after a clean one' };
  const days = (now.getTime() - streak[0]!.at.getTime()) / DAY;
  if (days < REHEARSAL_DAYS) return { ok: false, why: `the rehearsal has run clean for ${days.toFixed(1)} of ${REHEARSAL_DAYS} days` };
  const since = now.getTime() - REHEARSAL_DAYS * DAY, need = Math.ceil(0.9 * REHEARSAL_DAYS * CHECKS_PER_DAY);
  const passed = streak.filter((r) => r.ok === true && r.at.getTime() >= since).length;
  if (passed < need) return { ok: false, why: `only ${passed} of ${REHEARSAL_DAYS * CHECKS_PER_DAY} rehearsal checks passed in the last 14 days (${need} needed)` };
  const [w] = await db.select({ n: sql<number>`count(*)::int` }).from(ledgerWithdrawals).where(and(eq(ledgerWithdrawals.season, 'rehearsal'), eq(ledgerWithdrawals.status, 'sent')));
  if (!w?.n) return { ok: false, why: 'no withdrawal has been paid during the rehearsal' };
  return { ok: true, why: '' };
}

/**
 * Everything that still blocks MAINNET=on (spec §9); an empty list means the gate is open. With `rpc` and `custody` null it
 * checks only what needs no network: boot runs that first, so a closed gate never reaches the mainnet RPC at all.
 */
export async function gateStatus(d: { db: Db; config: Config; rpc: CustodyRpc | null; custody: Custody | null; now: () => Date }): Promise<string[]> {
  const missing: string[] = [], c = d.config;
  for (const [k, v] of Object.entries(c.mainnetLimits)) if (!Number.isFinite(v) || (k === 'houseFeeBps' ? v < 0 : v <= 0)) missing.push(`the safeguard ${k} is not set`);
  if (!isAddress(c.coldAddress)) missing.push('MAINNET_COLD_ADDRESS is not a Solana address');
  try { parseMainnetKey(c.mainnetKey); if (c.mainnetKey === c.worldKey) missing.push('MAINNET_KEY must differ from WORLD_KEY'); }
  catch { missing.push('MAINNET_KEY is not 32 bytes of base64'); }
  if (!c.mainnetRpcUrl) missing.push('MAINNET_RPC_URL is not set');
  else if (/api\.mainnet-beta\.solana\.com/.test(c.mainnetRpcUrl)) missing.push('MAINNET_RPC_URL must be a paid RPC: the public endpoint is rate-limited and unfit for custody');
  if (d.rpc) { try { await assertCustodyNetwork(d.rpc, 'mainnet'); } catch (e) { missing.unshift(`MAINNET_RPC_URL: ${(e as Error).message}`); } }
  // Real SOL never runs on a practice season's books: their balances came from devnet or paper SOL, and they may be wiped.
  const season = await currentSeason(d.db);
  if (PRACTICE_SEASONS.has(season)) missing.push(`the books are the ${season} practice season's: start Season 1 (npm run mainnet:season -- start season1) before MAINNET=on`);
  const b = await books(d.db);
  if (!b.ok) missing.push('the books do not balance');
  if (d.custody) {
    try { if ((await d.custody.reserves()) < b.ledgerTotal) missing.push('on-chain reserves are below the books'); }
    catch (e) { missing.push(`the reserves could not be read: ${(e as Error).message}`); }
  }
  if (!(await currentNotice(d.db))) missing.push('no risk notice is published');
  if (!(await legalReviewValid(d.db))) missing.push('no legal review is recorded on /admin');
  const r = await rehearsalStatus(d.db, d.now());
  if (!r.ok) missing.push(r.why);
  return missing;
}
