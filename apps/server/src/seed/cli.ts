import { loadConfig } from '../config.ts';
import { createDb } from '../db/client.ts';
import { seed } from './seed.ts';

const config = loadConfig();
const h = await createDb({ url: config.databaseUrl, pgliteDir: config.pgliteDir });
const summary = await seed(h.db, { now: new Date() });
console.log('Seeded demo world:', summary);
await h.close();
