import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeRaised, raisedTestCtx } from './raised-helpers.ts';
import { HATCH_PROMPT_VERSION, HATCH_WORST, OWNER_REPLY_WORST, RaisedGate } from '../src/agents/raised/gate.ts';
import { finishTurn, startTurn } from '../src/world/provenance.ts';
import { HUMAN_PURPOSE, type Moment } from '../src/agents/types.ts';
import { HAIKU } from '../src/agents/haiku.ts';
import { PHRASEBOOK_PROMPT_VERSION } from '../src/agents/phrasebook-writer.ts';

let w: Awaited<ReturnType<typeof raisedTestCtx>>;
beforeEach(async () => { w = await raisedTestCtx(); });
afterEach(() => w.t.close());
const at = () => w.t.clock.now();
const reply = (agentId: string, humanId: string, conversationId = 'c1'): Moment => ({ kind: 'human_reply', agentId, data: { humanId, conversationId }, at: at() });
const book = (agentId: string): Moment => ({ kind: 'phrasebook', agentId, data: {}, at: at() });
const hatch = (ownerId: string): Moment => ({ kind: 'hatch', agentId: ownerId, data: { requestId: 'r1' }, at: at() });
const turn = async (agentId: string, o: { note: string; promptVersion: string; costUsd: number; private?: boolean }) => {
  const { id } = await startTurn(w.t.db, { agentId, triggers: [{ type: 'heartbeat', note: o.note }], model: HAIKU, effort: 'low', promptVersion: o.promptVersion, snapshotId: null, now: at() });
  await finishTurn(w.t.db, id, { status: 'acted', context: o.private ? [{ kind: 'private', text: 'A private conversation took place' }] : [], reasoning: '', toolCalls: [], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: o.costUsd, finishedAt: at() });
};

describe('RaisedGate', () => {
  it('admits hatches and raised refreshes only while the share has room; wild refreshes are not its business', async () => {
    const owner = await w.t.createUser('keeper');
    const [raised, wild] = [w.agents[0]!, w.agents[1]!];
    await makeRaised(w.t.db, w.gate, raised.id, owner.id);
    expect(w.gate.cap()).toBeCloseTo(0.35);
    expect(w.gate.admits(hatch(owner.id))).toBe(true);
    expect(w.gate.admits(book(raised.id))).toBe(true);
    w.gate.add(0.35 - HATCH_WORST / 2);
    expect(w.gate.admits(hatch(owner.id))).toBe(false);
    expect(w.gate.admits(book(raised.id))).toBe(false);
    expect(w.gate.admits(book(wild.id))).toBe(true);
  });

  it('gives an owner 5 model replies a day from their own agent; anyone else talking to it is left to the moment queue', async () => {
    const owner = await w.t.createUser('keeper');
    const other = await w.t.createUser('stranger');
    const raised = w.agents[0]!;
    await makeRaised(w.t.db, w.gate, raised.id, owner.id);
    for (let i = 0; i < 5; i++) expect(w.gate.admits(reply(raised.id, owner.id, `c${i}`))).toBe(true);
    expect(w.gate.repliesLeft(owner.id)).toBe(0);
    expect(w.gate.admits(reply(raised.id, owner.id, 'c9'))).toBe(false);
    expect(w.gate.admits(reply(raised.id, other.id))).toBe(true);
    expect(w.gate.admits(reply(w.agents[1]!.id, owner.id))).toBe(true);
    w.t.clock.advance(24 * 3600_000);
    expect(w.gate.repliesLeft(owner.id)).toBe(5);
    expect(w.gate.spentToday()).toBe(0);
  });

  it('refuses an owner reply when the share cannot cover both of its trips', async () => {
    const owner = await w.t.createUser('keeper');
    await makeRaised(w.t.db, w.gate, w.agents[0]!.id, owner.id);
    w.gate.add(0.35 - OWNER_REPLY_WORST / 2);
    expect(w.gate.admits(reply(w.agents[0]!.id, owner.id))).toBe(false);
  });

  it('budgetFor books raised calls on both the Budget and the share, and the hard stop still wins', async () => {
    const owner = await w.t.createUser('keeper');
    const [raised, wild] = [w.agents[0]!, w.agents[1]!];
    await makeRaised(w.t.db, w.gate, raised.id, owner.id);
    expect(w.gate.budgetFor(wild.id, HUMAN_PURPOSE, w.budget)).toBe(w.budget);
    expect(w.gate.budgetFor(raised.id, 'launch announcement', w.budget)).toBe(w.budget);
    const b = w.gate.budgetFor(raised.id, HUMAN_PURPOSE, w.budget);
    b.add(0.01);
    expect(w.budget.spentToday()).toBeCloseTo(0.01);
    expect(w.gate.spentToday()).toBeCloseTo(0.01);
    expect(w.gate.budgetFor(owner.id, 'hatch', w.budget).canAfford(0.3)).toBe(true);
    expect(w.gate.budgetFor(owner.id, 'hatch', w.budget).canAfford(0.35)).toBe(false); // share: 0.01 + 0.35 > 0.35
    w.budget.add(0.99);
    expect(w.gate.budgetFor(owner.id, 'hatch', w.budget).canAfford(0.001)).toBe(false); // the $1 hard cap
    expect(w.gate.budgetFor(raised.id, 'phrasebook', w.budget).canSpend()).toBe(false);
  });

  it('load() rebuilds the roster, today’s share spend and owner replies from the receipts', async () => {
    const owner = await w.t.createUser('keeper');
    const [raised, wild] = [w.agents[0]!, w.agents[1]!];
    await makeRaised(w.t.db, null, raised.id, owner.id);
    await turn(owner.id, { note: 'hatch', promptVersion: HATCH_PROMPT_VERSION, costUsd: 0.002 });
    await turn(raised.id, { note: HUMAN_PURPOSE, promptVersion: 'moment-v1', costUsd: 0.0004, private: true });
    await turn(raised.id, { note: 'phrasebook', promptVersion: PHRASEBOOK_PROMPT_VERSION, costUsd: 0.003 });
    await turn(raised.id, { note: 'launch announcement', promptVersion: 'moment-v1', costUsd: 0.5 });
    await turn(wild.id, { note: HUMAN_PURPOSE, promptVersion: 'moment-v1', costUsd: 0.5 });
    const g = new RaisedGate({ db: w.t.db, now: w.t.clock.now, dailyUsd: 1, share: 0.35, ownerRepliesPerDay: 5 });
    await g.load();
    expect(g.isRaised(raised.id)).toBe(true);
    expect(g.ownerOf(raised.id)).toBe(owner.id);
    expect(g.isRaised(wild.id)).toBe(false);
    expect(g.spentToday()).toBeCloseTo(0.0054);
    expect(g.repliesLeft(owner.id)).toBe(4);
    expect(await g.wishOf(raised.id)).toBe('a calm lighthouse keeper who loves tide charts');
    expect(await g.wishOf(wild.id)).toBeNull();
  });
});
