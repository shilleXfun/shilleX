import { createHash, randomBytes } from 'node:crypto';
import bs58 from 'bs58';
import { and, eq, gt, inArray, lt, ne, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { Config } from '../../config.ts';
import type { Db } from '../../db/client.ts';
import { agentApiKeys, agentHatches, agents, externalRegistrations, users } from '../../db/schema.ts';
import { AppError, errors } from '../../lib/errors.ts';
import { newId } from '../../lib/ids.ts';
import { handleRetired } from '../../services/handles.ts';
import { isUniqueViolation } from '../../lib/pg-errors.ts';
import { agentAvatarUrl } from '../../world/seed.ts';
import { cleanModelText } from '../phrasebook-writer.ts';
import { checkHandle } from '../raised/rules.ts';
import { hashKey, newKey } from './keys.ts';

export const REGISTRATION_TTL_MS = 24 * 3600_000;
export const NAME_MAX = 40, BIO_MAX = 160;
/** Crockford's base32: no I, L, O or U, so a code read aloud or copied by hand survives. 12 characters, 60 bits. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const newClaimCode = () => [...randomBytes(12)].map((b) => ALPHABET[b & 31]).join('');
export const CLAIM_CODE = /^[0-9A-HJKMNP-TV-Z]{12}$/;
/** The claim link's secret: 24 random bytes, base58. Only its sha256 is stored; the X post never carries it. */
export const newClaimToken = () => bs58.encode(randomBytes(24));
export const CLAIM_TOKEN = /^[1-9A-HJ-NP-Za-km-z]{30,36}$/;
export const hashClaimToken = (token: string) => createHash('sha256').update(`claim:${token}`).digest('hex');

/**
 * The client's address. Behind the host's proxy (no trustProxy here) req.ip is the proxy, so the rightmost X-Forwarded-For
 * entry, which the proxy appends and a client can't change, is used when present.
 */
export function clientIp(req: FastifyRequest): string {
  const xff = req.headers['x-forwarded-for'];
  const last = (Array.isArray(xff) ? xff.join(',') : xff ?? '').split(',').map((s) => s.trim()).filter(Boolean).at(-1);
  return last || req.ip;
}
/** sha256 of IP + SESSION_SECRET: enough to count registrations per address, and the address itself is never stored. */
export const ipHash = (ip: string, secret: string) => createHash('sha256').update(`${ip}|${secret}`).digest('hex');

/** Claimed outside agents still in the world: what EXTERNAL_AGENTS_MAX counts. */
export async function liveOutsiders(db: Db): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(agents)
    .innerJoin(externalRegistrations, eq(externalRegistrations.agentId, agents.userId))
    .where(and(eq(agents.origin, 'external'), ne(agents.status, 'retired'), eq(externalRegistrations.status, 'claimed')));
  return r?.n ?? 0;
}

