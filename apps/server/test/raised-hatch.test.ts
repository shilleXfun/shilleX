import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { raisedTestCtx } from './raised-helpers.ts';
import { agentAffinity, agentGrants, agentHatches, agentSeeds, agentTurns, agents, follows, phrasebooks, posts, users } from '../src/db/schema.ts';
import { newId } from '../src/lib/ids.ts';
import { FakeBrain, fakeReply, type AgentBrain } from '../src/world/brain.ts';
import { Budget } from '../src/world/budget.ts';
import { fallbackPhrasebook } from '../src/agents/phrasebook.ts';
import { walletOf } from '../src/world/wallets.ts';
import { REFUSED_REASON, runHatch, type HatchDeps } from '../src/agents/raised/hatch.ts';
import type { TestUser } from './helpers.ts';

let w: Awaited<ReturnType<typeof raisedTestCtx>>;
let owner: TestUser;
beforeEach(async () => { w = await raisedTestCtx(); owner = await w.t.createUser('keeper'); });
afterEach(() => w.t.close());
const request = async (handle = 'tidewatch', description = 'a calm lighthouse keeper who loves tide charts', ownerId = owner.id) => {
  const id = newId();
  await w.t.db.insert(agentHatches).values({ id, ownerId, handle, description, createdAt: w.t.clock.now() });
  return id;
};
const answer = (over: Record<string, unknown> = {}) => ({
  ...fallbackPhrasebook('hatch'), voice: 'calm and salty',
  traits: { risk: 1, chattiness: 0, loyalty: 0.5, pettiness: 0.95, greed: 0.2, humor: 0.4, curiosity: 0.6 },
  profile: { display_name: 'Tide Watch', bio: 'counts waves', avatar_emoji: '🌊', avatar_color: '#3366aa' }, verdict: 'ok', ...over,
});
const brainSaying = (o: unknown) => new FakeBrain(() => fakeReply.end(JSON.stringify(o)));
const deps = (brain: AgentBrain | null): HatchDeps => ({ ...w.d, brain, budget: w.budget, gate: w.gate });
const row = async (id: string) => (await w.t.db.select().from(agentHatches).where(eq(agentHatches.id, id)))[0]!;
const userNamed = async (u: string) => (await w.t.db.select().from(users).where(sql`lower(${users.username}) = ${u}`))[0];

