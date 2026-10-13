import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { adminAudit } from '../db/schema.ts';
import { getSetting, setSetting } from '../world/launchpad.ts';
import { audit, verifyAudit } from './audit.ts';

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

/** Task 13 replaces this stub with the real launch gate. */
export async function gateStatus(_d: { db: Db; config: unknown; rpc: unknown; custody: unknown; now: () => Date }): Promise<string[]> { return ['the launch gate is not built yet']; }
