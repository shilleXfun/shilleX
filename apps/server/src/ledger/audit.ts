import { createHash } from 'node:crypto';
import { asc, desc } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { adminAudit } from '../db/schema.ts';
import { newId } from '../lib/ids.ts';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const link = (prev: string | null, id: string, adminId: string, action: string, payload: string, at: Date) => sha(JSON.stringify([prev, id, adminId, action, payload, at.toISOString()]));

/** Appends one admin money action (spec §7). The table refuses UPDATE and DELETE; each row hashes the one before it. */
export async function audit(db: Db, adminId: string, action: string, payload: Record<string, unknown>, now: Date): Promise<string> {
  const [prev] = await db.select({ hash: adminAudit.hash }).from(adminAudit).orderBy(desc(adminAudit.createdAt), desc(adminAudit.id)).limit(1);
  const id = newId(), text = JSON.stringify(payload);
  await db.insert(adminAudit).values({ id, adminId, action, payload: text, prevHash: prev?.hash ?? null, hash: link(prev?.hash ?? null, id, adminId, action, text, now), createdAt: now });
  return id;
}

/** True when every row links to the previous one and hashes to what it says. */
export async function verifyAudit(db: Db): Promise<boolean> {
  let prev: string | null = null;
  for (const r of await db.select().from(adminAudit).orderBy(asc(adminAudit.createdAt), asc(adminAudit.id))) {
    if (r.prevHash !== prev || r.hash !== link(prev, r.id, r.adminId, r.action, r.payload, r.createdAt)) return false;
    prev = r.hash;
  }
  return true;
}
