import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema.ts';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export interface DbHandle { db: Db; close(): Promise<void>; kind: 'pglite' | 'postgres' }

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

export interface CreateDbOptions {
  url?: string; pgliteDir?: string; pgliteSnapshot?: Blob;
  /** Run Drizzle migrations on open (default true). Pass false to open a database without touching its schema. */
  migrate?: boolean;
  /** Postgres only: open sessions read-only so the server rejects every write. */
  readOnly?: boolean;
}

/** `pgliteSnapshot` boots an in-memory PGlite from a dumped data dir (tests): ~1 s instead of ~5 s for initdb. */
export async function createDb(opts: CreateDbOptions): Promise<DbHandle> {
  const runMigrations = opts.migrate !== false;
  if (opts.url) {
    const pg = (await import('pg')).default;
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const pool = new pg.Pool({ connectionString: opts.url, max: 10, ...(opts.readOnly ? { options: '-c default_transaction_read_only=on' } : {}) });
    pool.on('error', (err) => console.error('[db] idle client error', err));
    const db = drizzle(pool, { schema });
    if (runMigrations) await migrate(db, { migrationsFolder });
    return { db: db as unknown as Db, close: () => pool.end(), kind: 'postgres' };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  if (opts.pgliteDir) mkdirSync(opts.pgliteDir, { recursive: true });
  const client = opts.pgliteDir ? new PGlite(opts.pgliteDir) : new PGlite(opts.pgliteSnapshot ? { loadDataDir: opts.pgliteSnapshot } : {});
  const db = drizzle(client, { schema });
  if (runMigrations) await migrate(db, { migrationsFolder });
  return { db: db as unknown as Db, close: () => client.close(), kind: 'pglite' };
}
