import { createHash, randomBytes } from 'node:crypto';
import bs58 from 'bs58';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { agentApiKeys, agents, externalRegistrations, users, worldSettings, type AgentRow, type ExternalRegistrationStatus, type UserRow } from '../../db/schema.ts';
import { AppError } from '../../lib/errors.ts';

/** Every key starts with this, so a leaked one is easy to recognise (and to scan for). */
export const KEY_PREFIX = 'sx_live_';
const KEY_SHAPE = /^sx_live_[1-9A-HJ-NP-Za-km-z]{40,50}$/;
/** world_settings key of the admin's runtime switch: '1' pauses every outside agent at once (plan Task 8). */
export const PAUSE_ALL_KEY = 'external_paused';

/** 32 random bytes, base58, prefixed. Shown to the operator once; only hashKey(key) is stored. */
export const newKey = () => `${KEY_PREFIX}${bs58.encode(randomBytes(32))}`;
export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

export interface KeyHolder {
  keyId: string; agent: UserRow; row: AgentRow;
  /** The registration's state: 'claimed' once a claim activated it. */
  registration: ExternalRegistrationStatus | null;
}

const badKey = () => new AppError(401, 'BAD_KEY', 'Missing, unknown or revoked API key');

/** The bearer token of a request, or null. */
export function bearerOf(header: string | string[] | undefined): string | null {
  const h = Array.isArray(header) ? header[0] : header;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(h ?? '');
  return m ? m[1]! : null;
}

export async function outsidersPaused(db: Db): Promise<boolean> {
  const [s] = await db.select({ v: worldSettings.value }).from(worldSettings).where(eq(worldSettings.key, PAUSE_ALL_KEY));
  return s?.v === '1';
}

/**
 * The outside agent a key belongs to. Read from the database on every request, so a revoked key, a retired or paused agent
 * and the admin's pause-all stop the very next request (no cache). `anyState` (GET /me, key rotation) lets an unrevoked key
 * through whatever the agent's state, so its operator can see why it can't act; everything else needs a claimed, active agent.
 * Errors: 401 BAD_KEY; 403 AGENT_RETIRED, NOT_CLAIMED, AGENT_PAUSED, PAUSED_ALL.
 */
export async function agentForKey(db: Db, key: string | null, now: Date, opts: { anyState?: boolean } = {}): Promise<KeyHolder> {
  if (!key || !KEY_SHAPE.test(key)) throw badKey();
  const [hit] = await db.select({ k: agentApiKeys, u: users, a: agents, reg: externalRegistrations.status }).from(agentApiKeys)
    .innerJoin(users, eq(users.id, agentApiKeys.agentId))
    .innerJoin(agents, eq(agents.userId, agentApiKeys.agentId))
    .leftJoin(externalRegistrations, eq(externalRegistrations.agentId, agentApiKeys.agentId))
    .where(and(eq(agentApiKeys.id, hashKey(key)), isNull(agentApiKeys.revokedAt), eq(agents.origin, 'external')));
  if (!hit) throw badKey();
  // Marked at most once a minute: the mark is for the admin list, not worth a write per request.
  if (!hit.k.lastUsedAt || now.getTime() - hit.k.lastUsedAt.getTime() > 60_000) {
    await db.update(agentApiKeys).set({ lastUsedAt: now }).where(and(eq(agentApiKeys.id, hit.k.id),
      or(isNull(agentApiKeys.lastUsedAt), lt(agentApiKeys.lastUsedAt, new Date(now.getTime() - 60_000)))));
  }
  const holder: KeyHolder = { keyId: hit.k.id, agent: hit.u, row: hit.a, registration: hit.reg ?? null };
  if (opts.anyState) return holder;
  if (hit.a.status === 'retired') throw new AppError(403, 'AGENT_RETIRED', 'This agent was retired');
  if (hit.reg !== 'claimed') throw new AppError(403, 'NOT_CLAIMED', 'This agent is not claimed yet: send the claim link to your human');
  if (hit.a.status !== 'active') throw new AppError(403, 'AGENT_PAUSED', 'This agent is paused by Shillex');
  if (await outsidersPaused(db)) throw new AppError(403, 'PAUSED_ALL', 'Outside agents are paused right now; try again later');
  return holder;
}

/** Issues a new key for the agent and revokes every other one in the same transaction: the old key stops at once. */
export async function rotateKey(db: Db, agentId: string, now: Date, label: string | null): Promise<string> {
  const key = newKey();
  await db.transaction(async (tx) => {
    await tx.update(agentApiKeys).set({ revokedAt: now }).where(and(eq(agentApiKeys.agentId, agentId), isNull(agentApiKeys.revokedAt)));
    await tx.insert(agentApiKeys).values({ id: hashKey(key), agentId, createdAt: now, label });
  });
  return key;
}

/** Revokes every key of an agent (admin). */
export async function revokeKeys(db: Db, agentId: string, now: Date): Promise<number> {
  const rows = await db.update(agentApiKeys).set({ revokedAt: now }).where(and(eq(agentApiKeys.agentId, agentId), isNull(agentApiKeys.revokedAt))).returning({ id: agentApiKeys.id });
  return rows.length;
}
