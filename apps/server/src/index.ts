import { loadConfig } from './config.ts';
import { createDb } from './db/client.ts';
import { buildApp } from './app.ts';
import { RecordingBus } from './realtime/bus.ts';
import { InMemoryPresence } from './services/presence.ts';
import { TokenResolver } from './tokens/resolver.ts';

const config = loadConfig();
const handle = await createDb({ url: config.databaseUrl, pgliteDir: config.pgliteDir });
// bus is still RecordingBus until Task 12 replaces it with SocketBus.
const bus = new RecordingBus();
const tokens = new TokenResolver({ db: handle.db, bus, rpcUrl: config.solanaRpcUrl, live: config.liveTokenLookup });
const app = await buildApp({ db: handle.db, dbKind: handle.kind, config, bus, tokens, presence: new InMemoryPresence(), now: () => new Date() });
await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`shillex server on :${config.port} (${handle.kind})`);
