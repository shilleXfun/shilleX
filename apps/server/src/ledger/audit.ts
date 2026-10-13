import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { adminAudit } from '../db/schema.ts';
import { newId } from '../lib/ids.ts';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const link = (prev: string | null, id: string, adminId: string, action: string, payload: string, at: Date) => sha(JSON.stringify([prev, id, adminId, action, payload, at.toISOString()]));
/** Serialises appends (pg_advisory_xact_lock key): two admin actions at once must not both link to the same row. */
const AUDIT_LOCK = 7_413_201;

/**
 * Appends one admin money action (spec §7). The table refuses UPDATE, DELETE and TRUNCATE; each row hashes the one before it.
 * The tip is read and the row written under one transaction-scoped lock, and prev_hash is unique, so the chain never forks.
 */
export async function audit(db: Db, adminId: string, action: string, payload: Record<string, unknown>, now: Date): Promise<string> {
  const id = newId(), text = JSON.stringify(payload);
  await db.transaction(async (t) => {
    const tx = t as unknown as Db;
    await tx.execute(sql`select pg_advisory_xact_lock(${AUDIT_LOCK})`);
    // The tip is the one row nothing links to yet.
    const tip = (await tx.execute(sql`select a.hash from admin_audit a where not exists (select 1 from admin_audit b where b.prev_hash = a.hash) limit 1`)) as { rows: { hash: string }[] };
    const prev = tip.rows[0]?.hash ?? null;
    await tx.insert(adminAudit).values({ id, adminId, action, payload: text, prevHash: prev, hash: link(prev, id, adminId, action, text, now), createdAt: now });
  });
  return id;
}

/** True when the rows form one unbroken chain from the first, and every row hashes to what it says. */
export async function verifyAudit(db: Db): Promise<boolean> {
  const rows = await db.select().from(adminAudit);
  const next = new Map(rows.map((r) => [r.prevHash, r]));
  if (next.size !== rows.length) return false; // two rows claim the same predecessor: a fork
  let prev: string | null = null, seen = 0;
  for (let r = next.get(null); r; r = next.get(prev)) {
    if (r.hash !== link(prev, r.id, r.adminId, r.action, r.payload, r.createdAt)) return false;
    prev = r.hash; seen++;
  }
  return seen === rows.length;
}
