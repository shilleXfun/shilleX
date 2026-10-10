import { loadConfig } from '../config.ts';
import { createDb } from '../db/client.ts';
import { seedWorld } from './seed.ts';
import { parseWorldKey } from './wallets.ts';

const config = loadConfig();
if (!config.worldMode) throw new Error('Set WORLD_MODE=agents to run world commands');
if (!config.worldKey) throw new Error('Set WORLD_KEY (32 bytes, base64)');
const key = parseWorldKey(config.worldKey);
const handle = await createDb({ url: config.databaseUrl, pgliteDir: config.pgliteDir });
const cmd = process.argv[2];
try {
  if (cmd === 'seed') console.log(await seedWorld(handle.db, { now: new Date(), worldKey: key, adminPassword: config.worldAdminPassword }));
  else throw new Error(`Unknown command "${cmd}". Use: seed`);
} finally { await handle.close(); }