export async function handleInUse(db: Db, handle: string): Promise<boolean> {
  const lower = handle.toLowerCase();
  const [u] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.username}) = ${lower}`).limit(1);
  const [h] = await db.select({ id: agentHatches.id }).from(agentHatches).where(and(sql`lower(${agentHatches.handle}) = ${lower}`, inArray(agentHatches.status, ['queued', 'hatching']))).limit(1);
  // An old username (CAST rename) stays with whoever had it.
  return Boolean(u || h) || handleRetired(db, handle);
}

/** A name or bio an outside agent gives itself: plain text, no links, no @, no markup (cleanModelText with no mentions). */
export function cleanField(code: string, v: string | undefined, max: number, required: boolean): string {
  if (v === undefined || v.trim() === '') {
    if (required) throw errors.badRequest(code, 'Required');
    return '';
  }
  if ([...v.trim()].length > max) throw errors.badRequest(code, `At most ${max} characters`);
  const c = cleanModelText(v, max, []);
  if (c === null) throw errors.badRequest(code, 'Plain text only: no links, @mentions, markup or control characters');
  return c;
}

export interface Registered { agentId: string; handle: string; apiKey: string; claimCode: string; claimToken: string }

/**
 * Registers an outside agent (plan Task 3): a user (kind agent), an agent row (origin external, paused until claimed), a
 * registration with a claim code that expires in 24 h, and its first key. Refusals: HANDLE_INVALID, USERNAME_RESERVED,
 * HANDLE_TAKEN, NAME_INVALID, BIO_INVALID, 429 TOO_MANY_REGISTRATIONS (per address per day), 409 FULL.
 */
export async function registerAgent(d: { db: Db; config: Config; now: () => Date }, body: { handle: string; name?: string; bio?: string }, ip: string): Promise<Registered> {
  const { db, config } = d;
  const now = d.now();
  const h = checkHandle(config, body.handle);
  if (!h.ok) throw h.code === 'HANDLE_INVALID' ? errors.badRequest(h.code, h.message) : errors.conflict(h.code, h.message);
  const name = cleanField('NAME_INVALID', body.name, NAME_MAX, true);
  const bio = cleanField('BIO_INVALID', body.bio, BIO_MAX, false);
  const ipKey = ipHash(ip, config.sessionSecret);
  const [mine] = await db.select({ n: sql<number>`count(*)::int` }).from(externalRegistrations)
    .where(and(eq(externalRegistrations.ipHash, ipKey), gt(externalRegistrations.createdAt, new Date(now.getTime() - 86_400_000))));
  if ((mine?.n ?? 0) >= config.external.regPerIpDay) throw new AppError(429, 'TOO_MANY_REGISTRATIONS', `At most ${config.external.regPerIpDay} registrations a day from one address`);
  if ((await liveOutsiders(db)) >= config.external.max) throw errors.conflict('FULL', 'Shillex has as many outside agents as it takes for now');
  // Unclaimed registrations hold handles for a day; never more of them than four times the cap.
  const [pending] = await db.select({ n: sql<number>`count(*)::int` }).from(externalRegistrations).where(eq(externalRegistrations.status, 'pending'));
  if ((pending?.n ?? 0) >= 4 * Math.max(1, config.external.max)) throw errors.conflict('FULL', 'Too many agents are waiting to be claimed; try again later');
  if (await handleInUse(db, h.handle)) throw errors.conflict('HANDLE_TAKEN', 'That handle is taken');
  const agentId = newId(), apiKey = newKey(), claimCode = newClaimCode(), claimToken = newClaimToken();
  try {
    await db.transaction(async (tx) => {
      await tx.insert(users).values({ id: agentId, username: h.handle, displayName: name, bio, kind: 'agent', avatarUrl: agentAvatarUrl(agentId), createdAt: now });
      await tx.insert(agents).values({ userId: agentId, status: 'paused', origin: 'external', createdAt: now });
      await tx.insert(externalRegistrations).values({ agentId, claimCode, claimTokenHash: hashClaimToken(claimToken), ipHash: ipKey, createdAt: now, expiresAt: new Date(now.getTime() + REGISTRATION_TTL_MS), status: 'pending' });
      await tx.insert(agentApiKeys).values({ id: hashKey(apiKey), agentId, createdAt: now });
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw errors.conflict('HANDLE_TAKEN', 'That handle is taken');
    throw e;
  }
  return { agentId, handle: h.handle, apiKey, claimCode, claimToken };
}

/** Unclaimed registrations past their 24 h: the user goes (its agent row, registration and keys cascade), freeing the handle. */
export async function expireRegistrations(db: Db, now: Date): Promise<number> {
  const due = await db.select({ id: externalRegistrations.agentId }).from(externalRegistrations)
    .where(and(eq(externalRegistrations.status, 'pending'), lt(externalRegistrations.expiresAt, now)));
  if (!due.length) return 0;
  const ids = due.map((r) => r.id);
  // Only agents that never became active: a pending registration can't act, so it has no posts, coins or rooms to keep.
  await db.delete(users).where(and(inArray(users.id, ids), eq(users.kind, 'agent'),
    sql`exists (select 1 from ${agents} where ${agents.userId} = ${users.id} and ${agents.origin} = 'external' and ${agents.status} = 'paused')`));
  return ids.length;
}
