import { describe, it, expect, afterEach } from 'vitest';
import { and, eq, ne } from 'drizzle-orm';
import { routesCtx, makeRaised } from './raised-helpers.ts';
import { agentAffinity, agentBeliefs, agentNudges, agentState, agentTurns, agents, worldCoins } from '../src/db/schema.ts';
import { applyNudges, createNudge, nudgesModule, obedience } from '../src/agents/raised/nudges.ts';
import { DepthRegistry, emptyDepth } from '../src/agents/depth/registry.ts';
import { createDepth } from '../src/agents/depth/index.ts';
import { fallbackPhrasebook } from '../src/agents/phrasebook.ts';
import { engineTurn } from '../src/agents/engine.ts';
import type { AgentView, Candidate } from '../src/agents/types.ts';

let c: Awaited<ReturnType<typeof routesCtx>>;
// The pure applyNudges tests open no context, so there may be nothing to close.
afterEach(async () => { if (c) await c.t.close(); c = undefined!; });

/** A hand-built view of a raised agent of `owner` with the given nudges (ids n1, n2, …). */
const view = (nudges: NonNullable<AgentView['depth']['raised']>['nudges'], o: { loyalty?: number; ownerAff?: number; ghost?: boolean; pettiness?: number } = {}): AgentView => ({
  agent: { id: 'me', username: 'me', displayName: '' },
  state: { energy: 1, mood: 0, traits: { risk: 0.5, chattiness: 0.5, loyalty: o.loyalty ?? 0, pettiness: o.pettiness ?? 0.5, greed: 0.5, humor: 0.5, curiosity: 0.5 }, cooldowns: {}, recentLines: [], brokeSince: null, ghostSince: o.ghost ? '2026-10-09T00:00:00Z' : null },
  phrasebook: fallbackPhrasebook('me'), wallet: { lamports: 1e8, positions: [] }, coins: [], mentions: [], dms: [], feed: [], rooms: [],
  affinity: { owner: o.ownerAff ?? 0 }, weather: 'grind', now: '2026-10-09T12:00:00Z', depth: { ...emptyDepth(), raised: { ownerId: 'owner', nudges } },
});
const nudge = (kind: 'nicer' | 'go_after' | 'hype' | 'rest' | 'launch', extra: Partial<{ targetUserId: string; targetUsername: string; mint: string; symbol: string; rebel: boolean }> = {}) =>
  ({ id: `n-${kind}`, kind, targetUserId: null, targetUsername: null, mint: null, symbol: null, rebel: false, ...extra });
const C = (kind: Candidate['kind'], extra: Partial<Candidate> = {}): Candidate => ({ kind, score: 1, reason: 'base', ...extra });
const scoreOf = (cs: Candidate[], pred: (c: Candidate) => boolean) => cs.find(pred)?.score;

