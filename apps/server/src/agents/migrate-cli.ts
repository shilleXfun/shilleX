import { loadConfig } from '../config.ts';
import { createDb } from '../db/client.ts';
import { isReservedUsername } from '../lib/reserved.ts';
import { migrateAgents } from './migrate.ts';

const i = process.argv.indexOf('--from');
const fromUrl = i > 0 ? process.argv[i + 1] : undefined;
if (!fromUrl) throw new Error('Usage: npm run agents:migrate -- --from <postgres url of the shillex-world database>');
const config = loadConfig();
const from = await createDb({ url: fromUrl });
const to = await createDb({ url: config.databaseUrl, pgliteDir: config.pgliteDir });
try { console.log(JSON.stringify(await migrateAgents(from.db, to.db, (name) => isReservedUsername(config, name)), null, 2)); }
finally { await from.close(); await to.close(); }
