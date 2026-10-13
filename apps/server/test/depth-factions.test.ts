import { describe, it, expect, afterEach } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { depthTestCtx } from './depth-helpers.ts';
import { findCliques, averageInternal, localFactionName, formFactions, splitFactions, factionsModule, handleFactionMoment, FORM_AT } from '../src/agents/depth/factions.ts';
import { adjustAffinity } from '../src/agents/state.ts';
import { perceive, clearPerceptionCache } from '../src/agents/perceive.ts';
import { MOMENT_MAX_TOKENS } from '../src/agents/moments.ts';
import { HAIKU } from '../src/agents/haiku.ts';
import { FakeBrain, fakeReply } from '../src/world/brain.ts';
import { Budget } from '../src/world/budget.ts';
import { agentTurns, conversationMembers, factionMembers, factions, posts } from '../src/db/schema.ts';
import { act } from '../src/agents/act.ts';
import { ONE_SHOT_MAX_TEXT, oneShotTool } from '../src/agents/depth/system.ts';
import type { Moment } from '../src/agents/types.ts';

let ctx: Awaited<ReturnType<typeof depthTestCtx>> | undefined;
afterEach(() => { ctx?.t.close(); ctx = undefined; });

const graph = (pairs: [string, string, number][]) => {
  const m = new Map<string, Map<string, number>>();
  for (const [a, b, s] of pairs) { if (!m.has(a)) m.set(a, new Map()); m.get(a)!.set(b, s); }
  return m;
};
const mutual = (ids: string[], s: number) => ids.flatMap((a) => ids.filter((b) => b !== a).map((b) => [a, b, s] as [string, string, number]));
type Ctx = Awaited<ReturnType<typeof depthTestCtx>>;
const love = async (c: Ctx, group: { id: string }[], s: number) => {
  for (const a of group) for (const b of group) if (a !== b) await adjustAffinity(c.t.db, a.id, b.id, s, c.t.clock.now());
};