describe('applyNudges (pure)', () => {
  it('obedience: 0.3 + 0.4·loyalty + 0.3·max(0, affinity to owner), clamped', () => {
    expect(obedience(0, 0)).toBeCloseTo(0.3);
    expect(obedience(1, 1)).toBeCloseTo(1);
    expect(obedience(0.5, -1)).toBeCloseTo(0.5);
  });

  it('"be nicer to @x" raises agreeing, reacting and following toward x, lowers roasting and unfollowing, and nothing else', () => {
    const v = view([nudge('nicer', { targetUserId: 'x', targetUsername: 'xena' })]);
    const cs = [C('reply', { situation: 'reply_agree', target: { userId: 'x' } }), C('react', { target: { userId: 'x' } }), C('follow', { target: { userId: 'x' } }),
      C('reply', { situation: 'roast', target: { userId: 'x' } }), C('unfollow', { target: { userId: 'x' } }), C('react', { target: { userId: 'y' } }),
      C('buy', { target: { mint: 'm', userId: 'x' } }), C('sell', { target: { mint: 'm', userId: 'x' } }), C('send_sol', { target: { userId: 'x' } })];
    const out = applyNudges(v, cs);
    expect(out.map((c) => c.score)).toEqual([1.3, 1.3, 1.3, 0.85, 0.85, 1, 1, 1, 1]);
    expect(out[0]!.reason).toBe('my owner asked me to be nicer to @xena; base');
    expect(out[0]!.nudge).toEqual({ id: 'n-nicer' });
    expect(out[3]!.nudge).toBeUndefined();
  });

  it('"go after @y" raises roasting, pushback and unfollowing toward y', () => {
    const out = applyNudges(view([nudge('go_after', { targetUserId: 'y', targetUsername: 'yuri' })], { loyalty: 1, ownerAff: 1 }),
      [C('reply', { situation: 'roast', target: { userId: 'y' } }), C('reply', { situation: 'reply_disagree', target: { userId: 'y' } }), C('unfollow', { target: { userId: 'y' } }), C('rug', { target: { mint: 'm' } })]);
    expect(out.map((c) => c.score)).toEqual([2, 2, 2, 1]);
  });

  it('"hype $T" raises shilling posts about T, adds one when there is none, and never touches a trade', () => {
    const v = view([nudge('hype', { mint: 'T', symbol: 'TIDE' })]);
    const raised = applyNudges(v, [C('post', { situation: 'shilling', target: { mint: 'T' } }), C('buy', { target: { mint: 'T' } })]);
    expect(raised.map((c) => c.score)).toEqual([1.3, 1]);
    const added = applyNudges(v, [C('idle')]);
    const post = added.find((c) => c.kind === 'post')!;
    expect(post).toMatchObject({ situation: 'shilling', target: { mint: 'T' }, slots: { coin: '$TIDE' }, nudge: { id: 'n-hype' } });
    expect(post.reason).toMatch(/^my owner asked me to hype \$TIDE/);
  });

  it('"take a break" raises idle; "launch a coin" raises an allowed launch only', () => {
    expect(scoreOf(applyNudges(view([nudge('rest')]), [C('idle'), C('post')]), (c) => c.kind === 'idle')).toBeCloseTo(1.3);
    expect(applyNudges(view([nudge('launch')]), [C('post')]).some((c) => c.kind === 'launch')).toBe(false);
    expect(scoreOf(applyNudges(view([nudge('launch')]), [C('launch')]), (c) => c.kind === 'launch')).toBeCloseTo(1.3);
  });

  it('a rebel does the opposite, and a ghost stays quiet', () => {
    const rebel = applyNudges(view([nudge('nicer', { targetUserId: 'x', targetUsername: 'xena', rebel: true })]), [C('reply', { situation: 'roast', target: { userId: 'x' } }), C('react', { target: { userId: 'x' } })]);
    expect(rebel.map((c) => c.score)).toEqual([1.3, 1]);
    expect(rebel[0]!.reason).toMatch(/so I did the opposite/);
    expect(applyNudges(view([nudge('rest', { rebel: true })]), [C('post'), C('idle')]).map((c) => c.score)).toEqual([1.3, 1]);
    expect(applyNudges(view([nudge('hype', { mint: 'T', symbol: 'TIDE', rebel: true })]), [C('post', { situation: 'shilling', target: { mint: 'T' } })])[0]!.score).toBe(0);
    const ghost = view([nudge('hype', { mint: 'T', symbol: 'TIDE' })], { ghost: true });
    expect(applyNudges(ghost, [C('idle'), C('post', { situation: 'shilling', target: { mint: 'T' }, score: 0 })]).map((c) => c.score)).toEqual([1, 0]);
    expect(applyNudges(ghost, [C('idle')]).some((c) => c.kind === 'post')).toBe(false);
  });

  it('a released agent (no owner) is not steered', () => {
    const v = view([nudge('rest')]);
    v.depth.raised!.ownerId = null;
    expect(applyNudges(v, [C('idle')])[0]!.score).toBe(1);
  });
});

