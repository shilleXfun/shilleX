import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { AUTH_LIMITS, type MeView } from '@shillex/shared';
import type { Db } from '../db/client.ts';
import { notifications, sessions, users, type UserRow } from '../db/schema.ts';
import { SESSION_COOKIE, SESSION_TTL_MS, createSession, hashToken } from '../lib/auth.ts';
import { errors } from '../lib/errors.ts';
import { toUserSummary } from './users.ts';

export const Username = z.string().regex(/^[A-Za-z0-9_]{3,20}$/, '3–20 letters, numbers or underscores');
/** An unverified sign-in email: trimmed, lowercased, at most 254 characters, shaped like an address. */
export const Email = z.string().trim().toLowerCase().max(AUTH_LIMITS.emailMax).pipe(z.email());
export const emailTaken = () => errors.conflict('EMAIL_TAKEN', 'That email is already used on Shillex');

export async function meView(db: Db, u: UserRow): Promise<MeView> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(notifications)
    .where(and(eq(notifications.userId, u.id), isNull(notifications.readAt)));
  return { ...toUserSummary(u), unreadNotifications: row?.n ?? 0, createdAt: u.createdAt.toISOString(), mutedWords: u.mutedWords };
}

/** Creates a session for `userId` and sets the `sx_session` cookie (30 days, httpOnly, lax, secure in production). */
export async function startSession(app: FastifyInstance, reply: FastifyReply, userId: string): Promise<void> {
  const { db, config, now } = app.deps;
  reply.setCookie(SESSION_COOKIE, await createSession(db, userId, now()), {
    path: '/', httpOnly: true, sameSite: 'lax', secure: config.nodeEnv === 'production', maxAge: SESSION_TTL_MS / 1000,
  });
}

/** Deletes every session of `userId` except the one this request uses (all of them when signed out), and drops their sockets. */
export async function endOtherSessions(app: FastifyInstance, req: FastifyRequest, userId: string): Promise<void> {
  const token = req.cookies[SESSION_COOKIE];
  const keep = token ? hashToken(token) : null;
  const ids = (await app.deps.db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, userId)))
    .map((r) => r.id).filter((id) => id !== keep);
  if (!ids.length) return;
  await app.deps.db.delete(sessions).where(inArray(sessions.id, ids));
  for (const id of ids) app.deps.bus.disconnectSession(id);
}

export async function usernameTaken(db: Db, name: string): Promise<boolean> {
  return (await db.select({ id: users.id }).from(users).where(sql`lower(${users.username}) = ${name.toLowerCase()}`).limit(1)).length > 0;
}
/** The id of the account using this email (any case), if one does. */
export async function emailOwner(db: Db, email: string): Promise<string | null> {
  const [r] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email.toLowerCase()}`).limit(1);
  return r?.id ?? null;
}
