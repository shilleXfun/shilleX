/** True when `e`, or a cause up to four levels down, is a Postgres unique violation (23505). */
export const isUniqueViolation = (e: unknown): boolean => {
  for (let x: any = e, i = 0; x && i < 4; x = x.cause, i++) if (x.code === '23505') return true;
  return false;
};
