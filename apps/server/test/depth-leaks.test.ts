import { describe, it, expect, afterEach } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { depthTestCtx } from './depth-helpers.ts';
import { isAllAgentConversation, leakable, leakBody, leaksModule } from '../src/agents/depth/leaks.ts';
import { DepthRegistry, emptyDepth } from '../src/agents/depth/registry.ts';
import { act } from '../src/agents/act.ts';
import { perceive } from '../src/agents/perceive.ts';
import { adjustAffinity, loadState } from '../src/agents/state.ts';
import { runTool } from '../src/world/tools.ts';
import { agentAffinity, conversationMembers, posts } from '../src/db/schema.ts';
import type { AgentView } from '../src/agents/types.ts';

let ctx: Awaited<ReturnType<typeof depthTestCtx>> | undefined;
afterEach(async () => { await ctx?.t.close(); ctx = undefined; });

async function dm(from: number, to: number, body: string) {
  const r = await runTool(await ctx!.ctxFor(ctx!.agents[from]!), 'start_dm', { username: ctx!.agents[to]!.username, body });
  return (r.result as { conversation_id: string }).conversation_id;
}

describe('leaks', () => {
  it('offers an all-agent DM with an enemy who wrote there', async () => {
    ctx = await depthTestCtx();
    const conv = await dm(1, 0, 'between us, I am dumping $MOTH tonight');
    await dm(1, 0, 'do not tell anyone');
    await dm(0, 1, 'my lips are sealed');
    expect(await isAllAgentConversation(ctx.t.db, conv)).toBe(true);
    expect(await leakable(ctx.t.db, ctx.agents[0]!.id, { [ctx.agents[1]!.id]: 0.2 })).toEqual([]);
    const l = await leakable(ctx.t.db, ctx.agents[0]!.id, { [ctx.agents[1]!.id]: -0.7 });
    expect(l).toHaveLength(1);
    expect(l[0]!.targetId).toBe(ctx.agents[1]!.id);
    expect(l[0]!.lines.map((x) => x.body)).toContain('between us, I am dumping $MOTH tonight');
  });
  it('never offers a conversation that includes a human (privacy)', async () => {
    ctx = await depthTestCtx();
    const human = await ctx.t.createUser('real_person');
    const agent = ctx.agents[0]!, enemy = ctx.agents[1]!;
    const g = await runTool(await ctx.ctxFor(agent), 'start_group', { name: 'mixed', usernames: [enemy.username] });
    const conv = (g.result as { conversation_id: string }).conversation_id;
    // The rule must hold however a human got into the conversation.
    await ctx.t.db.insert(conversationMembers).values({ conversationId: conv, userId: human.id, joinedAt: ctx.t.clock.now() }).onConflictDoNothing();
    await runTool(await ctx.ctxFor(enemy), 'chat', { channel_id: null, conversation_id: conv, body: 'secret one', reply_to_id: null });
    await runTool(await ctx.ctxFor(enemy), 'chat', { channel_id: null, conversation_id: conv, body: 'secret two', reply_to_id: null });
    expect(await isAllAgentConversation(ctx.t.db, conv)).toBe(false);
    expect(await leakable(ctx.t.db, agent.id, { [enemy.id]: -0.9 })).toEqual([]);
  });
  it('never offers a group a human wrote in and then left (privacy)', async () => {
    ctx = await depthTestCtx();
    const human = await ctx.t.createUser('leaver');
    const agent = ctx.agents[0]!, enemy = ctx.agents[1]!;
    const g = await ctx.t.as(human).post('/api/conversations', { kind: 'group', name: 'trio', usernames: [agent.username, enemy.username] });
    const conv = g.body.conversation.id as string;
    expect((await ctx.t.as(human).post(`/api/conversations/${conv}/messages`, { body: 'my private words' })).status).toBeLessThan(400);
    await runTool(await ctx.ctxFor(enemy), 'chat', { channel_id: null, conversation_id: conv, body: 'agent words one', reply_to_id: null });
    await runTool(await ctx.ctxFor(enemy), 'chat', { channel_id: null, conversation_id: conv, body: 'agent words two', reply_to_id: null });
    expect((await ctx.t.as(human).del(`/api/conversations/${conv}/members/me`)).status).toBe(204);
    expect(await isAllAgentConversation(ctx.t.db, conv)).toBe(false);
    expect(await leakable(ctx.t.db, agent.id, { [enemy.id]: -0.9 })).toEqual([]);
  });
  it('fits a leak into 500 characters with the names shown', () => {
    const lines = Array.from({ length: 10 }, (_, i) => ({ authorId: 'e', body: `message number ${i} `.repeat(8), at: '' }));
    const body = leakBody(lines, new Map([['e', 'enemy']]), 'enemy', 'receipts 👀');
    expect(body.length).toBeLessThanOrEqual(500);
    expect(body).toContain('@enemy');
  });
  it('names the target once in the head when the intro already does', () => {
    const body = leakBody([{ authorId: 'e', body: 'hi', at: '' }], new Map([['e', 'enemy']]), 'enemy', 'receipts, since @enemy asked');
    expect(body.split('\n')[0]).toBe('receipts, since @enemy asked 👀');
    expect(leakBody([], new Map(), 'enemy', null).split('\n')[0]).toBe('leaking my DMs with @enemy 👀');
  });
  it('posts the leak and turns everyone against the target', async () => {
    ctx = await depthTestCtx();
    const conv = await dm(1, 0, 'I rugged $MOTH and nobody noticed');
    await dm(1, 0, 'keep it quiet');
    const me = ctx.agents[0]!, enemy = ctx.agents[1]!, bystander = ctx.agents[5]!;
    await adjustAffinity(ctx.t.db, me.id, enemy.id, -0.8, ctx.t.clock.now());
    const v = { agent: { id: me.id, username: me.username, displayName: me.displayName }, state: { traits: { pettiness: 0.9 }, cooldowns: {}, recentLines: [] },
      phrasebook: { voice: '', traits: {}, lines: {}, openers: [], closers: [], memeCaptions: [], interests: [] }, affinity: { [enemy.id]: -0.8 },
      depth: { ...emptyDepth(), leakable: await leakable(ctx.t.db, me.id, { [enemy.id]: -0.8 }) }, now: ctx.t.clock.now().toISOString() } as unknown as AgentView;
    const [c] = leaksModule.candidates!(v, () => 0.5);
    expect(c).toMatchObject({ kind: 'leak', target: { conversationId: conv, userId: enemy.id } });
    const turnCtx = await ctx.ctxFor(me);
    const r = await leaksModule.execute!(ctx.d, v, c!, (name, input) => runTool(turnCtx, name, input));
    expect(r).toMatchObject({ ok: true });
    expect(r!.text).toContain('I rugged $MOTH');
    // The intro fills {user} with @name, and the head does not add a second one.
    expect(r!.text!.split('\n')[0]!.split(`@${enemy.username}`)).toHaveLength(2);
    const [toLeaker] = await ctx.t.db.select().from(agentAffinity).where(and(eq(agentAffinity.agentId, enemy.id), eq(agentAffinity.otherId, me.id)));
    expect(toLeaker!.score).toBeCloseTo(-0.4);
    const [byBystander] = await ctx.t.db.select().from(agentAffinity).where(and(eq(agentAffinity.agentId, bystander.id), eq(agentAffinity.otherId, enemy.id)));
    expect(byBystander!.score).toBeCloseTo(-0.05);
    v.state.cooldowns = { leak: ctx.t.clock.now().toISOString() } as never;
    expect(leaksModule.candidates!(v, () => 0.5)).toEqual([]);
  });
  it('through act(), records the leak intro in recentLines so the no-reuse rule covers it', async () => {
    ctx = await depthTestCtx();
    await dm(1, 0, 'my bags are all fake volume');
    await dm(1, 0, 'never repeat that');
    const me = ctx.agents[0]!, enemy = ctx.agents[1]!;
    const d = { ...ctx.d, depth: new DepthRegistry([leaksModule]) };
    const v = await perceive(d, me.id);
    v.affinity = { ...v.affinity, [enemy.id]: -0.8 };
    v.state = { ...v.state, traits: { ...v.state.traits, pettiness: 0.9 } };
    v.depth.leakable = await leakable(ctx.t.db, me.id, v.affinity);
    const [c] = leaksModule.candidates!(v, () => 0.5);
    const r = await act(d, v, c!);
    expect(r.ok).toBe(true);
    expect(r.line?.situation).toBe('leak');
    const [post] = await ctx.t.db.select().from(posts).where(eq(posts.id, r.postId!));
    expect(post!.body).toContain('my bags are all fake volume');
    expect(post!.agentTurnId).toBe(r.turnId);
    const state = await loadState(ctx.t.db, me.id, ctx.t.clock.now());
    expect(state.recentLines).toContain(r.line!.key);
    expect(state.cooldowns.leak).toBeDefined();
  });
});
