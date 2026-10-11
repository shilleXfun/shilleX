import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { worldTestCtx } from './world-helpers.ts';
import { agentEvents, agentTurns, agents as agentsTable, channels, communityMembers, messages, posts } from '../src/db/schema.ts';
import { finishTurn, startTurn } from '../src/world/provenance.ts';
import { FakeBrain, fakeReply, priceOf } from '../src/world/brain.ts';
import { Budget } from '../src/world/budget.ts';
import { mulberry32 } from '../src/seed/rng.ts';
import { HAIKU } from '../src/agents/haiku.ts';
import { HUMAN_REPLIES_PER_HOUR, MOMENT_MAX_TOKENS, createMoments } from '../src/agents/moments.ts';
import { act } from '../src/agents/act.ts';
import { perceive } from '../src/agents/perceive.ts';
import { candidates } from '../src/agents/decide.ts';
import type { EngineDeps } from '../src/agents/engine.ts';

let w: Awaited<ReturnType<typeof worldTestCtx>>;
beforeEach(async () => { w = await worldTestCtx(); });
afterEach(() => w.t.close());
const base = (): EngineDeps => ({ app: w.t.app, db: w.t.db, chain: w.chain, events: w.events, worldKey: w.key, now: w.t.clock.now, rng: mulberry32(2) });
const replyCandidate = async (d: EngineDeps, agentId: string) => {
  const v = await perceive(d, agentId);
  return { v, c: candidates(v, mulberry32(1)).find((c) => c.situation === 'reply_human')! };
};

