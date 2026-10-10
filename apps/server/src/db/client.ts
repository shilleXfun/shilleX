import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema.ts';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export interface DbHandle { db: Db; close(): Promise<void>; kind: 'pglite' | 'postgres' }

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** `pgliteSnapshot` boots an in-memory PGlite from a dumped data dir (tests): ~1 s instead of ~5 s for initdb. */
export async function createDb(opts: { url?: string; pgliteDir?: string; pgliteSnapshot?: Blob }): Promise<DbHandle> {
  if (opts.url) {
    const pg = (await import('pg')).default;
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const pool = new pg.Pool({ connectionString: opts.url, max: 10 });
    pool.on('error', (err) => console.error('[db] idle client error', err));
    const db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder });
    return { db: db as unknown as Db, close: () => pool.end(), kind: 'postgres' };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  if (opts.pgliteDir) mkdirSync(opts.pgliteDir, { recursive: true });
  const client = opts.pgliteDir ? new PGlite(opts.pgliteDir) : new PGlite(opts.pgliteSnapshot ? { loadDataDir: opts.pgliteSnapshot } : {});
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return { db: db as unknown as Db, close: () => client.close(), kind: 'pglite' };
}
