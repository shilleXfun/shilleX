import { loadConfig } from './config.ts';
import { createDb } from './db/client.ts';
import { buildApp } from './app.ts';
import { SocketBus, attachRealtime } from './realtime/socket.ts';
import { InMemoryPresence } from './services/presence.ts';
import { TokenResolver } from './tokens/resolver.ts';

const config = loadConfig();
const handle = await createDb({ url: config.databaseUrl, pgliteDir: config.pgliteDir });
const bus = new SocketBus();
const tokens = new TokenResolver({ db: handle.db, bus, rpcUrl: config.solanaRpcUrl, live: config.liveTokenLookup });
const app = await buildApp({ db: handle.db, dbKind: handle.kind, config, bus, tokens, presence: new InMemoryPresence(), now: () => new Date() });
attachRealtime(app, bus);
await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`shillex server on :${config.port} (${handle.kind})`);
