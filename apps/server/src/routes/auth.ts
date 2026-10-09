import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { hash, verify } from '@node-rs/argon2';
import { sql, eq, and, isNull } from 'drizzle-orm';
import { users, notifications } from '../db/schema.ts';
import { parse } from '../lib/validate.ts';
import { AppError, errors } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { SESSION_COOKIE, SESSION_TTL_MS, createSession, destroySession } from '../lib/auth.ts';
import { toUserSummary } from '../services/users.ts';
import type { MeView } from '@shillex/shared';
import type { UserRow } from '../db/schema.ts';

const isUniqueViolation = (e: unknown): boolean => {
  for (let x: any = e, i = 0; x && i < 4; x = x.cause, i++) if (x.code === '23505') return true;
  return false;
};

const Username = z.string().regex(/^[A-Za-z0-9_]{3,20}$/, '3–20 letters, numbers or underscores');
const Signup = z.object({ username: Username, displayName: z.string().trim().min(1).max(40), password: z.string().min(8).max(128) });
const Login = z.object({ username: z.string().min(1).max(40), password: z.string().min(1).max(128) });

export default async function authRoutes(app: FastifyInstance) {
  const { db, config, now } = app.deps;

  const setCookie = (reply: FastifyReply, token: string) =>
    reply.setCookie(SESSION_COOKIE, token, {
      path: '/', httpOnly: true, sameSite: 'lax', secure: config.nodeEnv === 'production', maxAge: SESSION_TTL_MS / 1000,
    });

  async function meView(u: UserRow): Promise<MeView> {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(notifications)
      .where(and(eq(notifications.userId, u.id), isNull(notifications.readAt)));
    return { ...toUserSummary(u), unreadNotifications: row?.n ?? 0, createdAt: u.createdAt.toISOString() };
  }

  app.post('/auth/signup', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parse(Signup, req.body);
    const taken = await db.select({ id: users.id }).from(users).where(sql`lower(${users.username}) = ${body.username.toLowerCase()}`).limit(1);
    if (taken.length) throw errors.conflict('USERNAME_TAKEN', 'That username is taken');
    const id = newId();
    const passwordHash = await hash(body.password);
    let u: UserRow | undefined;
    try {
      [u] = await db.insert(users).values({ id, username: body.username, displayName: body.displayName, passwordHash, createdAt: now() }).returning();
    } catch (e) {
      if (isUniqueViolation(e)) throw errors.conflict('USERNAME_TAKEN', 'That username is taken');
      throw e;
    }
    setCookie(reply, await createSession(db, id, now()));
    return reply.status(201).send({ user: await meView(u!) });
  });

  app.post('/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parse(Login, req.body);
    const [u] = await db.select().from(users).where(sql`lower(${users.username}) = ${body.username.toLowerCase()}`).limit(1);
    if (!u || !u.passwordHash || !(await verify(u.passwordHash, body.password))) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Wrong username or password');
    }
    setCookie(reply, await createSession(db, u.id, now()));
    return { user: await meView(u) };
  });

  app.post('/auth/demo', async (_req, reply) => {
    const [u] = await db.select().from(users).where(eq(users.username, 'demo')).limit(1);
    if (!u) throw errors.notFound('Demo account (run npm run seed)');
    setCookie(reply, await createSession(db, u.id, now()));
    return { user: await meView(u) };
  });

  app.post('/auth/logout', async (req, reply) => {
    const t = req.cookies[SESSION_COOKIE];
    if (t) await destroySession(db, t);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.status(204).send();
  });

  app.get('/auth/me', async (req) => ({ user: req.user ? await meView(req.user) : null }));
}
