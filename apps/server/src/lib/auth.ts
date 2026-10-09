import { createHash, randomBytes } from 'node:crypto';
import { eq, and, gt } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { Db } from '../db/client.ts';
import { sessions, users, type UserRow } from '../db/schema.ts';
import { errors } from './errors.ts';

export const SESSION_COOKIE = 'sx_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

export async function createSession(db: Db, userId: string, now: Date): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.insert(sessions).values({ id: hashToken(token), userId, createdAt: now, expiresAt: new Date(now.getTime() + SESSION_TTL_MS) });
  return token;
}
export async function destroySession(db: Db, token: string) {
  await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
}
export async function userForToken(db: Db, token: string | undefined, now: Date): Promise<UserRow | null> {
  if (!token) return null;
  const rows = await db.select({ u: users }).from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, now))).limit(1);
  return rows[0]?.u ?? null;
}
export async function sessionValid(db: Db, sessionId: string, now: Date): Promise<boolean> {
  const rows = await db.select({ id: sessions.id }).from(sessions).where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, now))).limit(1);
  return rows.length > 0;
}
export function requireUser(req: FastifyRequest): UserRow {
  if (!req.user) throw errors.unauthorized();
  return req.user;
}
