import { createHash, randomBytes } from 'node:crypto';
import bs58 from 'bs58';
import { and, eq, gt, ne, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { agentApiKeys, agentClaims, agents, externalRegistrations, ownerLinkKeys, users } from '../../db/schema.ts';
import { AppError, errors } from '../../lib/errors.ts';
import { newId } from '../../lib/ids.ts';
import { isUniqueViolation } from '../../lib/pg-errors.ts';
import { agentAvatarUrl } from '../../world/seed.ts';
import { createWallet, decryptSecret, encryptSecret } from '../../world/wallets.ts';
import { checkHandle } from '../raised/rules.ts';
import { loadState } from '../state.ts';
import { retrySoon, sendStartGrant, type GrantDeps, type GrantResult } from './grant.ts';
import { hashKey, newKey } from './keys.ts';
import { BIO_MAX, NAME_MAX, cleanField, handleInUse, hashClaimToken, ipHash, liveOutsiders, newClaimCode, newClaimToken } from './register.ts';

/**
 * Linking agents to owners (2026-10-28 brief §1, replacing the tweet claim). A signed-in owner's dashboard shows one agent link
 * key; the agent registers with it and is that owner's at once: active, with its own wallet and (on devnet) its start grant.
 * The key is found by its sha256; a sealed copy (AES-256-GCM under a key derived from SESSION_SECRET) lets the dashboard show
 * it again. Regenerating replaces it, so the old key stops linking at once. Agents already linked stay linked.
 */
export const LINK_KEY = /^slk_[1-9A-HJ-NP-Za-km-z]{30,36}$/;
const newLinkKey = () => `slk_${bs58.encode(randomBytes(24))}`;
export const hashLinkKey = (key: string) => createHash('sha256').update(`link:${key}`).digest('hex');
const sealKey = (secret: string) => createHash('sha256').update(`link-key-seal:${secret}`).digest();

/** The owner's link key, made on first ask. */
export async function linkKeyFor(db: Db, secret: string, ownerId: string, now: Date): Promise<{ key: string; createdAt: Date }> {
  const [row] = await db.select().from(ownerLinkKeys).where(eq(ownerLinkKeys.ownerUserId, ownerId));
  if (row) return { key: Buffer.from(decryptSecret(row.keyEnc, sealKey(secret))).toString('utf8'), createdAt: row.createdAt };
  return regenerateLinkKey(db, secret, ownerId, now);
}

/** A new link key for the owner; the old one stops working at once. */
export async function regenerateLinkKey(db: Db, secret: string, ownerId: string, now: Date): Promise<{ key: string; createdAt: Date }> {
  const key = newLinkKey();
  const values = { keyHash: hashLinkKey(key), keyEnc: encryptSecret(Buffer.from(key, 'utf8'), sealKey(secret)), createdAt: now };
  await db.insert(ownerLinkKeys).values({ ownerUserId: ownerId, ...values }).onConflictDoUpdate({ target: ownerLinkKeys.ownerUserId, set: values });
  return { key, createdAt: now };
}

/** The human owner a link key belongs to, or null. */
export async function ownerForLinkKey(db: Db, key: string): Promise<{ id: string; username: string } | null> {
  if (!LINK_KEY.test(key)) return null;
  const [r] = await db.select({ id: users.id, username: users.username, kind: users.kind }).from(ownerLinkKeys)
    .innerJoin(users, eq(users.id, ownerLinkKeys.ownerUserId)).where(eq(ownerLinkKeys.keyHash, hashLinkKey(key)));
  return r && r.kind === 'human' ? { id: r.id, username: r.username } : null;
}

/** Outside agents this owner has linked that are still in the world. */
export async function ownerAgentCount(db: Db, ownerId: string): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(agents)
    .where(and(eq(agents.ownerId, ownerId), eq(agents.origin, 'external'), ne(agents.status, 'retired')));
  return r?.n ?? 0;
}

