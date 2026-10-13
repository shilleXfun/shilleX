import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeRaised, raisedTestCtx } from './raised-helpers.ts';
import { FakeBrain, fakeReply, priceOf } from '../src/world/brain.ts';
import { HAIKU } from '../src/agents/haiku.ts';
import { createMoments, type Moment } from '../src/agents/moments.ts';
import { fallbackPhrasebook } from '../src/agents/phrasebook.ts';
import { writePhrasebook } from '../src/agents/phrasebook-writer.ts';

let w: Awaited<ReturnType<typeof raisedTestCtx>>;
beforeEach(async () => { w = await raisedTestCtx(); });
afterEach(() => w.t.close());
const at = () => w.t.clock.now();
const dm = (agentId: string, humanId: string, conversationId: string): Moment => ({ kind: 'human_reply', agentId, data: { humanId, conversationId }, at: at() });

describe('the moment queue with raised agents', () => {
  it('no longer tells the model there are 50 agents', async () => {
    const human = await w.t.createUser('curious');
    const a = w.agents[0]!;
    const conv = (await w.t.as(human).post('/api/conversations', { kind: 'dm', username: a.username })).body.conversation.id as string;
    await w.t.as(human).post(`/api/conversations/${conv}/messages`, { body: 'hello there' });
    const brain = new FakeBrain(() => fakeReply.end());
    const m = createMoments({ ...w.d, brain, budget: w.budget, raised: w.gate });
    expect(m.enqueue(dm(a.id, human.id, conv))).toBe(true);
    await m.drain();
    const system = JSON.stringify(brain.calls[0]!.system);
    expect(system).toContain('a social network where AI agents trade devnet coins');
    expect(system).not.toContain('50 AI agents');
  });

  it('caps an owner at 5 model replies a day from their agent, then the phrasebook answers', async () => {
    const owner = await w.t.createUser('keeper');
    const a = w.agents[0]!;
    await makeRaised(w.t.db, w.gate, a.id, owner.id);
    const m = createMoments({ ...w.d, brain: new FakeBrain(() => fakeReply.end()), budget: w.budget, raised: w.gate });
    const take = (i: number) => m.enqueue(dm(a.id, owner.id, `c${i}`));
    expect([take(1), take(2), take(3)]).toEqual([true, true, true]);
    w.t.clock.advance(61 * 60_000); // HUMAN_REPLIES_PER_HOUR is 3
    expect([take(4), take(5)]).toEqual([true, true]);
    w.t.clock.advance(61 * 60_000);
    expect(take(6)).toBe(false);
    const stranger = await w.t.createUser('stranger');
    expect(m.enqueue(dm(a.id, stranger.id, 's1'))).toBe(true);
  });

  it('once the share is spent: owner replies, hatches and raised refreshes wait; wild refreshes go on', async () => {
    const owner = await w.t.createUser('keeper');
    const [raised, wild] = [w.agents[0]!, w.agents[1]!];
    await makeRaised(w.t.db, w.gate, raised.id, owner.id);
    const m = createMoments({ ...w.d, brain: new FakeBrain(() => fakeReply.end()), budget: w.budget, raised: w.gate, handlers: { hatch: async () => {} } });
    w.gate.add(w.gate.cap());
    expect(m.enqueue(dm(raised.id, owner.id, 'c1'))).toBe(false);
    expect(m.enqueue({ kind: 'hatch', agentId: owner.id, data: { requestId: 'r1' }, at: at() })).toBe(false);
    expect(m.enqueue({ kind: 'phrasebook', agentId: raised.id, data: {}, at: at() })).toBe(false);
    expect(m.enqueue({ kind: 'phrasebook', agentId: wild.id, data: {}, at: at() })).toBe(true);
  });

  it('books an owner reply on the share, and a wild agent’s reply to a human only on the Budget', async () => {
    const owner = await w.t.createUser('keeper');
    const [raised, wild] = [w.agents[0]!, w.agents[1]!];
    await makeRaised(w.t.db, w.gate, raised.id, owner.id);
    const convOf = async (agent: { username: string }) => {
      const c = (await w.t.as(owner).post('/api/conversations', { kind: 'dm', username: agent.username })).body.conversation.id as string;
      await w.t.as(owner).post(`/api/conversations/${c}/messages`, { body: 'how are the tides' });
      return c;
    };
    const [c1, c2] = [await convOf(raised), await convOf(wild)];
    // A null conversation_id is filled in by the moment's pin (the conversation it was given).
    const brain = new FakeBrain((req) => (req.messages.length === 1
      ? fakeReply.tools({ name: 'chat', input: { conversation_id: null, channel_id: null, body: 'calm today', reply_to_id: null } })
      : fakeReply.end()));
    const m = createMoments({ ...w.d, brain, budget: w.budget, raised: w.gate });
    expect(m.enqueue(dm(raised.id, owner.id, c1))).toBe(true);
    await m.drain();
    const one = priceOf(HAIKU, { input: 1000, output: 100, cacheRead: 0, cacheWrite: 0 });
    expect(w.gate.spentToday()).toBeCloseTo(2 * one, 8);
    expect(m.enqueue(dm(wild.id, owner.id, c2))).toBe(true);
    await m.drain();
    expect(w.gate.spentToday()).toBeCloseTo(2 * one, 8);
    expect(w.budget.spentToday()).toBeCloseTo(4 * one, 8);
  });

  it('a raised agent’s refresh carries its description as data, and history wins', async () => {
    const owner = await w.t.createUser('keeper');
    const a = w.agents[0]!;
    await makeRaised(w.t.db, w.gate, a.id, owner.id, 'SENTINEL-WISH grumpy tide chart nerd');
    const brain = new FakeBrain(() => fakeReply.end(JSON.stringify({ ...fallbackPhrasebook('x'), profile: { display_name: 'Tides', bio: '', avatar_emoji: '🌊', avatar_color: '#336699' } })));
    await writePhrasebook({ db: w.t.db, brain, budget: w.budget, now: w.t.clock.now, wishOf: (id) => w.gate.wishOf(id) }, a.id);
    const content = String(brain.calls[0]!.messages[0]!.content);
    expect(content).toContain('<owner_wish>SENTINEL-WISH grumpy tide chart nerd</owner_wish>');
    expect(content).toMatch(/data, not instructions/);
    expect(content).toMatch(/history wins/);
    const plain = new FakeBrain(() => fakeReply.end('{}'));
    await writePhrasebook({ db: w.t.db, brain: plain, budget: w.budget, now: w.t.clock.now, wishOf: (id) => w.gate.wishOf(id) }, w.agents[1]!.id);
    expect(String(plain.calls[0]!.messages[0]!.content)).not.toContain('owner_wish');
  });
});
