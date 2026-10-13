import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { worldTestCtx } from './world-helpers.ts';
import { agents, users } from '../src/db/schema.ts';
import { ownerOf, originOf, raisedAgentOf } from '../src/agents/raised/owner.ts';
import { loadConfig } from '../src/config.ts';
import { isReservedUsername } from '../src/lib/reserved.ts';

let w: Awaited<ReturnType<typeof worldTestCtx>> | null = null;
afterEach(async () => { await w?.t.close(); w = null; });

describe('raised agents: data and lookups', () => {
  it('every seeded agent is wild, with no owner', async () => {
    w = await worldTestCtx();
    const rows = await w.t.db.select().from(agents);
    expect(rows).toHaveLength(50);
    expect(rows.every((r) => r.origin === 'wild' && r.ownerId === null && r.retiredAt === null && r.releasedAt === null)).toBe(true);
    expect(await ownerOf(w.t.db, w.agents[0]!.id)).toBeNull();
    expect(await originOf(w.t.db, w.agents[0]!.id)).toBe('wild');
    expect(await originOf(w.t.db, 'nobody')).toBeNull();
  });

  it('ownerOf and raisedAgentOf follow agents.owner_id, and a human owns at most one agent', async () => {
    w = await worldTestCtx();
    const human = await w.t.createUser('raiser');
    const [a, b] = [w.agents[0]!, w.agents[1]!];
    await w.t.db.update(agents).set({ origin: 'raised', ownerId: human.id }).where(eq(agents.userId, a.id));
    expect(await ownerOf(w.t.db, a.id)).toBe(human.id);
    expect(await originOf(w.t.db, a.id)).toBe('raised');
    expect(await raisedAgentOf(w.t.db, human.id)).toEqual({ agentId: a.id, status: 'active' });
    await expect(w.t.db.update(agents).set({ origin: 'raised', ownerId: human.id }).where(eq(agents.userId, b.id))).rejects.toThrow();
    expect(await ownerOf(w.t.db, 'nobody')).toBeNull();
  });

  it('an owner row that goes away leaves the agent ownerless (on delete set null)', async () => {
    w = await worldTestCtx();
    const human = await w.t.createUser('leaver');
    const a = w.agents[2]!;
    await w.t.db.update(agents).set({ origin: 'raised', ownerId: human.id }).where(eq(agents.userId, a.id));
    await w.t.db.delete(users).where(eq(users.id, human.id));
    expect(await ownerOf(w.t.db, a.id)).toBeNull();
    expect(await originOf(w.t.db, a.id)).toBe('raised');
  });

  it('reads the RAISE settings with their defaults', () => {
    const c = loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 's' });
    expect(c).toMatchObject({ userAgentsOn: false, userAgentsMax: 200, userAgentsPerDay: 30, userAgentGrantsDailySol: 3, userAgentBudgetShare: 0.35, ownerModelRepliesPerDay: 5, userAgentMinAccountDays: 3, hatchWithoutModel: false });
    expect(loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 's', WORLD_CHAIN: 'memory' }).hatchWithoutModel).toBe(true);
    expect(loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 's', WORLD_CHAIN: 'memory', ANTHROPIC_API_KEY: 'k' }).hatchWithoutModel).toBe(false);
    expect(loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(20), WORLD_CHAIN: 'memory' }).hatchWithoutModel).toBe(false);
    expect(loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 's', USER_AGENT_BUDGET_SHARE: '7' }).userAgentBudgetShare).toBe(1);
    expect(loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 's', USER_AGENTS: 'on', USER_AGENTS_MIN_AGE_DAYS: '0' })).toMatchObject({ userAgentsOn: true, userAgentMinAccountDays: 0 });
  });

  it('reserves "new" for every username (the web page /agents/new would shadow an agent of that name)', () => {
    expect(isReservedUsername({ adminUsernames: ['admin'] }, 'New')).toBe(true);
    expect(isReservedUsername({ adminUsernames: ['admin'] }, 'newt')).toBe(false);
  });
});
