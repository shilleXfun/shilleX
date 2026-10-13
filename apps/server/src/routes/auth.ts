import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hash, verify } from '@node-rs/argon2';
import { sql, eq } from 'drizzle-orm';
import { users } from '../db/schema.ts';
import { parse } from '../lib/validate.ts';
import { AppError, errors } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { isReservedUsername } from '../lib/reserved.ts';
import { isUniqueViolation } from '../lib/pg-errors.ts';
import { SESSION_COOKIE, destroySession, hashToken } from '../lib/auth.ts';
import { Username, meView, startSession, usernameTaken } from '../services/accounts.ts';
import type { UserRow } from '../db/schema.ts';

const Signup = z.object({ username: Username, displayName: z.string().trim().min(1).max(40), password: z.string().min(8).max(128) });
const Login = z.object({ username: z.string().min(1).max(40), password: z.string().min(1).max(128) });

export default async function authRoutes(app: FastifyInstance) {
  const { db, config, now } = app.deps;

  app.post('/auth/signup', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parse(Signup, req.body);
    if (isReservedUsername(config, body.username)) throw errors.conflict('USERNAME_RESERVED', 'That username is reserved');
    if (await usernameTaken(db, body.username)) throw errors.conflict('USERNAME_TAKEN', 'That username is taken');
    const id = newId();
    const passwordHash = await hash(body.password);
    let u: UserRow | undefined;
    try {
      [u] = await db.insert(users).values({ id, username: body.username, displayName: body.displayName, passwordHash, createdAt: now() }).returning();
    } catch (e) {
      if (isUniqueViolation(e)) throw errors.conflict('USERNAME_TAKEN', 'That username is taken');
      throw e;
    }
    await startSession(app, reply, id);
    return reply.status(201).send({ user: await meView(db, u!) });
  });

  app.post('/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parse(Login, req.body);
    const [u] = await db.select().from(users).where(sql`lower(${users.username}) = ${body.username.toLowerCase()}`).limit(1);
    if (!u || !u.passwordHash || !(await verify(u.passwordHash, body.password))) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Wrong username or password');
    }
    await startSession(app, reply, u.id);
    return { user: await meView(db, u) };
  });

  app.post('/auth/demo', async (_req, reply) => {
    const [u] = await db.select().from(users).where(eq(users.username, 'demo')).limit(1);
    if (!u) throw errors.notFound('Demo account (run npm run seed)');
    await startSession(app, reply, u.id);
    return { user: await meView(db, u) };
  });

  app.post('/auth/logout', async (req, reply) => {
    const t = req.cookies[SESSION_COOKIE];
    if (t) { await destroySession(db, t); app.deps.bus.disconnectSession(hashToken(t)); }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.status(204).send();
  });

  app.get('/auth/me', async (req) => ({ user: req.user ? await meView(db, req.user) : null }));
}
