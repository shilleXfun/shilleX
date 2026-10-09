import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import type { UserRow } from './db/schema.ts';
import type { AppDeps } from './deps.ts';
import { registerErrorHandler, errors } from './lib/errors.ts';
import { SESSION_COOKIE, userForToken } from './lib/auth.ts';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { mkdirSync } from 'node:fs';
import authRoutes from './routes/auth.ts';
import uploadsRoutes from './routes/uploads.ts';
import mediaRoutes from './routes/media.ts';
import postsRoutes from './routes/posts.ts';
import feedRoutes from './routes/feed.ts';
import usersRoutes from './routes/users.ts';
import meRoutes from './routes/me.ts';
import notificationsRoutes from './routes/notifications.ts';
import callsRoutes from './routes/calls.ts';
import communitiesRoutes from './routes/communities.ts';
import channelsRoutes from './routes/channels.ts';
import conversationsRoutes from './routes/conversations.ts';
import messagesRoutes from './routes/messages.ts';
import pinsRoutes from './routes/pins.ts';
import reportsRoutes from './routes/reports.ts';
import searchRoutes from './routes/search.ts';
import { createGuards, type MessageGuards } from './services/moderation.ts';

declare module 'fastify' {
  interface FastifyInstance { deps: AppDeps; guards: MessageGuards }
  interface FastifyRequest { user: UserRow | null }
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.config.nodeEnv === 'development' ? { level: 'info' } : false, bodyLimit: 1_000_000 });
  app.decorate('deps', deps);
  app.decorate('guards', createGuards());
  app.decorateRequest('user', null);
  await app.register(cookie, { secret: deps.config.sessionSecret });
  await app.register(rateLimit, { global: false });
  registerErrorHandler(app);
  await app.register(multipart);
  mkdirSync(deps.config.uploadsDir, { recursive: true });
  await app.register(fastifyStatic, { root: deps.config.uploadsDir, prefix: '/uploads/', decorateReply: false, immutable: true, maxAge: '365d',
    setHeaders: (res) => {
      res.header('x-content-type-options', 'nosniff');
      res.header('content-security-policy', "default-src 'none'; sandbox");
    } });

  app.addHook('onRequest', async (req) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.url.startsWith('/api')) {
      const origin = req.headers.origin;
      if (origin && !deps.config.allowedOrigins.includes(origin)) throw errors.forbidden('BAD_ORIGIN', 'Cross-origin request blocked');
    }
    if (req.url.startsWith('/api')) req.user = await userForToken(deps.db, req.cookies[SESSION_COOKIE], deps.now());
  });

  await app.register(authRoutes, { prefix: '/api' });
  await app.register(uploadsRoutes, { prefix: '/api' });
  await app.register(mediaRoutes);
  await app.register(postsRoutes, { prefix: '/api' });
  await app.register(feedRoutes, { prefix: '/api' });
  await app.register(usersRoutes, { prefix: '/api' });
  await app.register(meRoutes, { prefix: '/api' });
  await app.register(notificationsRoutes, { prefix: '/api' });
  await app.register(callsRoutes, { prefix: '/api' });
  await app.register(communitiesRoutes, { prefix: '/api' });
  await app.register(channelsRoutes, { prefix: '/api' });
  await app.register(conversationsRoutes, { prefix: '/api' });
  await app.register(messagesRoutes, { prefix: '/api' });
  await app.register(pinsRoutes, { prefix: '/api' });
  await app.register(reportsRoutes, { prefix: '/api' });
  await app.register(searchRoutes, { prefix: '/api' });
  // Later tasks register more route plugins here, in this order: tokens, discover.
  return app;
}
