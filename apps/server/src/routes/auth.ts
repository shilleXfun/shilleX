import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hash } from '@node-rs/argon2';
import { sql, eq } from 'drizzle-orm';
import { AUTH_LIMITS } from '@shillex/shared';
import { users } from '../db/schema.ts';
import { parse } from '../lib/validate.ts';
import { AppError, errors } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { isReservedUsername } from '../lib/reserved.ts';
import { isUniqueViolation } from '../lib/pg-errors.ts';
import { SESSION_COOKIE, destroySession, hashToken } from '../lib/auth.ts';
import { Email, Username, emailOwner, emailTaken, meView, startSession, usernameTaken } from '../services/accounts.ts';
import { dummyVerify, passwordMatches } from '../services/passwords.ts';
import type { UserRow } from '../db/schema.ts';
import { startXSignIn, verifyXSignIn } from '../services/x-signin.ts';

const Signup = z.object({ username: Username, displayName: z.string().trim().min(1).max(40), password: z.string().min(8).max(128), email: Email.optional() });
/** `username` is a username or, when it contains @, an email. */
const Login = z.object({ username: z.string().trim().min(1).max(AUTH_LIMITS.emailMax), password: z.string().min(1).max(128) });
const wrong = () => new AppError(401, 'INVALID_CREDENTIALS', 'Wrong username, email or password');

export default async function authRoutes(app: FastifyInstance) {
  const { db, config, now } = app.deps;

  app.post('/auth/signup', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parse(Signup, req.body);
    if (isReservedUsername(config, body.username)) throw errors.conflict('USERNAME_RESERVED', 'That username is reserved');
    if (await usernameTaken(db, body.username)) throw errors.conflict('USERNAME_TAKEN', 'That username is taken');
    // Unverified by the owner's choice: without a check, saying the address is taken can't be avoided (rate-limited above).
    if (body.email && (await emailOwner(db, body.email))) throw emailTaken();
    const id = newId();
    const passwordHash = await hash(body.password);
    let u: UserRow | undefined;
    try {
      [u] = await db.insert(users).values({ id, username: body.username, displayName: body.displayName, passwordHash, email: body.email ?? null, createdAt: now() }).returning();
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      if (body.email && (await emailOwner(db, body.email))) throw emailTaken();
      throw errors.conflict('USERNAME_TAKEN', 'That username is taken');
    }
    await startSession(app, reply, id);
    return reply.status(201).send({ user: await meView(db, u!) });
  });

  app.post('/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parse(Login, req.body);
    const id = body.username.toLowerCase();
    const [u] = await db.select().from(users)
      .where(id.includes('@') ? sql`lower(${users.email}) = ${id}` : sql`lower(${users.username}) = ${id}`).limit(1);
    if (!u) { await dummyVerify(body.password); throw wrong(); }
    // Check the password first, so an agent or a wallet-only account takes as long as any other miss.
    if (!(await passwordMatches(u, body.password)) || u.kind !== 'human') throw wrong();
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

  // ── Sign in with X by posting (2026-10-28): type the handle, post the code from it, paste the post's link. No "Authorize". ──
  app.get('/auth/methods', async () => ({ x: true, wallet: true }));
  app.post('/auth/x/start', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const body = parse(z.object({ handle: z.string().max(40), token: z.string().max(80).optional() }), req.body);
    return startXSignIn({ db, config, now }, body);
  });
  app.post('/auth/x/verify', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parse(z.object({ token: z.string().max(80), postUrl: z.string().max(400) }), req.body);
    const r = await verifyXSignIn({ db, config, now }, body);
    await startSession(app, reply, r.userId);
    const [u] = await db.select().from(users).where(eq(users.id, r.userId));
    return { user: await meView(db, u!) };
  });
}
