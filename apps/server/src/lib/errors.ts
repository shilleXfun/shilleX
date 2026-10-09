import type { FastifyInstance, FastifyReply } from 'fastify';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}

export const errors = {
  badRequest: (code: string, message: string, details?: unknown) => new AppError(400, code, message, details),
  unauthorized: () => new AppError(401, 'UNAUTHORIZED', 'Sign in to continue'),
  forbidden: (code = 'FORBIDDEN', message = 'You do not have access to this') => new AppError(403, code, message),
  notFound: (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`),
  conflict: (code: string, message: string) => new AppError(409, code, message),
  tooMany: (code: string, message: string, retryAfterSec?: number) => new AppError(429, code, message, retryAfterSec ? { retryAfterSec } : undefined),
};

export const sendNotFound = (reply: FastifyReply) =>
  reply.status(404).send({ code: 'NOT_FOUND', message: 'Route not found' });

/** Pass `{ notFound: false }` when the caller installs its own not-found handler (Fastify allows only one). */
export function registerErrorHandler(app: FastifyInstance, opts: { notFound?: boolean } = {}) {
  app.setErrorHandler((err: unknown, _req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send({ code: err.code, message: err.message, details: err.details });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({ code: 'VALIDATION', message: 'Invalid input', details: err.issues });
    }
    const rawStatus = (err as { statusCode?: unknown } | null)?.statusCode;
    const status = typeof rawStatus === 'number' ? rawStatus : undefined;
    if (status === 429) return reply.status(429).send({ code: 'RATE_LIMITED', message: 'Too many requests, slow down' });
    if (status && status < 500) return reply.status(status).send({ code: 'BAD_REQUEST', message: err instanceof Error ? err.message : 'Bad request' });
    app.log.error(err);
    return reply.status(500).send({ code: 'INTERNAL', message: 'Something went wrong' });
  });
  if (opts.notFound === false) return;
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api')) return sendNotFound(reply);
    return reply.callNotFound();
  });
}
