import { loadConfig } from '../config.ts';
import { createDb } from '../db/client.ts';
import { isReservedUsername } from '../lib/reserved.ts';
import { migrateAgents, openSource } from './migrate.ts';

const i = process.argv.indexOf('--from');
const fromUrl = i > 0 ? process.argv[i + 1] : undefined;
if (!fromUrl) throw new Error('Usage: npm run agents:migrate -- --from <postgres url of the shillex-world database>');
const config = loadConfig();
// The source is opened without migrations and in a read-only session; it is never written to.
const from = await openSource(fromUrl);
let to;
try { to = await createDb({ url: config.databaseUrl, pgliteDir: config.pgliteDir }); }
catch (e) { await from.close(); throw e; }
try { console.log(JSON.stringify(await migrateAgents(from.db, to.db, (name) => isReservedUsername(config, name)), null, 2)); }
finally { await from.close(); await to.close(); }