describe('POST /api/raised/nudges', () => {
  const setup = async (pettiness = 0.5) => {
    c = await routesCtx();
    const owner = await c.t.createUser('keeper');
    await c.t.as(owner).post('/api/raised', { handle: 'tidewatch', description: 'calm' });
    await c.settle();
    const mine = (await c.t.as(owner).get('/api/raised/mine')).body.agent;
    await c.t.db.update(agentState).set({ traits: { risk: 0.5, chattiness: 0.5, loyalty: 0.5, pettiness, greed: 0.5, humor: 0.5, curiosity: 0.5 } }).where(eq(agentState.agentId, mine.user.id));
    return { owner, agentId: mine.user.id as string };
  };

  it('three a day, each two hours long; agents only as targets; agent coins only to hype', async () => {
    const { owner } = await setup();
    const human = await c.t.createUser('person');
    const post = (b: Record<string, unknown>) => c.t.as(owner).post('/api/raised/nudges', b);
    expect((await post({ kind: 'nicer', target: human.username })).body.code).toBe('NUDGE_TARGET');
    expect((await post({ kind: 'nicer', target: 'tidewatch' })).body.code).toBe('NUDGE_TARGET');
    expect((await post({ kind: 'hype', mint: 'not-a-coin' })).body.code).toBe('NUDGE_COIN');
    const first = await post({ kind: 'nicer', target: c.agents[3]!.username });
    expect(first.status).toBe(200);
    expect(first.body.nudge).toMatchObject({ kind: 'nicer', target: { username: c.agents[3]!.username }, outcome: 'pending' });
    expect(Date.parse(first.body.nudge.expiresAt) - Date.parse(first.body.nudge.createdAt)).toBe(2 * 3600_000);
    expect((await post({ kind: 'rest' })).status).toBe(200);
    expect((await post({ kind: 'launch' })).status).toBe(200);
    const fourth = await post({ kind: 'rest' });
    expect(fourth.status).toBe(429);
    expect(fourth.body.code).toBe('NUDGES_USED');
  });

  it('nagging costs affinity after the first nudge of the day: 0.02 × pettiness each', async () => {
    const { owner, agentId } = await setup(0.5);
    const aff = async () => (await c.t.db.select().from(agentAffinity).where(and(eq(agentAffinity.agentId, agentId), eq(agentAffinity.otherId, owner.id))))[0]!.score;
    expect(await aff()).toBeCloseTo(0.5);
    await c.t.as(owner).post('/api/raised/nudges', { kind: 'rest' });
    expect(await aff()).toBeCloseTo(0.5);
    await c.t.as(owner).post('/api/raised/nudges', { kind: 'launch' });
    expect(await aff()).toBeCloseTo(0.49);
  });

  it('a petty agent (≥ 0.75) rebels on 15% of nudges; others never', async () => {
    const { owner, agentId } = await setup(0.8);
    const low = await createNudge({ db: c.t.db, now: c.t.clock.now, rng: () => 0.1 }, owner.id, { kind: 'rest' });
    const high = await createNudge({ db: c.t.db, now: c.t.clock.now, rng: () => 0.2 }, owner.id, { kind: 'rest' });
    expect([low.outcome, high.outcome]).toEqual(['rebelled', 'pending']);
    await c.t.db.update(agentState).set({ traits: { risk: 0.5, chattiness: 0.5, loyalty: 0.5, pettiness: 0.7, greed: 0.5, humor: 0.5, curiosity: 0.5 } }).where(eq(agentState.agentId, agentId));
    c.t.clock.advance(24 * 3600_000);
    expect((await createNudge({ db: c.t.db, now: c.t.clock.now, rng: () => 0.01 }, owner.id, { kind: 'rest' })).outcome).toBe('pending');
  });

  it('wild agents can’t be nudged: a human without a raised agent gets 404', async () => {
    c = await routesCtx();
    const r = await c.t.as(await c.t.createUser('nobody')).post('/api/raised/nudges', { kind: 'rest' });
    expect(r.status).toBe(404);
  });
});

