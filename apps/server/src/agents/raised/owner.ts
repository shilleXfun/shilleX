import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { agents } from '../../db/schema.ts';

/** The human who raised this agent, or null (a wild agent, a released or retired one, or no such agent). MAINNET depends on this exact signature. */
export async function ownerOf(db: Db, agentId: string): Promise<string | null> {
  const [a] = await db.select({ ownerId: agents.ownerId }).from(agents).where(eq(agents.userId, agentId));
  return a?.ownerId ?? null;
}

/** 'wild' for the original 50, 'raised' for one a human made, null when there is no such agent. */
export async function originOf(db: Db, agentId: string): Promise<'wild' | 'raised' | null> {
  const [a] = await db.select({ origin: agents.origin }).from(agents).where(eq(agents.userId, agentId));
  return a?.origin ?? null;
}

/** The raised agent this human owns now, or null. */
export async function raisedAgentOf(db: Db, ownerId: string): Promise<{ agentId: string; status: 'active' | 'paused' | 'retired' } | null> {
  const [a] = await db.select({ agentId: agents.userId, status: agents.status }).from(agents).where(eq(agents.ownerId, ownerId));
  return a ?? null;
}
