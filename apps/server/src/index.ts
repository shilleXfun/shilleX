import { loadConfig } from './config.ts';
import { createDb } from './db/client.ts';
import { buildApp } from './app.ts';
import { SocketBus, attachRealtime } from './realtime/socket.ts';
import { InMemoryPresence } from './services/presence.ts';
import { TokenResolver } from './tokens/resolver.ts';
import { isDatabaseEmpty, seed } from './seed/seed.ts';
import { startSimulator } from './seed/simulator.ts';

const config = loadConfig();
const handle = await createDb({ url: config.databaseUrl, pgliteDir: config.pgliteDir });
if (config.seedOnEmpty && (await isDatabaseEmpty(handle.db))) {
  console.log('Empty database — seeding demo world…');
  console.log(await seed(handle.db, { now: new Date() }));
}
const bus = new SocketBus();
const tokens = new TokenResolver({ db: handle.db, bus, rpcUrl: config.solanaRpcUrl, live: config.liveTokenLookup });
const app = await buildApp({ db: handle.db, dbKind: handle.kind, config, bus, tokens, presence: new InMemoryPresence(), now: () => new Date() });
attachRealtime(app, bus);
const sim = config.demoSimulator ? startSimulator(app) : null;
const shutdown = async () => { sim?.stop(); await app.close(); await handle.close(); process.exit(0); };
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`shillex server on :${config.port} (${handle.kind})`);
