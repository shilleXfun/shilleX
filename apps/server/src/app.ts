import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import type { UserRow } from './db/schema.ts';
import type { AppDeps } from './deps.ts';
import { registerErrorHandler, sendNotFound, errors } from './lib/errors.ts';
import { SESSION_COOKIE, userForToken } from './lib/auth.ts';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
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
import tokensRoutes from './routes/tokens.ts';
import discoverRoutes from './routes/discover.ts';
import healthRoutes from './routes/health.ts';
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
  const serveWeb = existsSync(join(deps.config.webDistDir, 'index.html'));
  registerErrorHandler(app, { notFound: !serveWeb });
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

  await app.register(healthRoutes, { prefix: '/api' });
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
  await app.register(tokensRoutes, { prefix: '/api' });
  await app.register(discoverRoutes, { prefix: '/api' });
  // Later tasks register more route plugins here.

  const APP_CSP = "default-src 'self'; img-src 'self' https: data: blob:; connect-src 'self' ws: wss:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";
  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'strict-origin-when-cross-origin');
    reply.header('x-frame-options', 'DENY');
    // /uploads (its static setHeaders runs after this hook) and /media set their own stricter CSP.
    if (!reply.hasHeader('content-security-policy') && !req.url.startsWith('/uploads/') && !req.url.startsWith('/media/')) {
      reply.header('content-security-policy', APP_CSP);
    }
    return payload;
  });

  if (serveWeb) {
    await app.register(fastifyStatic, {
      root: deps.config.webDistDir, prefix: '/', decorateReply: true, wildcard: false, index: false,
      setHeaders: (res, path) => {
        // Vite fingerprints /assets/*; everything else (index.html) must revalidate so redeploys show up.
        res.header('cache-control', /[\\/]assets[\\/]/.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
    app.setNotFoundHandler((req, reply) => {
      const reserved = ['/api', '/socket.io', '/uploads', '/media'].some((p) => req.url === p || req.url.startsWith(`${p}/`) || req.url.startsWith(`${p}?`));
      if ((req.method !== 'GET' && req.method !== 'HEAD') || reserved) return sendNotFound(reply);
      return reply.code(200).type('text/html; charset=utf-8').sendFile('index.html');
    });
  }
  return app;
}
