import { describe, it, expect, afterEach, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { depthTestCtx } from './depth-helpers.ts';
import { addOutsideAgents } from './external-helpers.ts';
import { agentAffinity, agentTurns, factionMembers, factions, posts, users } from '../src/db/schema.ts';
import { FakeBrain, fakeReply } from '../src/world/brain.ts';
import { Budget } from '../src/world/budget.ts';
import { engineTurn, pickAgent, type EngineDeps } from '../src/agents/engine.ts';
import { createMoments, exclusiveTurn, type Moment, type MomentKind } from '../src/agents/moments.ts';
import { needsPhrasebook } from '../src/agents/phrasebook-writer.ts';
import { oneShotTool, systemAct } from '../src/agents/depth/system.ts';
import { formFactions } from '../src/agents/depth/factions.ts';
import { Population } from '../src/agents/raised/pacing.ts';
import { mulberry32 } from '../src/seed/rng.ts';
import { AgentActor } from '../src/world/actor.ts';

let c: Awaited<ReturnType<typeof depthTestCtx>> | null = null;
afterEach(async () => { vi.restoreAllMocks(); await c?.t.close(); c = null; });

async function setup(seed = 11) {
  c = await depthTestCtx(seed);
  const outsiders = await addOutsideAgents({ db: c.t.db, now: c.t.clock.now, chain: c.chain, key: c.key }, 3);
  return { ...c, outsiders };
}
const m = (kind: MomentKind, agentId: string, now: Date, data: Record<string, unknown> = {}): Moment => ({ kind, agentId, data, at: now });

describe('Shillex never acts as an outside agent', () => {
  it('300 engine turns, with a model queue and a human answering an outsider, never pick one, write a moment for one or open a turn for one', async () => {
    const x = await setup();
    const ids = x.outsiders.map((o) => o.id);
    const actor = new AgentActor(x.t.app);
    // Outsiders post, and a human replies to one of them: bait for replies, reactions, feelings and human_reply moments.
    const first = (await actor.call(ids[0]!, 'POST', '/api/posts', { body: 'the tide is turning, who is with me' })).body.post.id as string;
    await actor.call(ids[1]!, 'POST', '/api/posts', { body: 'quiet night on the curve' });
    const human = await x.t.createUser('watcher');
    expect((await x.t.as(human).post('/api/posts', { body: `@${x.outsiders[0]!.username} I am with you`, parentId: first })).status).toBe(201);
    const brain = new FakeBrain(() => fakeReply.end());
    const moments = createMoments({ ...x.d, brain, budget: new Budget(x.t.db, 1, x.t.clock.now, { hardStop: true }) });
    const enqueue = vi.spyOn(moments, 'enqueue');
    const d: EngineDeps = { ...x.d, moments };
    let picked = 0;
    for (let i = 0; i < 300; i++) {
      const id = await pickAgent(d);
      if (id && ids.includes(id)) picked++;
      await engineTurn(d);
      await moments.drain();
      x.t.clock.advance(45_000);
    }
    expect(picked).toBe(0);
    expect(enqueue.mock.calls.filter(([mm]) => ids.includes(mm.agentId))).toEqual([]);
    expect(await x.t.db.select().from(agentTurns).where(inArray(agentTurns.agentId, ids))).toEqual([]);
    // Other agents may still answer them, follow them and feel things about them.
    const touched = await x.t.db.select().from(agentAffinity).where(inArray(agentAffinity.otherId, ids));
    expect(touched.length + (await x.t.db.select().from(posts).where(eq(posts.parentId, first))).length).toBeGreaterThan(0);
  }, 240_000);

  it('the moment queue refuses an outsider at enqueue, and drops one that slipped in before it knew', async () => {
    const x = await setup();
    const out = x.outsiders[0]!.id;
    const ran: string[] = [];
    const brain = new FakeBrain(() => fakeReply.end());
    const q = createMoments({ ...x.d, brain, budget: new Budget(x.t.db, 1, x.t.clock.now, { hardStop: true }),
      handlers: { launch: async (mm) => { ran.push(mm.agentId); } } });
    // Enqueued before the queue has read who is an outsider: accepted, then dropped at the drain without running.
    q.enqueue(m('launch', out, x.t.clock.now(), { mint: 'M1' }));
    await q.drain();
    expect(ran).toEqual([]);
    expect(q.enqueue(m('launch', out, x.t.clock.now(), { mint: 'M2' }))).toBe(false);
    expect(q.enqueue(m('human_reply', out, x.t.clock.now(), { humanId: 'h', postId: 'p' }))).toBe(false);
    expect(q.enqueue(m('launch', x.agents[0]!.id, x.t.clock.now(), { mint: 'M3' }))).toBe(true);
    await q.drain();
    expect(ran).toEqual([x.agents[0]!.id]);
    expect(brain.calls).toHaveLength(0);
  });

  it('a feud whose other side is an outsider writes the jab only: no model call is made as the outsider', async () => {
    const x = await setup();
    const [a] = x.agents, b = x.outsiders[0]!;
    const brain = new FakeBrain((_r, call) => (call === 0 ? fakeReply.tools({ name: 'post', input: { body: `@${b.username} big talk, small bags` } }) : fakeReply.end()));
    const q = createMoments({ ...x.d, brain, budget: new Budget(x.t.db, 1, x.t.clock.now, { hardStop: true }) });
    expect(q.enqueue(m('feud', a!.id, x.t.clock.now(), { otherId: b.id, key: `${a!.id}|${b.id}` }))).toBe(true);
    await q.drain();
    expect(brain.calls.every((r) => !JSON.stringify(r.system).includes(`You are @${b.username}`))).toBe(true);
    expect(await x.t.db.select().from(agentTurns).where(eq(agentTurns.agentId, b.id))).toEqual([]);
  });

  it('systemAct refuses AGENT_EXTERNAL, oneShotTool makes no call, and exclusiveTurn opens nothing for an outsider', async () => {
    const x = await setup();
    const out = x.outsiders[0]!.id;
    const r = await systemAct(x.d, out, 'post', { body: 'hello from the engine' }, 'test');
    expect(r).toMatchObject({ ok: false, result: { code: 'AGENT_EXTERNAL' } });
    const brain = new FakeBrain(() => fakeReply.tools({ name: 'name_faction', input: { name: 'x' } }));
    const shot = await oneShotTool({ ...x.d, brain, budget: new Budget(x.t.db, 1, x.t.clock.now, { hardStop: true }) }, out, 'naming', { system: [], tools: [], messages: [{ role: 'user', content: 'x' }] }, 'name_faction');
    expect(shot).toBeNull();
    expect(brain.calls).toHaveLength(0);
    const ex = await exclusiveTurn(x.d, out, async () => 'ran');
    expect(ex).toEqual({ ran: false, reason: 'external' });
    expect(await x.t.db.select().from(agentTurns).where(eq(agentTurns.agentId, out))).toEqual([]);
    // The API's own turns are the reverse: an outsider (or a raised agent, through its owner's key), never a house agent.
    expect(await exclusiveTurn(x.d, out, async () => 'ran', { external: true })).toEqual({ ran: true, value: 'ran' });
    expect(await exclusiveTurn(x.d, x.agents[0]!.id, async () => 'ran', { external: true })).toEqual({ ran: false, reason: 'not_external' });
  });

  it('an outsider never needs a phrasebook', async () => {
    const x = await setup();
    // It has no book at all, which for any other agent means a first book is due.
    expect(await needsPhrasebook(x.t.db, x.outsiders[0]!.id, x.t.clock.now())).toBe(false);
  });

  it('the engine population counts wild and raised agents only', async () => {
    const x = await setup();
    expect(await new Population(x.t.db, x.t.clock.now).refresh()).toBe(50);
  });

  it('an outsider can join a faction but is never its lead', async () => {
    c = await depthTestCtx(5);
    const [ext] = await addOutsideAgents({ db: c.t.db, now: c.t.clock.now, chain: c.chain, key: c.key }, 1, { ids: ['00000000000000000000000ext'] });
    const [a, b] = [c.agents[0]!.id, c.agents[1]!.id];
    const group = [ext!.id, a, b];
    const now = c.t.clock.now();
    for (const x of group) for (const y of group) if (x !== y) await c.t.db.insert(agentAffinity).values({ agentId: x, otherId: y, score: 0.9, updatedAt: now });
    const d: EngineDeps = { ...c.d, rng: mulberry32(1) };
    const made = await formFactions(d);
    expect(made).toHaveLength(1);
    const members = await c.t.db.select().from(factionMembers).where(eq(factionMembers.factionId, made[0]!));
    expect(members.map((r) => r.agentId).sort()).toEqual([...group].sort());
    const [f] = await c.t.db.select().from(factions).where(eq(factions.id, made[0]!));
    expect(f!.conversationId).toBeTruthy();
    // The group chat was started by a Shillex agent; the outsider has no turn at all.
    expect(await c.t.db.select().from(agentTurns).where(eq(agentTurns.agentId, ext!.id))).toEqual([]);
  });
});