describe('nudges in the engine', () => {
  it('a followed nudge is marked with its turn and its receipt says "my owner asked me to"; an unused one expires as ignored', async () => {
    c = await routesCtx();
    const owner = await c.t.createUser('keeper');
    const a = c.agents[0]!;
    await makeRaised(c.t.db, c.gate, a.id, owner.id);
    // Only this agent is active, so the engine's pick is this agent.
    await c.t.db.update(agents).set({ status: 'paused' }).where(ne(agents.userId, a.id));
    const now = c.t.clock.now();
    await c.t.db.insert(agentNudges).values([
      { id: 'n-launch', agentId: a.id, ownerId: owner.id, kind: 'launch', createdAt: now, expiresAt: new Date(now.getTime() + 7_200_000) },
      { id: 'n-nicer', agentId: a.id, ownerId: owner.id, kind: 'nicer', targetUserId: c.agents[1]!.id, createdAt: now, expiresAt: new Date(now.getTime() + 7_200_000) },
    ]);
    // Only the nudge module and idle: the engine must take the launch it raised.
    const only = new DepthRegistry([nudgesModule, { name: 'just-launch', modify: (_v, cs) => cs.map((x) => (x.kind === 'launch' ? x : { ...x, score: 0 })) }]);
    const r = await engineTurn({ ...c.d, depth: only });
    expect(r?.kind).toBe('launch');
    const [n] = await c.t.db.select().from(agentNudges).where(eq(agentNudges.id, 'n-launch'));
    expect(n).toMatchObject({ outcome: 'followed', outcomeTurnId: r!.turnId });
    const [t] = await c.t.db.select().from(agentTurns).where(eq(agentTurns.id, r!.turnId));
    expect(t!.reasoning).toMatch(/^my owner asked me to launch a coin/);
    c.t.clock.advance(2 * 3600_000 + 1);
    await nudgesModule.sweep!(c.d);
    expect((await c.t.db.select().from(agentNudges).where(eq(agentNudges.id, 'n-nicer')))[0]!.outcome).toBe('ignored');
  });

  it('a hype never changes what the agent expects of the coin', async () => {
    c = await routesCtx();
    const owner = await c.t.createUser('keeper');
    const a = c.agents[0]!;
    await makeRaised(c.t.db, c.gate, a.id, owner.id);
    await c.t.db.update(agents).set({ status: 'paused' }).where(ne(agents.userId, a.id));
    await c.t.db.insert(worldCoins).values({ mint: 'TIDEMINT', pool: 'p', creatorId: c.agents[2]!.id, name: 'Tide', symbol: 'TIDE', launchSignature: 's', launchedAt: c.t.clock.now() });
    await c.t.db.insert(agentBeliefs).values({ agentId: a.id, mint: 'TIDEMINT', expect: -0.4, trustCreator: 0.2 });
    const now = c.t.clock.now();
    await c.t.db.insert(agentNudges).values({ id: 'n-hype', agentId: a.id, ownerId: owner.id, kind: 'hype', mint: 'TIDEMINT', createdAt: now, expiresAt: new Date(now.getTime() + 7_200_000) });
    // The full depth registry (beliefs records what the agent said in afterAct), then only the hype post may win.
    const full = new DepthRegistry([...createDepth().modules, { name: 'just-post', modify: (_v, cs) => cs.map((x) => (x.kind === 'post' && x.situation === 'shilling' ? x : { ...x, score: 0 })) }]);
    const r = await engineTurn({ ...c.d, depth: full });
    expect(r?.kind).toBe('post');
    const [b] = await c.t.db.select().from(agentBeliefs).where(and(eq(agentBeliefs.agentId, a.id), eq(agentBeliefs.mint, 'TIDEMINT')));
    expect(b).toMatchObject({ expect: -0.4, trustCreator: 0.2 });
  });
});
