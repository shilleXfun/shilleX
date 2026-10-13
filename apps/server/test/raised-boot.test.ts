import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestApp } from './helpers.ts';
import { loadConfig } from '../src/config.ts';
import { bootAgents, worldNotReady } from '../src/world/boot.ts';
import { seedWorld } from '../src/world/seed.ts';
import { agentGrants, agentHatches, agents, users, wallets } from '../src/db/schema.ts';
import { newId } from '../src/lib/ids.ts';
import { routesCtx } from './raised-helpers.ts';

let close: (() => Promise<void>) | null = null;
afterEach(async () => { await close?.(); close = null; });

// Raising agents from a description closed on 2026-10-13 (POST /api/raised answers 410): people bring their own agents now.
// These cases made raised agents through that route; they stay as a record of the legacy behaviour.
describe.skip('raised agents in the world', () => {
  it('boot registers the raise routes', async () => {
    const t = await makeTestApp({ config: loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 's', WORLD_CHAIN: 'memory', WORLD_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=' }) });
    const world = await bootAgents(t.app, {});
    close = async () => { await world.stop(); await t.close(); };
    const u = await t.createUser('keeper');
    const r = await t.as(u).get('/api/raised/mine');
    expect(r.status).toBe(200);
    expect(r.body.can).toEqual({ ok: false, reason: 'Raising agents opens soon.' });
  });

  it('counts wild and raised agents; seedWorld still keeps 50 wild ones', async () => {
    const c = await routesCtx();
    close = () => c.t.close();
    const owner = await c.t.createUser('keeper');
    await c.t.as(owner).post('/api/raised', { handle: 'tidewatch', description: 'calm' });
    await c.settle();
    expect((await c.t.as(null).get('/api/agents/info')).body).toMatchObject({ agents: 51, wild: 50, raised: 1 });
    expect((await seedWorld(c.t.db, { now: c.t.clock.now(), worldKey: c.key })).created).toBe(0);
    await c.t.db.delete(users).where(eq(users.id, c.agents[0]!.id));
    expect((await seedWorld(c.t.db, { now: c.t.clock.now(), worldKey: c.key })).created).toBe(1);
  });

  it('a raised wallet never blocks the world', async () => {
    const c = await routesCtx({ treasurySol: 1.2 });
    close = () => c.t.close();
    await c.t.db.update(wallets).set({ fundedAt: c.t.clock.now() });
    // The treasury covers the pre-check, then runs dry before the grant: the agent is made, unfunded and paused.
    const owner = await c.t.createUser('keeper');
    await c.t.as(owner).post('/api/raised', { handle: 'tidewatch', description: 'calm' });
    const send = c.chain.sendSol.bind(c.chain);
    c.chain.sendSol = (async () => { throw new Error('rpc down'); }) as typeof c.chain.sendSol;
    await c.settle();
    c.chain.sendSol = send;
    const [a] = await c.t.db.select().from(agents).where(eq(agents.origin, 'raised'));
    expect(a!.status).toBe('paused');
    expect(await worldNotReady(c.t.db, c.chain)).toBeNull();
  });

  it('a start grant that failed is sent later and wakes the agent', async () => {
    const c = await routesCtx();
    close = () => c.t.close();
    const owner = await c.t.createUser('keeper');
    await c.t.as(owner).post('/api/raised', { handle: 'tidewatch', description: 'calm' });
    const send = c.chain.sendSol.bind(c.chain);
    c.chain.sendSol = (async () => { throw new Error('rpc down'); }) as typeof c.chain.sendSol;
    await c.settle();
    c.chain.sendSol = send;
    await c.settle();
    const [a] = await c.t.db.select().from(agents).where(eq(agents.origin, 'raised'));
    expect(a!.status).toBe('active');
    expect((await c.t.as(owner).get('/api/raised/mine')).body.agent.grants).toHaveLength(1);
  });

  it('serves only agent turns as receipts (a hatch receipt lives on its owner)', async () => {
    const c = await routesCtx();
    close = () => c.t.close();
    const owner = await c.t.createUser('keeper');
    await c.t.as(owner).post('/api/raised', { handle: 'tidewatch', description: 'calm' });
    await c.settle();
    const { agentTurns } = await import('../src/db/schema.ts');
    const [t] = await c.t.db.select().from(agentTurns).where(eq(agentTurns.agentId, owner.id));
    expect(t).toBeDefined();
    expect((await c.t.as(null).get(`/api/receipts/${t!.id}`)).status).toBe(404);
  });

  it('fundAgents ("Set up and fund") leaves raised wallets to their grants', async () => {
    const c = await routesCtx();
    close = () => c.t.close();
    const { fundAgents } = await import('../src/world/ledger.ts');
    const owner = await c.t.createUser('keeper');
    await c.t.as(owner).post('/api/raised', { handle: 'tidewatch', description: 'calm' });
    await c.settle();
    const r = await fundAgents(c.t.db, c.chain, c.key, c.t.clock.now);
    expect(r.funded + r.skipped).toBe(50);
  });

  /** A raised agent a crash left half made: its rows exist, paused, with no wallet and no start grant. */
  const halfMade = async (c: Awaited<ReturnType<typeof routesCtx>>, handle: string) => {
    const owner = await c.t.createUser(`${handle}_owner`);
    const id = newId();
    await c.t.db.insert(users).values({ id, username: handle, displayName: '', bio: '', kind: 'agent', createdAt: c.t.clock.now() });
    await c.t.db.insert(agents).values({ userId: id, status: 'paused', origin: 'raised', ownerId: owner.id, createdAt: c.t.clock.now() });
    return id;
  };

  it('a half-made raised agent with no wallet never stops the queue, and gets its wallet, grant and wake-up', async () => {
    const c = await routesCtx();
    close = () => c.t.close();
    const stuck = await halfMade(c, 'halfmade');
    const owner = await c.t.createUser('keeper');
    expect((await c.t.as(owner).post('/api/raised', { handle: 'tidewatch', description: 'calm' })).status).toBe(202);
    await c.settle();
    expect((await c.t.db.select().from(agentHatches).where(eq(agentHatches.ownerId, owner.id)))[0]!.status).toBe('done');
    expect((await c.t.db.select().from(agents).where(eq(agents.userId, stuck)))[0]!.status).toBe('active');
    expect(await c.t.db.select().from(agentGrants).where(eq(agentGrants.agentId, stuck))).toHaveLength(1);
  });

  it('a transfer that keeps failing for one owed grant never stops the queue', async () => {
    const c = await routesCtx();
    close = () => c.t.close();
    await halfMade(c, 'halfmade');
    c.chain.sendSol = (async () => { throw new Error('rpc down'); }) as typeof c.chain.sendSol;
    const owner = await c.t.createUser('keeper');
    await c.t.as(owner).post('/api/raised', { handle: 'tidewatch', description: 'calm' });
    await c.settle();
    expect((await c.t.db.select().from(agentHatches).where(eq(agentHatches.ownerId, owner.id)))[0]!.status).toBe('done');
  });
});
