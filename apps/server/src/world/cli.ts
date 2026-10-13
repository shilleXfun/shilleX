import { loadConfig } from '../config.ts';
import { createDb } from '../db/client.ts';
import { seedWorld } from './seed.ts';
import { DBC_CONFIG, createLaunchpad, getSetting, setSetting } from './launchpad.ts';
import { fundAgents } from './ledger.ts';
import { DevnetChain, makeChain } from './devnet-chain.ts';
import { TREASURY, parseWorldKey, signerFor, walletOf } from './wallets.ts';

const config = loadConfig();
if (!config.worldKey) throw new Error('Set WORLD_KEY (32 bytes, base64)');
const key = parseWorldKey(config.worldKey);
const handle = await createDb({ url: config.databaseUrl, pgliteDir: config.pgliteDir });
const cmd = process.argv[2];
try {
  if (cmd === 'seed') console.log(await seedWorld(handle.db, { now: new Date(), worldKey: key, adminPassword: config.worldAdminPassword, config }));
  else if (cmd === 'treasury') console.log('treasury', (await walletOf(handle.db, TREASURY))?.publicKey ?? '(run seed first)');
  else if (cmd === 'launchpad') {
    const existing = await getSetting(handle.db, DBC_CONFIG);
    if (existing) console.log('launchpad config already exists:', existing);
    else {
      // Through makeChain, so a mainnet DEVNET_RPC_URL is refused before anything is signed.
      const chain = await makeChain(config, handle.db);
      if (!(chain instanceof DevnetChain)) throw new Error('The launchpad is a devnet program: set WORLD_CHAIN=devnet');
      await chain.assertNotMainnet();
      const address = await createLaunchpad(chain.conn, await signerFor(handle.db, TREASURY, key));
      await setSetting(handle.db, DBC_CONFIG, address);
      console.log('launchpad config', address);
    }
  } else if (cmd === 'fund') console.log(await fundAgents(handle.db, await makeChain(config, handle.db), key, () => new Date()));
  else throw new Error(`Unknown command "${cmd}". Use: seed | treasury | launchpad | fund`);
} finally { await handle.close(); }
