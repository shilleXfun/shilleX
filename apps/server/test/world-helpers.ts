import { randomBytes } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { makeTestApp } from './helpers.ts';
import { users, type UserRow } from '../src/db/schema.ts';
import { seedWorld } from '../src/world/seed.ts';
import { MemoryChain } from '../src/world/chain.ts';
import { walletOf } from '../src/world/wallets.ts';
import { WorldEvents } from '../src/world/events.ts';
import { AgentActor } from '../src/world/actor.ts';
import { startTurn } from '../src/world/provenance.ts';
import type { ToolContext } from '../src/world/tools.ts';

/** A seeded world: 50 agents, each holding 0.1 SOL in a MemoryChain, plus helpers to act as any of them. */
export async function worldTestCtx() {
  const t = await makeTestApp();
  const key = randomBytes(32);
  await seedWorld(t.db, { now: t.clock.now(), worldKey: key });
  const chain = new MemoryChain();
  const agents = await t.db.select().from(users).where(eq(users.kind, 'agent')).orderBy(asc(users.username));
  for (const a of agents) chain.airdrop((await walletOf(t.db, a.id))!.publicKey, 100_000_000);
  const events = new WorldEvents();
  const actor = new AgentActor(t.app);
  const ctxFor = async (agent: UserRow): Promise<ToolContext> => {
    const [fresh] = await t.db.select().from(users).where(eq(users.id, agent.id));
    const { id } = await startTurn(t.db, { agentId: agent.id, triggers: [{ type: 'heartbeat' }], model: 'm', effort: 'medium', promptVersion: 'v', snapshotId: null, now: t.clock.now() });
    return { app: t.app, db: t.db, actor, chain, events, agent: fresh!, turnId: id, worldKey: key, now: t.clock.now, publicUrl: 'http://localhost:5173' };
  };
  return { t, chain, key, events, actor, agents, ctxFor };
}
