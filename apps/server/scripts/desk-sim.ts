/**
 * Fast-forward trading sim (2026-10-24: "focus on the brain"). Runs the real engine and depth sweeps on a copy of the world
 * (DATABASE_URL, which this run WRITES to: point it at a throwaway copy) over a MemoryChain, with a clock that moves STEP_S
 * simulated seconds per agent turn (production runs about one turn every 4 s). No model, no RPC, no network: the real-coin
 * desk is left out because its prices are live. At the end it prints how the agents' worth moved and how their plans closed.
 *
 *   DATABASE_URL=postgres://…/sim WORLD_KEY=… SIM_HOURS=12 npx tsx scripts/desk-sim.ts
 */
import { loadConfig } from '../src/config.ts';
import { createDb } from '../src/db/client.ts';
import { buildApp } from '../src/app.ts';
import { InMemoryPresence } from '../src/services/presence.ts';
import { startEngine } from '../src/agents/engine.ts';
import { createDepth } from '../src/agents/depth/index.ts';
import { DepthRegistry } from '../src/agents/depth/registry.ts';
import { reputation } from '../src/agents/depth/reputation.ts';
import { MemoryChain, RAW_PER_TOKEN } from '../src/world/chain.ts';
import { WorldEvents } from '../src/world/events.ts';
import { restoreMemoryChain } from '../src/world/boot.ts';
import { parseWorldKey } from '../src/world/wallets.ts';
import { agentDesks, agentTheses, chainTxs, wallets } from '../src/db/schema.ts';
import { and, eq, gte, sql } from 'drizzle-orm';

const HOURS = Number(process.env.SIM_HOURS ?? 12), STEP_S = Number(process.env.STEP_S ?? 4.3), SWEEP_MIN = 5;
process.env.AGENTS = 'off'; process.env.WORLD_CHAIN = 'memory'; process.env.SCENES = 'off'; process.env.ANTHROPIC_API_KEY = '';
const config = loadConfig();
const handle = await createDb({ url: config.databaseUrl });
const db = handle.db;
let t = Date.now();
const now = () => new Date(t);
const bus = { toRoom() {}, toRoomExcept() {}, toUser() {} } as never;
const tokens = { enqueue() {}, getViews: async () => ({}), resolve: async () => null } as never;
const app = await buildApp({ db, dbKind: handle.kind, config, bus, tokens, presence: new InMemoryPresence(), now });
const chain = new MemoryChain();
console.log('[sim] chain', await restoreMemoryChain(db, chain));
const key = parseWorldKey(config.worldKey!);
const depth = new DepthRegistry(createDepth().modules.filter((m) => m.name !== 'real_desk'));
let seed = 7;
const rng = () => { seed = (seed * 1664525 + 1013904223) % 2 ** 32; return seed / 2 ** 32; };
const deps = { app, db, chain, events: new WorldEvents(), worldKey: key, now, rng, busy: new Set<string>(), bootAt: now(), depth };
const engine = startEngine({ ...deps, tickMs: [1, 1], autoStart: false });

/** Each agent's worth now: SOL plus coins at the curve's price. */
async function worth(): Promise<Map<string, number>> {
  const ws = await db.select().from(wallets);
  const out = new Map<string, number>();
  for (const w of ws) {
    const b = await chain.balances(w.publicKey);
    let v = b.lamports;
    for (const tk of b.tokens) { const c = await chain.curve(tk.mint); if (c && !c.graduated) v += (c.priceLamports * tk.raw) / RAW_PER_TOKEN; }
    out.set(w.ownerId, v / 1e9);
  }
  return out;
}

const start = new Date(t);
const before = await worth();
await reputation.refresh(db, now()).catch(() => undefined);
const ticks = Math.round((HOURS * 3600) / STEP_S);
let lastSweep = t;
const t0 = Date.now();
for (let i = 0; i < ticks; i++) {
  await engine.tick();
  t += STEP_S * 1000;
  if (t - lastSweep >= SWEEP_MIN * 60_000) { lastSweep = t; await depth.sweep(deps as never); }
  if (i % 500 === 0) console.log(`[sim] ${((i * STEP_S) / 3600).toFixed(1)} h simulated, ${Math.round((Date.now() - t0) / 1000)} s real`);
}
const after = await worth();

const deltas = [...before].filter(([id]) => after.has(id)).map(([id, b]) => after.get(id)! - b);
const sum = deltas.reduce((a, b) => a + b, 0);
const up = deltas.filter((d) => d > 0.0005).length, down = deltas.filter((d) => d < -0.0005).length;
const txs = await db.select({ kind: chainTxs.kind, n: sql<number>`count(*)::int`, sol: sql<number>`coalesce(sum(${chainTxs.lamportsDelta}),0)::float8 / 1e9` }).from(chainTxs).where(gte(chainTxs.createdAt, start)).groupBy(chainTxs.kind);
const closed = await db.select({ style: agentDesks.style, status: agentTheses.status, n: sql<number>`count(*)::int`, avg: sql<number>`avg(${agentTheses.pnlPct})::float8` })
  .from(agentTheses).leftJoin(agentDesks, eq(agentDesks.agentId, agentTheses.agentId))
  .where(and(eq(agentTheses.market, 'world'), gte(agentTheses.openedAt, start))).groupBy(agentDesks.style, agentTheses.status);
console.log(`\n[sim] ${HOURS} h simulated in ${Math.round((Date.now() - t0) / 1000)} s`);
console.log(`[sim] worth: total ${sum >= 0 ? '+' : ''}${sum.toFixed(3)} SOL across ${deltas.length} wallets; ${up} up, ${down} down; best ${Math.max(...deltas).toFixed(3)}, worst ${Math.min(...deltas).toFixed(3)}`);
console.log('[sim] trades:', txs.map((x) => `${x.kind} ${x.n} (${Number(x.sol).toFixed(3)} SOL)`).join(', '));
console.log('[sim] theses by style:');
for (const c of closed) console.log(`  ${String(c.style ?? 'none').padEnd(10)} ${c.status.padEnd(8)} ${String(c.n).padStart(4)}  avg ${c.avg === null ? '—' : `${(c.avg * 100).toFixed(1)}%`}`);
await engine.stop();
await app.close(); await handle.close();
process.exit(0);
