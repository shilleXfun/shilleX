import { desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { nameHistory, users, type UserRow } from '../db/schema.ts';
import { newId } from '../lib/ids.ts';

/**
 * Handles that changed (CAST). A user is found by its current username first, then by any username it used before, so old
 * profile links, @mentions and agent tools keep working after a rename; an old username stays reserved for good.
 */

const lower = (h: string) => h.replace(/^@/, '').trim().toLowerCase();

/** The user whose current or former username this is (current wins), or null. */
export async function findUserByHandle(db: Db, handle: string): Promise<UserRow | null> {
  const h = lower(handle);
  if (!h) return null;
  const [now] = await db.select().from(users).where(sql`lower(${users.username}) = ${h}`).limit(1);
  if (now) return now;
  const [old] = await db.select({ u: users }).from(nameHistory).innerJoin(users, eq(users.id, nameHistory.userId))
    .where(sql`lower(${nameHistory.fromUsername}) = ${h}`).orderBy(desc(nameHistory.at)).limit(1);
  return old?.u ?? null;
}

/** Lower-case handle → user id for every handle that names someone now or named them before (current wins). */
export async function resolveHandles(db: Db, handles: readonly string[]): Promise<Map<string, string>> {
  const want = [...new Set(handles.map(lower).filter(Boolean))];
  if (!want.length) return new Map();
  const out = new Map<string, string>();
  for (const r of await db.select({ id: users.id, u: sql<string>`lower(${users.username})` }).from(users).where(inArray(sql`lower(${users.username})`, want))) out.set(r.u, r.id);
  const missing = want.filter((h) => !out.has(h));
  if (missing.length) {
    const old = await db.select({ id: nameHistory.userId, u: sql<string>`lower(${nameHistory.fromUsername})` }).from(nameHistory)
      .where(inArray(sql`lower(${nameHistory.fromUsername})`, missing)).orderBy(desc(nameHistory.at));
    for (const r of old) if (!out.has(r.u)) out.set(r.u, r.id);
  }
  return out;
}

/** True when someone used this username before; it stays theirs. `except` is the user allowed to take it back. */
export async function handleRetired(db: Db, handle: string, except?: string): Promise<boolean> {
  const rows = await db.select({ id: nameHistory.userId }).from(nameHistory).where(sql`lower(${nameHistory.fromUsername}) = ${lower(handle)}`).limit(5);
  return rows.some((r) => r.id !== except);
}

/** True when the username is in use now or was used before (by anyone but `except`). */
export async function handleUnavailable(db: Db, handle: string, except?: string): Promise<boolean> {
  const [now] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.username}) = ${lower(handle)}`).limit(1);
  if (now && now.id !== except) return true;
  return handleRetired(db, handle, except);
}

/** Writes one rename to the history. */
export async function recordRename(db: Db, r: { userId: string; from: { username: string; display: string }; to: { username: string; display: string }; at: Date; reason: string }): Promise<void> {
  if (r.from.username === r.to.username && r.from.display === r.to.display) return;
  await db.insert(nameHistory).values({ id: newId(), userId: r.userId, fromUsername: r.from.username, fromDisplay: r.from.display, toUsername: r.to.username, toDisplay: r.to.display, at: r.at, reason: r.reason });
}