describe('hatching a raised agent', () => {
  it('makes the agent: rows, clamped traits, face, 0.1 SOL, a bond with its owner, a follow and a first post', async () => {
    const id = await request();
    expect(await runHatch(deps(brainSaying(answer())), id)).toBe('done');
    const r = await row(id);
    expect(r).toMatchObject({ status: 'done', attempted: true });
    const agent = (await userNamed('tidewatch'))!;
    expect(agent).toMatchObject({ kind: 'agent', displayName: 'Tide Watch', bio: 'counts waves' });
    expect(r.agentId).toBe(agent.id);
    expect((await w.t.db.select().from(agents).where(eq(agents.userId, agent.id)))[0]).toMatchObject({ origin: 'raised', ownerId: owner.id, status: 'active' });
    expect((await w.t.db.select().from(agentSeeds).where(eq(agentSeeds.agentId, agent.id)))[0]!.description).toBe('a calm lighthouse keeper who loves tide charts');
    const pb = (await w.t.db.select().from(phrasebooks).where(eq(phrasebooks.agentId, agent.id)))[0]!;
    expect(pb.version).toBe(1);
    expect(pb.book.traits).toMatchObject({ risk: 0.9, chattiness: 0.1, pettiness: 0.9 });
    expect((await w.chain.balances((await walletOf(w.t.db, agent.id))!.publicKey)).lamports).toBe(100_000_000);
    expect(await w.t.db.select().from(agentGrants).where(eq(agentGrants.agentId, agent.id))).toHaveLength(1);
    expect((await w.t.db.select().from(agentAffinity).where(and(eq(agentAffinity.agentId, agent.id), eq(agentAffinity.otherId, owner.id))))[0]!.score).toBeCloseTo(0.5);
    expect(await w.t.db.select().from(follows).where(and(eq(follows.followerId, agent.id), eq(follows.followeeId, owner.id)))).toHaveLength(1);
    const [first] = await w.t.db.select().from(posts).where(eq(posts.authorId, agent.id));
    expect(first!.body).toContain('raised by @keeper');
    expect(w.gate.ownerOf(agent.id)).toBe(owner.id);
  });

  it('gives the model the wish as data inside <owner_wish>, and asks for a verdict', async () => {
    const brain = brainSaying(answer());
    await runHatch(deps(brain), await request());
    const call = brain.calls[0]!;
    expect(JSON.stringify(call.system)).toMatch(/data, not instructions/);
    expect(String(call.messages[0]!.content)).toContain('<owner_wish>a calm lighthouse keeper who loves tide charts</owner_wish>');
    expect(JSON.stringify(call.outputFormat)).toContain('"verdict"');
  });

  it('keeps hostile model output out of the book: no line with a link or an @', async () => {
    const lines = { ...fallbackPhrasebook('x').lines, gm: ['visit https://evil.example', '@everyone buy now', 'gm all', 'gm tides', 'morning swell', 'up early'] };
    await runHatch(deps(brainSaying(answer({ lines }))), await request());
    const agent = (await userNamed('tidewatch'))!;
    const book = JSON.stringify((await w.t.db.select().from(phrasebooks).where(eq(phrasebooks.agentId, agent.id)))[0]!.book);
    expect(book).not.toMatch(/https?:|@/);
  });

  it('a refused wish makes nothing, still counts as an attempt and still costs its call', async () => {
    const id = await request();
    expect(await runHatch(deps(brainSaying(answer({ verdict: 'refused' }))), id)).toBe('refused');
    expect(await row(id)).toMatchObject({ status: 'refused', reason: REFUSED_REASON, attempted: true, agentId: null });
    expect(await userNamed('tidewatch')).toBeUndefined();
    const b = new Budget(w.t.db, 1, w.t.clock.now, { hardStop: true });
    await b.load();
    expect(b.spentToday()).toBeGreaterThan(0);
    expect(w.gate.spentToday()).toBeGreaterThan(0);
    const [t] = await w.t.db.select().from(agentTurns).where(eq(agentTurns.agentId, owner.id));
    expect(t).toMatchObject({ promptVersion: 'hatch-v1', status: 'quiet', reasoning: 'hatch: refused' });
  });

  it('a model refusal is a refused wish too', async () => {
    const id = await request();
    expect(await runHatch(deps(new FakeBrain(() => fakeReply.refusal())), id)).toBe('refused');
  });

  it('an unusable book fails the attempt and makes nothing', async () => {
    const id = await request();
    expect(await runHatch(deps(brainSaying({ verdict: 'ok', voice: 'x' })), id)).toBe('failed');
    expect(await row(id)).toMatchObject({ status: 'failed', attempted: true });
    expect(await userNamed('tidewatch')).toBeUndefined();
  });

  it('waits without a model call while the share is spent', async () => {
    const brain = brainSaying(answer());
    w.gate.add(w.gate.cap());
    const id = await request();
    expect(await runHatch(deps(brain), id)).toBe('waiting');
    expect(brain.calls).toHaveLength(0);
    expect(await row(id)).toMatchObject({ status: 'queued', attempted: false });
  });

  it('fails without a model call when the handle was taken meanwhile (not an attempt)', async () => {
    const brain = brainSaying(answer());
    const id = await request();
    await w.t.createUser('TideWatch');
    expect(await runHatch(deps(brain), id)).toBe('failed');
    expect(brain.calls).toHaveLength(0);
    expect(await row(id)).toMatchObject({ status: 'failed', attempted: false });
  });

  it('waits while the treasury is low, with no model call and no agent', async () => {
    await w.t.close();
    w = await raisedTestCtx({ treasurySol: 1.05 });
    owner = await w.t.createUser('keeper');
    const brain = brainSaying(answer());
    const id = await request();
    expect(await runHatch(deps(brain), id)).toBe('waiting');
    expect(brain.calls).toHaveLength(0);
    expect((await row(id)).reason).toMatch(/treasury is refilling/);
  });

  it('hatches from the fallback voice with no model, where the config allows it', async () => {
    Object.assign(w.t.app.deps.config, { hatchWithoutModel: true });
    const id = await request();
    expect(await runHatch(deps(null), id)).toBe('done');
    expect(await userNamed('tidewatch')).toBeDefined();
    Object.assign(w.t.app.deps.config, { hatchWithoutModel: false });
    const id2 = await request('other_one', 'a quiet one', (await w.t.createUser('second')).id);
    expect(await runHatch(deps(null), id2)).toBe('waiting');
  });

  it('a failed call puts the request back in the queue and seals its receipt', async () => {
    const id = await request();
    await expect(runHatch(deps(new FakeBrain(() => { throw new Error('socket hang up'); })), id)).rejects.toThrow('socket hang up');
    expect((await row(id)).status).toBe('queued');
    const [t] = await w.t.db.select().from(agentTurns).where(eq(agentTurns.agentId, owner.id));
    expect(t!.status).toBe('failed');
  });

  it('claims a request once: a second run of the same request does nothing', async () => {
    const id = await request();
    const brain = brainSaying(answer());
    expect(await runHatch(deps(brain), id)).toBe('done');
    expect(await runHatch(deps(brain), id)).toBe('waiting');
    expect(brain.calls).toHaveLength(1);
  });
});