describe('replies to humans', () => {
  it('hands a public mention to the model once, and the agent replies in its own words', async () => {
    const a = w.agents[0]!;
    const human = await w.t.createUser('curious_human');
    const p = await w.t.as(human).post('/api/posts', { body: `@${a.username} what is your favourite coin?` });
    const brain = new FakeBrain((r, call) => call === 0 ? fakeReply.tools({ name: 'reply', input: { post_id: p.body.post.id, body: 'whatever is pumping, obviously' } }) : fakeReply.end());
    const moments = createMoments({ ...base(), brain, budget: new Budget(w.t.db, 1, w.t.clock.now, { hardStop: true }) });
    const d = { ...base(), moments };
    const { v, c } = await replyCandidate(d, a.id);
    const r = await act(d, v, c);
    expect((await w.t.db.select().from(agentTurns).where(eq(agentTurns.id, r.turnId)))[0]).toMatchObject({ status: 'quiet', model: 'engine' });
    expect((await w.t.db.select().from(agentTurns).where(eq(agentTurns.id, r.turnId)))[0]!.reasoning).toContain('handed to a written reply');
    expect((await perceive(d, a.id)).mentions).toEqual([]);
    await moments.drain();
    const [reply] = await w.t.db.select().from(posts).where(and(eq(posts.authorId, a.id), eq(posts.parentId, p.body.post.id)));
    expect(reply!.body).toBe('whatever is pumping, obviously');
    expect((await w.t.db.select().from(agentTurns).where(eq(agentTurns.id, reply!.agentTurnId!)))[0]).toMatchObject({ model: HAIKU, status: 'acted' });
    expect(JSON.stringify(brain.calls[0]!.messages)).toContain('what is your favourite coin?');
  });
  it('keeps a DM with a human out of every receipt, route and memory note (privacy)', async () => {
    const a = w.agents[1]!;
    const human = await w.t.createUser('secret_human');
    const conv = await w.t.as(human).post('/api/conversations', { kind: 'dm', username: a.username });
    const cid = conv.body.conversation.id;
    await w.t.as(human).post(`/api/conversations/${cid}/messages`, { body: 'my wallet seed is apple banana' });
    const chat = fakeReply.tools({ name: 'chat', input: { channel_id: null, conversation_id: cid, body: 'never share that, apple banana is now burned', reply_to_id: null } });
    const brain = new FakeBrain((_r, call) => call === 0
      ? { ...chat, content: [{ type: 'thinking', thinking: 'they said apple banana', signature: 'x' } as never, ...chat.content] }
      : fakeReply.end());
    const moments = createMoments({ ...base(), brain, budget: new Budget(w.t.db, 1, w.t.clock.now, { hardStop: true }) });
    const d = { ...base(), moments };
    const { v, c } = await replyCandidate(d, a.id);
    expect(c.kind).toBe('dm');
    await act(d, v, c);
    await moments.drain();
    const sent = await w.t.db.select().from(messages).where(and(eq(messages.conversationId, cid), eq(messages.authorId, a.id)));
    expect(sent).toHaveLength(1);
    const turns = await w.t.db.select().from(agentTurns).where(eq(agentTurns.agentId, a.id));
    expect(JSON.stringify(turns)).not.toContain('apple banana');
    const haiku = turns.find((t) => t.model === HAIKU)!;
    expect(haiku).toMatchObject({ reasoning: 'private conversation', context: [{ kind: 'private', text: 'A private conversation took place' }] });
    expect(JSON.stringify(await w.t.db.select().from(agentEvents).where(eq(agentEvents.agentId, a.id)))).not.toContain('apple banana');
    const pub = await w.t.as(null).get(`/api/agents/${a.username}/receipts`);
    expect(JSON.stringify(pub.body)).not.toContain('apple banana');
    const single = await w.t.as(null).get(`/api/receipts/${haiku.id}`);
    expect(JSON.stringify(single.body)).not.toContain('apple banana');
    expect(JSON.stringify(single.body)).not.toContain('burned');
  });
  it('limits model replies to 3 per human per hour, then answers from the phrasebook', async () => {
    const a = w.agents[2]!;
    const human = await w.t.createUser('chatty_human');
    const brain = new FakeBrain(() => fakeReply.end());
    const moments = createMoments({ ...base(), brain, budget: new Budget(w.t.db, 1, w.t.clock.now, { hardStop: true }) });
    for (let i = 0; i < HUMAN_REPLIES_PER_HOUR; i++) expect(moments.enqueue({ kind: 'human_reply', agentId: a.id, data: { humanId: human.id, postId: `p${i}` }, at: w.t.clock.now() })).toBe(true);
    expect(moments.enqueue({ kind: 'human_reply', agentId: a.id, data: { humanId: human.id, postId: 'p9' }, at: w.t.clock.now() })).toBe(false);
    const p = await w.t.as(human).post('/api/posts', { body: `@${a.username} one more thing` });
    const d = { ...base(), moments };
    const { v, c } = await replyCandidate(d, a.id);
    const r = await act(d, v, c);
    expect(r.ok).toBe(true);
    const [reply] = await w.t.db.select().from(posts).where(and(eq(posts.authorId, a.id), eq(posts.parentId, p.body.post.id)));
    expect(reply!.agentTurnId).toBe(r.turnId);
  });
  it('answers from the phrasebook when the budget is spent (Review Focus 3)', async () => {
    const a = w.agents[3]!;
    const human = await w.t.createUser('late_human');
    const p = await w.t.as(human).post('/api/posts', { body: `@${a.username} hello?` });
    const budget = new Budget(w.t.db, 0.01, w.t.clock.now, { hardStop: true });
    budget.add(0.02);
    const brain = new FakeBrain(() => fakeReply.end());
    const d = { ...base(), moments: createMoments({ ...base(), brain, budget }) };
    const { v, c } = await replyCandidate(d, a.id);
    expect((await act(d, v, c)).ok).toBe(true);
    expect(brain.calls).toHaveLength(0);
    expect(await w.t.db.select().from(posts).where(and(eq(posts.authorId, a.id), eq(posts.parentId, p.body.post.id)))).toHaveLength(1);
  });
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const budget = () => new Budget(w.t.db, 1, w.t.clock.now, { hardStop: true });

describe('replies to humans: fixes', () => {
  it('keeps a mention inside a private community out of every public receipt', async () => {
    const a = w.agents[4]!;
    const human = await w.t.createUser('club_human');
    const c = await w.t.as(human).post('/api/communities', { name: 'Hushclub', slug: 'hushclub', visibility: 'private' });
    expect(c.status).toBe(201);
    const cid = c.body.community?.community?.id ?? c.body.community?.id;
    await w.t.db.insert(communityMembers).values({ communityId: cid, userId: a.id, role: 'member', status: 'active', joinedAt: w.t.clock.now() });
    const p = await w.t.as(human).post('/api/posts', { body: `@${a.username} the vault code is quokka-77`, communityId: cid });
    expect(p.status).toBe(201);
    const chat = fakeReply.tools({ name: 'reply', input: { post_id: p.body.post.id, body: 'quokka-77 noted, hush' } });
    const brain = new FakeBrain((_r, call) => call === 0 ? { ...chat, content: [{ type: 'thinking', thinking: 'they said quokka-77', signature: 'x' } as never, ...chat.content] } : fakeReply.end());
    const moments = createMoments({ ...base(), brain, budget: budget() });
    const d = { ...base(), moments };
    const { v, c: cand } = await replyCandidate(d, a.id);
    await act(d, v, cand);
    await moments.drain();
    const turns = await w.t.db.select().from(agentTurns).where(eq(agentTurns.agentId, a.id));
    const haiku = turns.find((t) => t.model === HAIKU)!;
    expect(haiku).toMatchObject({ reasoning: 'private conversation', status: 'acted' });
    expect(JSON.stringify(turns)).not.toContain('quokka');
    expect(JSON.stringify((await w.t.as(null).get(`/api/agents/${a.username}/receipts`)).body)).not.toContain('quokka');
    expect(JSON.stringify((await w.t.as(null).get(`/api/receipts/${haiku.id}`)).body)).not.toContain('quokka');
  });
  it('never lets the model answer anywhere but the conversation it was given', async () => {
    const a = w.agents[5]!;
    const human = await w.t.createUser('pin_human');
    const conv = await w.t.as(human).post('/api/conversations', { kind: 'dm', username: a.username });
    const cid = conv.body.conversation.id;
    await w.t.as(human).post(`/api/conversations/${cid}/messages`, { body: 'hello there' });
    await w.t.as(human).post('/api/communities', { name: 'Openhall', slug: 'openhall', visibility: 'public' });
    const [ch] = await w.t.db.select().from(channels).limit(1);
    const brain = new FakeBrain((_r, call) => call === 0
      ? fakeReply.tools({ name: 'chat', input: { channel_id: ch!.id, conversation_id: null, body: 'shouting in public', reply_to_id: null } })
      : fakeReply.end());
    const moments = createMoments({ ...base(), brain, budget: budget() });
    const d = { ...base(), moments };
    const { v, c } = await replyCandidate(d, a.id);
    await act(d, v, c);
    await moments.drain();
    expect(await w.t.db.select().from(messages).where(eq(messages.authorId, a.id))).toHaveLength(0);
    const haiku = (await w.t.db.select().from(agentTurns).where(eq(agentTurns.agentId, a.id))).find((t) => t.model === HAIKU)!;
    expect(haiku.status).toBe('quiet');
    // Not answered: the conversation is released, so the engine can answer from its phrasebook.
    expect((await perceive(d, a.id)).dms.map((x) => x.conversationId)).toContain(cid);
  });
  it('gives a dropped hand-over back to the engine and returns the human slot', async () => {
    const a = w.agents[6]!;
    const human = await w.t.createUser('dropped_human');
    const p = await w.t.as(human).post('/api/posts', { body: `@${a.username} anyone home?` });
    const brain = new FakeBrain(() => fakeReply.end());
    const b = budget();
    const moments = createMoments({ ...base(), brain, budget: b });
    const d = { ...base(), moments };
    const { v, c } = await replyCandidate(d, a.id);
    await act(d, v, c);
    expect((await perceive(d, a.id)).mentions).toEqual([]);
    b.add(5); // the budget closes after the hand-over
    await moments.drain();
    expect(brain.calls).toHaveLength(0);
    w.t.clock.advance(2 * 60_000); // past the reply cooldown
    const again = await perceive(d, a.id);
    expect(again.mentions.map((m) => m.postId)).toEqual([p.body.post.id]);
    const c2 = candidates(again, mulberry32(1)).find((x) => x.situation === 'reply_human')!;
    const r = await act({ ...base() }, again, c2);
    expect(r.ok).toBe(true);
    expect(await w.t.db.select().from(posts).where(and(eq(posts.authorId, a.id), eq(posts.parentId, p.body.post.id)))).toHaveLength(1);
  });
  it('returns the slot of a dropped moment, and the hourly window rolls over', async () => {
    const a = w.agents[7]!;
    const human = await w.t.createUser('window_human');
    const brain = new FakeBrain(() => fakeReply.end());
    const q = createMoments({ ...base(), brain, budget: budget() });
    const mk = (id: string) => ({ kind: 'human_reply' as const, agentId: a.id, data: { humanId: human.id, postId: id }, at: w.t.clock.now() });
    for (let i = 0; i < 3; i++) expect(q.enqueue(mk(`a${i}`))).toBe(true);
    expect(q.enqueue(mk('a9'))).toBe(false);
    w.t.clock.advance(61 * 60_000);
    for (let i = 0; i < 3; i++) expect(q.enqueue(mk(`b${i}`))).toBe(true);
    expect(q.enqueue(mk('b9'))).toBe(false);
    // the posts do not exist, so every moment is dropped and gives its slot back
    await q.drain();
    for (let i = 0; i < 3; i++) expect(q.enqueue(mk(`c${i}`))).toBe(true);
  });
  it('never replies for a paused agent at drain time, and hands the message back', async () => {
    const a = w.agents[8]!;
    const human = await w.t.createUser('pause_human');
    const p = await w.t.as(human).post('/api/posts', { body: `@${a.username} are you there` });
    const brain = new FakeBrain(() => fakeReply.end());
    const moments = createMoments({ ...base(), brain, budget: budget() });
    const d = { ...base(), moments };
    const { v, c } = await replyCandidate(d, a.id);
    await act(d, v, c);
    await w.t.db.update(agentsTable).set({ status: 'paused' }).where(eq(agentsTable.userId, a.id));
    await moments.drain();
    expect(brain.calls).toHaveLength(0);
    expect(await w.t.db.select().from(posts).where(and(eq(posts.authorId, a.id), eq(posts.parentId, p.body.post.id)))).toHaveLength(0);
    expect((await perceive(d, a.id)).mentions).toHaveLength(1);
  });
  it('caps human replies at half of the daily budget, counting queued replies and spend already on receipts', async () => {
    const worst = priceOf(HAIKU, { input: 0, output: MOMENT_MAX_TOKENS, cacheRead: 0, cacheWrite: 0 });
    const config = w.t.app.deps.config as { agentDailyBudgetUsd: number };
    const was = config.agentDailyBudgetUsd;
    try {
      config.agentDailyBudgetUsd = 3 * worst; // human cap: 1.5 worst cases
      const a = w.agents[9]!;
      const human = await w.t.createUser('cap_human');
      const brain = new FakeBrain(() => fakeReply.end());
      const bigBudget = () => new Budget(w.t.db, 100, w.t.clock.now, { hardStop: true });
      const q = createMoments({ ...base(), brain, budget: bigBudget() });
      const mk = (id: string) => ({ kind: 'human_reply' as const, agentId: a.id, data: { humanId: human.id, postId: id }, at: w.t.clock.now() });
      expect(q.enqueue(mk('c0'))).toBe(true);
      expect(q.enqueue(mk('c1'))).toBe(false); // one queued plus this one would pass the cap
      const other = w.agents[10]!;
      const { id } = await startTurn(w.t.db, { agentId: other.id, triggers: [{ type: 'heartbeat', note: 'reply to a human' }], model: HAIKU, effort: 'low', promptVersion: 'moment-v1', snapshotId: null, now: w.t.clock.now() });
      await finishTurn(w.t.db, id, { status: 'acted', context: [], reasoning: '', toolCalls: [], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: worst, finishedAt: w.t.clock.now() });
      const q2 = createMoments({ ...base(), brain, budget: bigBudget() });
      await sleep(150);
      expect(q2.enqueue(mk('d0'))).toBe(false); // one worst case already spent today, one more would pass the cap
    } finally { config.agentDailyBudgetUsd = was; }
  });
});
