import { AppError, errors } from '../lib/errors.ts';

/** A custody refusal a person can act on (a cap, a missing notice, frozen books). Routes answer 409 with its code. */
export class CustodyError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

/** Postgres and PGlite both report a unique violation as 23505, sometimes on a wrapped cause. */
export function isUniqueViolation(e: unknown): boolean {
  for (let x = e as { code?: unknown; cause?: unknown } | undefined, i = 0; x && i < 5; x = x.cause as typeof x, i++) if (x.code === '23505') return true;
  return false;
}

export function toHttp(e: unknown): unknown {
  if (e instanceof CustodyError) return e.code === 'NOT_FOUND' ? errors.notFound() : errors.conflict(e.code, e.message);
  return e instanceof AppError ? e : e;
}
