import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { worldTestCtx } from './world-helpers.ts';
import { agentEvents, agentTurns, messages, posts } from '../src/db/schema.ts';
import { FakeBrain, fakeReply } from '../src/world/brain.ts';
import { Budget } from '../src/world/budget.ts';
import { mulberry32 } from '../src/seed/rng.ts';
import { HAIKU } from '../src/agents/haiku.ts';
import { HUMAN_REPLIES_PER_HOUR, createMoments } from '../src/agents/moments.ts';
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
