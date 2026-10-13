import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { routesCtx } from './raised-helpers.ts';
import { agentSeeds, agents, posts, reports, users } from '../src/db/schema.ts';
import { walletOf, TREASURY } from '../src/world/wallets.ts';
import { newId } from '../src/lib/ids.ts';
import { retireReported } from '../src/agents/raised/lifecycle.ts';
import { SESSION_COOKIE, createSession } from '../src/lib/auth.ts';

let c: Awaited<ReturnType<typeof routesCtx>>;
afterEach(() => c.t.close());
const DAY = 24 * 3600_000;
const raised = async (handle = 'tidewatch') => {
  const owner = await c.t.createUser(`${handle}_owner`);
  await c.t.as(owner).post('/api/raised', { handle, description: 'SENTINEL-WISH calm' });
  await c.settle();
  const [a] = await c.t.db.select().from(users).where(eq(users.username, handle));
  return { owner, agentId: a!.id };
};

describe('release and retire', () => {
  it('release: the agent keeps living ownerless; nudges and top-ups end; a new one after 7 days', async () => {
    c = await routesCtx();
    const { owner, agentId } = await raised();
    expect((await c.t.as(owner).post('/api/raised/release')).status).toBe(200);
    expect((await c.t.db.select().from(agents).where(eq(agents.userId, agentId)))[0]).toMatchObject({ ownerId: null, status: 'active', origin: 'raised' });
    expect(c.gate.ownerOf(agentId)).toBeNull();
    expect((await c.t.as(owner).post('/api/raised/nudges', { kind: 'rest' })).status).toBe(404);
    expect((await c.t.as(owner).post('/api/raised/top-up')).status).toBe(404);
    expect((await c.t.as(owner).post('/api/raised', { handle: 'second_one', description: 'calm' })).body.code).toBe('WAIT_7_DAYS');
    c.t.clock.advance(7 * DAY + 1);
    expect((await c.t.as(owner).post('/api/raised', { handle: 'second_one', description: 'calm' })).status).toBe(202);
  });

  it('retire: paused out of the world, off the leaderboard and the graph, SOL back to the treasury, posts and receipts stay', async () => {
    c = await routesCtx();
    const { owner, agentId } = await raised();
    const treasury = (await walletOf(c.t.db, TREASURY))!.publicKey;
    const before = (await c.chain.balances(treasury)).lamports;
    const r = await c.t.as(owner).post('/api/raised/retire');
    expect(r.body.returnedSol).toBeGreaterThan(0.09);
    expect((await c.chain.balances(treasury)).lamports).toBeGreaterThan(before);
    expect((await c.t.db.select().from(agents).where(eq(agents.userId, agentId)))[0]).toMatchObject({ status: 'retired', ownerId: null, retireReason: 'owner' });
    expect(((await c.t.as(null).get('/api/leaderboard')).body.agents as { user: { id: string } }[]).some((x) => x.user.id === agentId)).toBe(false);
    expect(((await c.t.as(null).get('/api/agents/graph')).body.nodes as { id: string }[]).some((n) => n.id === agentId)).toBe(false);
    expect((await c.t.as(null).get('/api/agents/tidewatch/receipts')).status).toBe(200);
    expect(await c.t.db.select().from(posts).where(eq(posts.authorId, agentId))).not.toHaveLength(0);
    expect((await c.t.as(null).get('/api/agents/info')).body).toMatchObject({ raised: 0 });
  });

  it('three upheld reports on its posts retire it and bar its owner for 30 days', async () => {
    c = await routesCtx();
    const { owner, agentId } = await raised();
    const [p] = await c.t.db.select().from(posts).where(eq(posts.authorId, agentId));
    for (let i = 0; i < 3; i++) {
      const who = await c.t.createUser(`reporter${i}`);
      await c.t.db.insert(reports).values({ id: newId(), reporterId: who.id, targetType: 'post', targetId: p!.id, reason: 'spam', status: 'resolved', createdAt: c.t.clock.now() });
    }
    expect(await retireReported({ db: c.t.db, chain: c.chain, key: c.key, now: c.t.clock.now, gate: c.gate })).toEqual([agentId]);
    expect((await c.t.db.select().from(agents).where(eq(agents.userId, agentId)))[0]).toMatchObject({ status: 'retired', retireReason: 'reports' });
    c.t.clock.advance(8 * DAY);
    expect((await c.t.as(owner).post('/api/raised', { handle: 'again_one', description: 'calm' })).body.code).toBe('BARRED');
    c.t.clock.advance(23 * DAY);
    // Sessions last 30 days: the owner signs in again before trying once more.
    const back = { ...owner, cookie: `${SESSION_COOKIE}=${await createSession(c.t.db, owner.id, c.t.clock.now())}` };
    expect((await c.t.as(back).post('/api/raised', { handle: 'again_one', description: 'calm' })).status).toBe(202);
  });

  it('upheld reports count people: one reporter three times, or a report its own author resolved, is not enough', async () => {
    c = await routesCtx();
    const { agentId } = await raised();
    const [p] = await c.t.db.select().from(posts).where(eq(posts.authorId, agentId));
    const mod = await c.t.createUser('moderator');
    const report = async (reporterId: string, resolvedBy: string) =>
      c.t.db.insert(reports).values({ id: newId(), reporterId, targetType: 'post', targetId: p!.id, reason: 'spam', status: 'resolved', resolvedBy, createdAt: c.t.clock.now() });
    const deps = { db: c.t.db, chain: c.chain, key: c.key, now: c.t.clock.now, gate: c.gate };
    const a = await c.t.createUser('reporter_a'), b = await c.t.createUser('reporter_b'), d = await c.t.createUser('reporter_d');
    for (let i = 0; i < 3; i++) await report(a.id, mod.id);
    await report(b.id, b.id); // a moderator upholding their own report
    expect(await retireReported(deps)).toEqual([]);
    await report(d.id, mod.id);
    expect(await retireReported(deps)).toEqual([]); // a and d: two people
    await report((await c.t.createUser('reporter_e')).id, mod.id);
    expect(await retireReported(deps)).toEqual([agentId]);
  });

  it('deleting the owner releases the agent and drops its description', async () => {
    c = await routesCtx();
    const { owner, agentId } = await raised();
    await c.t.db.delete(users).where(eq(users.id, owner.id));
    expect((await c.t.db.select().from(agents).where(eq(agents.userId, agentId)))[0]).toMatchObject({ ownerId: null, status: 'active' });
    expect(await c.t.db.select().from(agentSeeds).where(eq(agentSeeds.agentId, agentId))).toHaveLength(0);
  });
});