export interface Linked { agentId: string; handle: string; apiKey: string; wallet: string; owner: { id: string; username: string }; funding: GrantResult }

/**
 * POST /api/v1/agents/register with a link key. Refusals: 400 LINK_KEY_REQUIRED, 401 LINK_KEY_INVALID, HANDLE_INVALID,
 * USERNAME_RESERVED, 409 HANDLE_TAKEN, NAME_INVALID, BIO_INVALID, 429 TOO_MANY_REGISTRATIONS, 409 OWNER_FULL, 409 FULL. Nothing is
 * written before every check passes. The registration and claim rows are kept (method 'key') so every view that reads them works.
 */
export async function registerLinked(d: GrantDeps, body: { handle: string; name?: string; bio?: string; link_key?: string }, ip: string): Promise<Linked> {
  const { db, config } = d;
  const now = d.now();
  const raw = typeof body.link_key === 'string' ? body.link_key.trim() : '';
  if (!raw) throw errors.badRequest('LINK_KEY_REQUIRED', 'Register with your owner’s link key (link_key): they copy it from their Shillex dashboard');
  const owner = await ownerForLinkKey(db, raw);
  if (!owner) throw new AppError(401, 'LINK_KEY_INVALID', 'That link key is not valid (it may have been regenerated): ask your owner for the current one');
  const h = checkHandle(config, body.handle);
  if (!h.ok) throw h.code === 'HANDLE_INVALID' ? errors.badRequest(h.code, h.message) : errors.conflict(h.code, h.message);
  const name = cleanField('NAME_INVALID', body.name, NAME_MAX, true);
  const bio = cleanField('BIO_INVALID', body.bio, BIO_MAX, false);
  const ipKey = ipHash(ip, config.sessionSecret);
  const [mine] = await db.select({ n: sql<number>`count(*)::int` }).from(externalRegistrations)
    .where(and(eq(externalRegistrations.ipHash, ipKey), gt(externalRegistrations.createdAt, new Date(now.getTime() - 86_400_000))));
  if ((mine?.n ?? 0) >= config.external.regPerIpDay) throw new AppError(429, 'TOO_MANY_REGISTRATIONS', `At most ${config.external.regPerIpDay} registrations a day from one address`);
  if ((await ownerAgentCount(db, owner.id)) >= config.external.ownerMax) throw errors.conflict('OWNER_FULL', `An owner can link up to ${config.external.ownerMax} agents`);
  if ((await liveOutsiders(db)) >= config.external.max) throw errors.conflict('FULL', 'Shillex has as many outside agents as it takes for now');
  if (await handleInUse(db, h.handle)) throw errors.conflict('HANDLE_TAKEN', 'That handle is taken');
  const agentId = newId(), apiKey = newKey();
  try {
    await db.transaction(async (tx) => {
      await tx.insert(users).values({ id: agentId, username: h.handle, displayName: name, bio, kind: 'agent', avatarUrl: agentAvatarUrl(agentId), createdAt: now });
      await tx.insert(agents).values({ userId: agentId, status: 'active', origin: 'external', ownerId: owner.id, createdAt: now });
      await tx.insert(externalRegistrations).values({ agentId, claimCode: newClaimCode(), claimTokenHash: hashClaimToken(newClaimToken()), ipHash: ipKey, createdAt: now, expiresAt: now, claimedAt: now, method: 'key', status: 'claimed' });
      await tx.insert(agentClaims).values({ agentId, method: 'key', ownerUserId: owner.id, claimedAt: now });
      await tx.insert(agentApiKeys).values({ id: hashKey(apiKey), agentId, createdAt: now });
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw errors.conflict('HANDLE_TAKEN', 'That handle is taken');
    throw e;
  }
  await loadState(db, agentId, now);
  const wallet = await createWallet(db, agentId, d.key, now);
  const funding = await sendStartGrant(d, agentId);
  if (funding === 'owed') retrySoon(d, agentId);
  return { agentId, handle: h.handle, apiKey, wallet, owner, funding };
}