describe('cliques', () => {
  it('finds groups of 3+ with mutual affinity ≥ 0.5 and ignores one-sided love', () => {
    const g = graph([...mutual(['a', 'b', 'c'], 0.6), ['d', 'a', 0.9], ['d', 'b', 0.9], ['d', 'c', 0.9]]);
    expect(findCliques(g, new Set())).toEqual([['a', 'b', 'c']]);
  });
  it('skips agents already in a faction and pairs below the threshold', () => {
    const g = graph([...mutual(['a', 'b', 'c'], 0.6), ...mutual(['x', 'y', 'z'], FORM_AT - 0.01)]);
    expect(findCliques(g, new Set(['a']))).toEqual([]);
  });
  it('averages internal affinity over ordered pairs', () => {
    expect(averageInternal(graph(mutual(['a', 'b', 'c'], 0.3)), ['a', 'b', 'c'])).toBeCloseTo(0.3);
  });
  it('names a faction deterministically without the model', () => {
    expect(localFactionName('01ABC')).toEqual(localFactionName('01ABC'));
    expect(localFactionName('01ABC').colour).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('formation and splits', () => {
  it('forms a faction with a group chat of its members, then splits when the love is gone', async () => {
    ctx = await depthTestCtx();
    const trio = ctx.agents.slice(0, 3);
    await love(ctx, trio, 0.7);
    const [id] = await formFactions(ctx.d);
    expect(id).toBeTruthy();
    const [f] = await ctx.t.db.select().from(factions).where(eq(factions.id, id!));
    expect(f!.conversationId).toBeTruthy();
    const chat = await ctx.t.db.select().from(conversationMembers).where(eq(conversationMembers.conversationId, f!.conversationId!));
    expect(chat.map((m) => m.userId).sort()).toEqual(trio.map((a) => a.id).sort());
    expect(await formFactions(ctx.d)).toEqual([]);
    await love(ctx, trio, -0.6);
    expect(await splitFactions(ctx.d)).toEqual([id]);
    const live = await ctx.t.db.select().from(factionMembers).where(isNull(factionMembers.leftAt));
    expect(live).toEqual([]);
  });
  it('gives members faction chat and faction-coin candidates', () => {
    const v = { state: { traits: { chattiness: 0.8, loyalty: 0.9, pettiness: 0.1 } }, feed: [], wallet: { lamports: 100_000_000 },
      depth: { faction: { id: 'f', name: 'F', conversationId: 'c1', coinMint: 'M1', memberIds: ['me', 'x'], rivalMemberIds: [] } } } as never;
    const cs = factionsModule.candidates!(v, () => 0.5);
    expect(cs.map((c) => [c.kind, c.situation ?? null, c.target?.conversationId ?? c.target?.mint])).toEqual([
      ['chat', 'faction_cheer', 'c1'], ['buy', null, 'M1'],
    ]);
  });
  it('roasts the recent posts of rival faction members', () => {
    const v = { state: { traits: { chattiness: 0.8, loyalty: 0.9, pettiness: 0.6 } }, wallet: { lamports: 0 },
      feed: [{ postId: 'p1', authorId: 'r1' }, { postId: 'p2', authorId: 'friend' }, { postId: 'p3', authorId: 'r2' }, { postId: 'p4', authorId: 'r1' }],
      depth: { faction: { id: 'f', name: 'F', conversationId: null, coinMint: null, memberIds: ['me'], rivalMemberIds: ['r1', 'r2'] } } } as never;
    expect(factionsModule.candidates!(v, () => 0.5).map((c) => [c.kind, c.situation, c.target?.postId])).toEqual([['reply', 'roast', 'p1'], ['reply', 'roast', 'p3']]);
  });
  it('never roasts a rival’s post it already answered, or a human’s (engine M2)', () => {
    const v = { state: { traits: { chattiness: 0.8, loyalty: 0.9, pettiness: 0.6 } }, wallet: { lamports: 0 },
      feed: [{ postId: 'p1', authorId: 'r1', replied: true }, { postId: 'p2', authorId: 'r2', isAgent: false }, { postId: 'p3', authorId: 'r2' }, { postId: 'p4', authorId: 'r1' }, { postId: 'p5', authorId: 'r1' }],
      depth: { faction: { id: 'f', name: 'F', conversationId: null, coinMint: null, memberIds: ['me'], rivalMemberIds: ['r1', 'r2'] } } } as never;
    expect(factionsModule.candidates!(v, () => 0.5).map((c) => c.target?.postId)).toEqual(['p3', 'p4']);
  });
  it('sees its faction and the members of a faction it hates as rivals', async () => {
    ctx = await depthTestCtx();
    const us = ctx.agents.slice(0, 3), them = ctx.agents.slice(3, 6);
    await love(ctx, us, 0.7);
    await love(ctx, them, 0.7);
    expect(await formFactions(ctx.d)).toHaveLength(2);
    for (const b of them) await adjustAffinity(ctx.t.db, us[0]!.id, b.id, -0.6, ctx.t.clock.now());
    clearPerceptionCache(ctx.t.db);
    const v = await perceive(ctx.d, us[0]!.id);
    expect(v.depth.faction!.memberIds.sort()).toEqual(us.map((a) => a.id).sort());
    expect(v.depth.faction!.rivalMemberIds.sort()).toEqual(them.map((a) => a.id).sort());
    // Only this agent's own feelings count: its friend does not hate them.
    const friend = await perceive(ctx.d, us[1]!.id);
    expect(friend.depth.faction!.rivalMemberIds).toEqual([]);
  });
});

describe('the faction moment', () => {
  const setup = async () => {
    ctx = await depthTestCtx();
    const trio = ctx.agents.slice(0, 3);
    await love(ctx, trio, 0.7);
    const [id] = await formFactions(ctx.d);
    const [f] = await ctx.t.db.select().from(factions).where(eq(factions.id, id!));
    const lead = (await ctx.t.db.select({ a: factionMembers.agentId }).from(factionMembers).where(eq(factionMembers.factionId, id!))).map((r) => r.a).sort()[0]!;
    const m: Moment = { kind: 'faction', agentId: lead, data: { factionId: id, key: id }, at: ctx.t.clock.now() };
    return { c: ctx, id: id!, f: f!, lead, m };
  };
  const named = (input: Record<string, unknown>) => new FakeBrain(() => fakeReply.tools({ name: 'found_faction', input }));
  const budgetOf = (c: Ctx, usd = 1) => new Budget(c.t.db, usd, c.t.clock.now, { hardStop: true });

  it('the founder names the faction and posts a manifesto, with one capped, receipted call', async () => {
    const { c, id, lead, m } = await setup();
    const brain = named({ name: 'The Moth Lodge', banner_brief: 'moths circling a lamp', colour: '#AA00FF', manifesto: 'we fly toward the light together' });
    const budget = budgetOf(c);
    await handleFactionMoment({ ...c.d, brain, budget }, m);
    expect(brain.calls).toHaveLength(1);
    expect(brain.calls[0]!.maxTokens).toBe(MOMENT_MAX_TOKENS);
    const [f] = await c.t.db.select().from(factions).where(eq(factions.id, id));
    expect([f!.name, f!.banner, f!.colour]).toEqual(['The Moth Lodge', 'moths circling a lamp', '#aa00ff']);
    const [post] = await c.t.db.select().from(posts).where(and(eq(posts.authorId, lead), eq(posts.body, 'we fly toward the light together')));
    expect(post).toBeTruthy();
    const receipts = await c.t.db.select().from(agentTurns).where(and(eq(agentTurns.agentId, lead), eq(agentTurns.model, HAIKU)));
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.status).toBe('quiet');
    expect(receipts[0]!.costUsd).toBeGreaterThan(0);
    expect(budget.spentToday()).toBeCloseTo(receipts[0]!.costUsd, 9);
  });
  it('keeps the local name and skips the manifesto when the model writes hostile text', async () => {
    const { c, id, f: before, lead, m } = await setup();
    await handleFactionMoment({ ...c.d, brain: named({ name: 'visit https://scam.example', banner_brief: '<script>', colour: 'red', manifesto: 'follow @someone now' }), budget: budgetOf(c) }, m);
    const [f] = await c.t.db.select().from(factions).where(eq(factions.id, id));
    expect([f!.name, f!.banner, f!.colour]).toEqual([before.name, '', before.colour]);
    expect(await c.t.db.select().from(posts).where(eq(posts.authorId, lead))).toEqual([]);
  });
  it('makes no call without budget, and none while the founder is mid-turn', async () => {
    const { c, id, f: before, m } = await setup();
    const brain = named({ name: 'Never', banner_brief: 'x', colour: '#000000', manifesto: 'x' });
    const broke = budgetOf(c);
    broke.add(1 - MOMENT_MAX_TOKENS * 0.5 / 1_000_000 / 2); // less than one worst-case call left
    await handleFactionMoment({ ...c.d, brain, budget: broke }, m);
    await handleFactionMoment({ ...c.d, busy: new Set([m.agentId]), brain, budget: budgetOf(c) }, m);
    expect(brain.calls).toHaveLength(0);
    const [f] = await c.t.db.select().from(factions).where(eq(factions.id, id));
    expect(f!.name).toBe(before.name);
  });
  it('sets the faction coin when a member launches one', async () => {
    const { c, id, lead } = await setup();
    clearPerceptionCache(c.t.db);
    const v = await perceive(c.d, lead);

    const r = await act(c.d, v, { kind: 'launch', score: 1, lamports: 0, reason: 'launching for the faction' });
    expect(r.ok).toBe(true);
    const [f] = await c.t.db.select().from(factions).where(eq(factions.id, id));
    expect(f!.coinMint).toBeTruthy();
  });
  it('chats in the faction group conversation (act passes conversation_id)', async () => {
    const { c, f, lead } = await setup();
    clearPerceptionCache(c.t.db);
    const v = await perceive(c.d, lead);

    const r = await act(c.d, v, { kind: 'chat', score: 1, situation: 'faction_cheer', target: { conversationId: f.conversationId! }, reason: 'checking in' });
    expect(r.error).toBeUndefined();
    expect(r.ok).toBe(true);
  });
  it('keeps a faction chat private once a human is in the conversation', async () => {
    const { c, f, lead } = await setup();
    const human = await c.t.createUser('nosy_human');
    await c.t.db.insert(conversationMembers).values({ conversationId: f.conversationId!, userId: human.id, joinedAt: c.t.clock.now() });
    clearPerceptionCache(c.t.db);
    const v = await perceive(c.d, lead);
    const r = await act(c.d, v, { kind: 'chat', score: 1, situation: 'faction_cheer', target: { conversationId: f.conversationId! }, reason: 'checking in' });
    expect(r.ok).toBe(true);
    expect([r.text, r.line]).toEqual([undefined, undefined]);
    const [t] = await c.t.db.select().from(agentTurns).where(eq(agentTurns.id, r.turnId));
    expect(t!.toolCalls).toEqual([{ name: 'chat', input: { private: true }, ok: true, result: { private: true } }]);
  });
});

describe('oneShotTool', () => {
  it('cleans each field to the caller\'s length and allows only the given mentions', async () => {
    ctx = await depthTestCtx();
    const a = ctx.agents[0]!;
    const brain = new FakeBrain(() => fakeReply.tools({ name: 'publish_paper', input: {
      headline: 'x'.repeat(100), meme: 'y'.repeat(600),
      stories: [{ title: 'hi @alice', body: 'ask @bob' }, { title: 'fine', body: 'see https://scam.example' }],
    } }));
    const out = await oneShotTool({ ...ctx.d, brain, budget: new Budget(ctx.t.db, 1, ctx.t.clock.now, { hardStop: true }) }, a.id, 'writing a paper',
      { system: [], tools: [], messages: [{ role: 'user', content: 'facts' }] }, 'publish_paper', { fields: { headline: 80, title: 10 }, mentions: ['alice'] });
    expect(brain.calls[0]!.maxTokens).toBe(MOMENT_MAX_TOKENS);
    expect(out).toEqual({
      headline: 'x'.repeat(80), meme: 'y'.repeat(ONE_SHOT_MAX_TEXT),
      stories: [{ title: 'hi @alice', body: null }, { title: 'fine', body: null }],
    });
  });
});
