import { loadConfig } from './config.ts';
import { createDb } from './db/client.ts';
import { buildApp } from './app.ts';
import { RecordingBus } from './realtime/bus.ts';
import { InMemoryPresence } from './services/presence.ts';
import type { TokenResolverPort } from './deps.ts';

const config = loadConfig();
const handle = await createDb({ url: config.databaseUrl, pgliteDir: config.pgliteDir });
// Temporary wiring; Task 11 replaces tokens with TokenResolver, Task 12 replaces bus with SocketBus.
const tokens: TokenResolverPort = { enqueue() {}, async resolve(m) { throw new Error(`no resolver for ${m}`); }, async getViews() { return {}; } };
const app = await buildApp({ db: handle.db, dbKind: handle.kind, config, bus: new RecordingBus(), tokens, presence: new InMemoryPresence(), now: () => new Date() });
await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`shillex server on :${config.port} (${handle.kind})`);
