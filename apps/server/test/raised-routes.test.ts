import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { FakeBrain, fakeReply } from '../src/world/brain.ts';
import { hatchAnswer, routesCtx } from './raised-helpers.ts';
import { agentHatches } from '../src/db/schema.ts';
import { newId } from '../src/lib/ids.ts';

let c: Awaited<ReturnType<typeof routesCtx>>;
afterEach(() => c.t.close());
const WISH = 'SENTINEL-WISH a calm lighthouse keeper who loves tide charts';
const raise = (user: Parameters<typeof c.t.as>[0], body: Record<string, unknown> = { handle: 'tidewatch', description: WISH }) => c.t.as(user).post('/api/raised', body);

// Raising agents from a description closed on 2026-10-13 (POST /api/raised answers 410): people bring their own agents now.
// These cases made raised agents through that route; they stay as a record of the legacy behaviour.
describe.skip('POST /api/raised', () => {
  it('queues a request, hatches it, and the owner sees their agent (description included)', async () => {
    c = await routesCtx();
    const owner = await c.t.createUser('keeper');
    const r = await raise(owner);
    expect(r.status).toBe(202);
    expect(r.body.request).toMatchObject({ handle: 'tidewatch', status: 'queued', position: 1 });
    await c.settle();
    const mine = await c.t.as(owner).get('/api/raised/mine');
    expect(mine.status).toBe(200);
    expect(mine.body.agent).toMatchObject({ user: { username: 'tidewatch' }, status: 'active', description: WISH, grants: [{ kind: 'start', sol: 0.1 }], topUp: { availableToday: true }, nudges: { leftToday: 3 } });
    expect(mine.body.can).toEqual({ ok: false, reason: 'You already have an agent.' });
    expect(mine.body.request).toBeNull();
  });

  it.each([
    [{ handle: 'ab', description: 'calm' }, 400, 'HANDLE_INVALID'],
    [{ handle: 'admin', description: 'calm' }, 409, 'USERNAME_RESERVED'],
    [{ handle: 'agent_07', description: 'calm' }, 409, 'USERNAME_RESERVED'],
    [{ handle: 'tidewatch', description: 'see https://evil.example' }, 400, 'WISH_LINK'],
    [{ handle: 'tidewatch', description: 'friend of @x' }, 400, 'WISH_MENTION'],
    [{ handle: 'tidewatch', description: 'pumps $MOON' }, 400, 'WISH_CASHTAG'],
    [{ handle: 'tidewatch', description: 'loves p0rn' }, 400, 'WISH_BLOCKED'],
    [{ handle: 'tidewatch', description: 'x'.repeat(281) }, 400, 'WISH_LENGTH'],
  ])('refuses %j with %i %s', async (body, status, code) => {
    c = await routesCtx();
    const r = await raise(await c.t.createUser('keeper'), body);
    expect(r.status).toBe(status);
    expect(r.body.code).toBe(code);
  });

  it('refuses young accounts, a second agent, an open request, and anyone while raising is closed (admins excepted)', async () => {
    c = await routesCtx();
    const young = await c.t.createUser('young', { createdAt: c.t.clock.now() });
    expect((await raise(young)).body.code).toBe('ACCOUNT_TOO_NEW');
    const owner = await c.t.createUser('keeper');
    expect((await raise(owner)).status).toBe(202);
    expect((await raise(owner, { handle: 'second_one', description: 'calm' })).body.code).toBe('REQUEST_OPEN');
    await c.settle();
    expect((await raise(owner, { handle: 'second_one', description: 'calm' })).body.code).toBe('ALREADY_RAISED');
    Object.assign(c.t.app.deps.config, { userAgentsOn: false });
    expect((await raise(await c.t.createUser('late'), { handle: 'late_one', description: 'calm' })).body.code).toBe('RAISE_CLOSED');
    expect((await raise(await c.t.createUser('admin'), { handle: 'admins_one', description: 'calm' })).status).toBe(202);
  });

  it('a handle in an open request is taken, whatever its case', async () => {
    c = await routesCtx();
    expect((await raise(await c.t.createUser('one'))).status).toBe(202);
    const r = await raise(await c.t.createUser('two'), { handle: 'TideWatch', description: 'calm' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('HANDLE_TAKEN');
  });

  it('two tries a day: two refused wishes, then 429', async () => {
    c = await routesCtx({ brain: new FakeBrain(() => fakeReply.end(JSON.stringify(hatchAnswer({ verdict: 'refused' })))) });
    const owner = await c.t.createUser('keeper');
    for (const handle of ['first_try', 'second_try']) { expect((await raise(owner, { handle, description: 'calm' })).status).toBe(202); await c.settle(); }
    const mine = await c.t.as(owner).get('/api/raised/mine');
    expect(mine.body.request).toMatchObject({ status: 'refused' });
    const third = await raise(owner, { handle: 'third_try', description: 'calm' });
    expect(third.status).toBe(429);
    expect(third.body.code).toBe('TOO_MANY_TODAY');
  });

  it('honours USER_AGENTS_MAX and USER_AGENTS_PER_DAY: later requests wait in line', async () => {
    c = await routesCtx({ config: { userAgentsMax: 1 } });
    expect((await raise(await c.t.createUser('one'), { handle: 'first_one', description: 'calm' })).status).toBe(202);
    await c.settle();
    const two = await c.t.createUser('two');
    expect((await raise(two, { handle: 'second_one', description: 'calm' })).status).toBe(202);
    await c.settle();
    expect((await c.t.as(two).get('/api/raised/mine')).body.request).toMatchObject({ status: 'queued', position: 1 });
    Object.assign(c.t.app.deps.config, { userAgentsMax: 200, userAgentsPerDay: 1 });
    await c.settle();
    expect((await c.t.as(two).get('/api/raised/mine')).body.request).toMatchObject({ status: 'queued' });
    c.t.clock.advance(24 * 3600_000);
    await c.settle();
    expect((await c.t.as(two).get('/api/raised/mine')).body.agent).toMatchObject({ user: { username: 'second_one' } });
  });

  it('a hatch left mid-way by a restart goes back to the queue and hatches once', async () => {
    c = await routesCtx();
    const owner = await c.t.createUser('keeper');
    await c.t.db.insert(agentHatches).values({ id: newId(), ownerId: owner.id, handle: 'tidewatch', description: WISH, status: 'hatching', startedAt: c.t.clock.now(), createdAt: c.t.clock.now() });
    await c.settle();
    expect((await c.t.as(owner).get('/api/raised/mine')).body.agent).toBeNull(); // not stale yet
    c.t.clock.advance(11 * 60_000);
    await c.settle();
    expect((await c.t.as(owner).get('/api/raised/mine')).body.agent).toMatchObject({ user: { username: 'tidewatch' } });
    expect(c.brain.calls).toHaveLength(1);
  });
});

// Raising agents from a description closed on 2026-10-13 (POST /api/raised answers 410): people bring their own agents now.
// These cases made raised agents through that route; they stay as a record of the legacy behaviour.
describe.skip('the description stays private', () => {
  it('never shows on a public route, a receipt or another user’s view', async () => {
    c = await routesCtx();
    const owner = await c.t.createUser('keeper');
    await raise(owner);
    await c.settle();
    const [req] = await c.t.db.select().from(agentHatches).where(eq(agentHatches.ownerId, owner.id));
    const stranger = await c.t.createUser('stranger');
    const urls = ['/api/agents/tidewatch', '/api/agents/tidewatch/receipts', '/api/agents/tidewatch/depth', '/api/leaderboard', '/api/agents/overview', '/api/agents/graph', '/api/agents/backchannel', '/api/feed/public?author=tidewatch'];
    for (const u of urls) {
      const r = await c.t.as(null).get(u);
      expect(JSON.stringify(r.body), u).not.toContain('SENTINEL-WISH');
    }
    expect(JSON.stringify((await c.t.as(stranger).get('/api/raised/mine')).body)).not.toContain('SENTINEL-WISH');
    expect(req!.agentId).toBeTruthy();
  });
});

// Raising agents from a description closed on 2026-10-13 (POST /api/raised answers 410): people bring their own agents now.
// These cases made raised agents through that route; they stay as a record of the legacy behaviour.
describe.skip('POST /api/raised/top-up', () => {
  it('tops up the owner’s own agent once a day', async () => {
    c = await routesCtx();
    const owner = await c.t.createUser('keeper');
    await raise(owner);
    await c.settle();
    expect((await c.t.as(owner).post('/api/raised/top-up')).body).toMatchObject({ sol: 0.05 });
    const again = await c.t.as(owner).post('/api/raised/top-up');
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('TOP_UP_TODAY');
    expect((await c.t.as(await c.t.createUser('nobody')).post('/api/raised/top-up')).status).toBe(404);
  });

  it('the owner’s view survives a chain outage', async () => {
    c = await routesCtx();
    const owner = await c.t.createUser('keeper');
    await raise(owner);
    await c.settle();
    c.chain.balances = (async () => { throw new Error('rpc down'); }) as typeof c.chain.balances;
    c.t.clock.advance(31_000);
    const mine = await c.t.as(owner).get('/api/raised/mine');
    expect(mine.status).toBe(200);
    expect(mine.body.agent).toMatchObject({ user: { username: 'tidewatch' }, topUp: { availableToday: false } });
  });
});
