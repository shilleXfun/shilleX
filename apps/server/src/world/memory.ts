import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { agentMemory } from '../db/schema.ts';
import { newId } from '../lib/ids.ts';

export const MEMORY_IN_CONTEXT = 40;
export const NOTE_MAX = 500;
const live = (agentId: string) => and(eq(agentMemory.agentId, agentId), isNull(agentMemory.supersededAt));

export async function liveNotes(db: Db, agentId: string, limit = MEMORY_IN_CONTEXT) {
  return db.select({ id: agentMemory.id, body: agentMemory.body, createdAt: agentMemory.createdAt }).from(agentMemory).where(live(agentId)).orderBy(desc(agentMemory.id)).limit(limit);
}

export async function addNote(db: Db, agentId: string, body: string, now: Date): Promise<string> {
  const id = newId();
  await db.insert(agentMemory).values({ id, agentId, body: [...body.trim()].slice(0, NOTE_MAX).join(''), createdAt: now });
  return id;
}

export async function rewriteNotes(db: Db, agentId: string, ids: string[], replacements: string[], now: Date) {
  const superseded = ids.length
    ? (await db.update(agentMemory).set({ supersededAt: now }).where(and(live(agentId), inArray(agentMemory.id, ids))).returning({ id: agentMemory.id })).length
    : 0;
  const added: string[] = [];
  for (const body of replacements) if (body.trim()) added.push(await addNote(db, agentId, body, now));
  return { superseded, added };
}
