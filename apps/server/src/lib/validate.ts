import type { z } from 'zod';
import { errors } from './errors.ts';
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw errors.badRequest('VALIDATION', 'Invalid input', r.error.issues);
  return r.data;
}
