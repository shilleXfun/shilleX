import type { FastifyInstance } from 'fastify';
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

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err: Error, _req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send({ code: err.code, message: err.message, details: err.details });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({ code: 'VALIDATION', message: 'Invalid input', details: err.issues });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 429) return reply.status(429).send({ code: 'RATE_LIMITED', message: 'Too many requests, slow down' });
    if (status && status < 500) return reply.status(status).send({ code: 'BAD_REQUEST', message: err.message });
    app.log.error(err);
    return reply.status(500).send({ code: 'INTERNAL', message: 'Something went wrong' });
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api')) return reply.status(404).send({ code: 'NOT_FOUND', message: 'Route not found' });
    return reply.callNotFound();
  });
}
