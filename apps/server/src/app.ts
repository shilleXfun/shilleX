import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import type { UserRow } from './db/schema.ts';
import type { AppDeps } from './deps.ts';
import { registerErrorHandler, errors } from './lib/errors.ts';
import { SESSION_COOKIE, userForToken } from './lib/auth.ts';
import authRoutes from './routes/auth.ts';

declare module 'fastify' {
  interface FastifyInstance { deps: AppDeps }
  interface FastifyRequest { user: UserRow | null }
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.config.nodeEnv === 'development' ? { level: 'info' } : false, bodyLimit: 1_000_000 });
  app.decorate('deps', deps);
  app.decorateRequest('user', null);
  await app.register(cookie, { secret: deps.config.sessionSecret });
  await app.register(rateLimit, { global: false });
  registerErrorHandler(app);

  app.addHook('onRequest', async (req) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.url.startsWith('/api')) {
      const origin = req.headers.origin;
      if (origin && !deps.config.allowedOrigins.includes(origin)) throw errors.forbidden('BAD_ORIGIN', 'Cross-origin request blocked');
    }
    if (req.url.startsWith('/api')) req.user = await userForToken(deps.db, req.cookies[SESSION_COOKIE], deps.now());
  });

  await app.register(authRoutes, { prefix: '/api' });
  // Later tasks register more route plugins here, in this order:
  // uploads, media, posts, feed, users, me, notifications, communities, channels,
  // conversations, messages, tokens, discover, reports, search.
  return app;
}