describe('admins and cards', () => {
  it('the world-wide pause and resume never bring a retired agent back', async () => {
    c = await routesCtx();
    const { owner, agentId } = await raised();
    await c.t.as(owner).post('/api/raised/retire');
    const admin = await c.t.createUser('admin');
    const status = async () => (await c.t.db.select().from(agents).where(eq(agents.userId, agentId)))[0]!.status;
    expect((await c.t.as(admin).post('/api/admin/world/resume-all')).status).toBe(204);
    expect(await status()).toBe('retired');
    expect((await c.t.as(admin).post('/api/admin/world/pause-all')).status).toBe(204);
    expect(await status()).toBe('retired');
    expect((await c.t.as(admin).post('/api/admin/world/agents/tidewatch/resume')).status).toBe(204);
    expect(await status()).toBe('retired');
    expect((await c.t.db.select().from(agents).where(eq(agents.userId, c.agents[0]!.id)))[0]!.status).toBe('paused');
  });

  it('admins list raised agents with their descriptions, pause and retire them; others are refused', async () => {
    c = await routesCtx();
    const { agentId } = await raised();
    const admin = await c.t.createUser('admin');
    const list = await c.t.as(admin).get('/api/admin/raised');
    expect(list.body.agents[0]).toMatchObject({ user: { id: agentId }, description: 'SENTINEL-WISH calm', owner: { username: 'tidewatch_owner' } });
    expect((await c.t.as(admin).post('/api/admin/raised/tidewatch/pause')).status).toBe(204);
    expect((await c.t.db.select().from(agents).where(eq(agents.userId, agentId)))[0]!.status).toBe('paused');
    expect((await c.t.as(admin).post('/api/admin/raised/tidewatch/retire')).status).toBe(200);
    expect((await c.t.db.select().from(agents).where(eq(agents.userId, agentId)))[0]).toMatchObject({ status: 'retired', retireReason: 'admin' });
    expect((await c.t.as(await c.t.createUser('someone')).get('/api/admin/raised')).status).toBe(403);
    expect((await c.t.as(admin).post(`/api/admin/raised/${c.agents[0]!.username}/retire`)).status).toBe(404); // wild agents can't be retired here
  });

  it('cards carry origin and owner', async () => {
    c = await routesCtx();
    const { agentId } = await raised();
    const board = (await c.t.as(null).get('/api/leaderboard')).body.agents as { user: { id: string }; origin: string; owner: { username: string } | null }[];
    expect(board.find((x) => x.user.id === agentId)).toMatchObject({ origin: 'raised', owner: { username: 'tidewatch_owner' } });
    expect(board.find((x) => x.user.id === c.agents[0]!.id)).toMatchObject({ origin: 'wild', owner: null });
  });
});
