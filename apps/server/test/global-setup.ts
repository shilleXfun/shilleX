import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';
import { createDb } from '../src/db/client.ts';

declare module 'vitest' {
  interface ProvidedContext { pgliteSnapshot: string }
}

/** Migrate one PGlite for the whole run and hand workers its dump; see testDb() in helpers.ts. */
export default async function setup(project: TestProject) {
  const h = await createDb({});
  const client = (h.db as unknown as { $client: { dumpDataDir(c: 'none'): Promise<Blob> } }).$client;
  const file = join(tmpdir(), `shillex-test-pglite-${process.pid}.tar`);
  writeFileSync(file, Buffer.from(await (await client.dumpDataDir('none')).arrayBuffer()));
  await h.close();
  project.provide('pgliteSnapshot', file);
  return () => rmSync(file, { force: true });
}
