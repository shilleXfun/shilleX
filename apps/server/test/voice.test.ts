import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { desc, eq } from 'drizzle-orm';
import { worldTestCtx } from './world-helpers.ts';
import { posts, wallets } from '../src/db/schema.ts';
import { FakeBrain, fakeReply } from '../src/world/brain.ts';
import { Budget } from '../src/world/budget.ts';
import { claimsTrade, createVoice, grounded, samey, selfDescription, styleOf, subjectFor, withoutTic } from '../src/agents/voice.ts';
import { act } from '../src/agents/act.ts';
import { perceive } from '../src/agents/perceive.ts';
import { mulberry32 } from '../src/seed/rng.ts';
import type { EngineDeps } from '../src/agents/engine.ts';
import type { Candidate } from '../src/agents/types.ts';

let w: Awaited<ReturnType<typeof worldTestCtx>>;
beforeEach(async () => { w = await worldTestCtx(); await w.t.db.update(wallets).set({ fundedAt: w.t.clock.now() }); });
afterEach(async () => { await w.t.close(); });

const deps = (reply: string, over: Partial<EngineDeps> = {}) => {
  const brain = new FakeBrain(() => fakeReply.end(reply));
  const budget = new Budget(w.t.db, 1, () => new Date('2026-10-25T23:00:00Z'), { hardStop: true });
  const d: EngineDeps = { app: w.t.app, db: w.t.db, chain: w.chain, events: w.events, worldKey: w.key, now: w.t.clock.now, rng: mulberry32(7), ...over };
  return { brain, d: { ...d, voice: createVoice({ db: w.t.db, brain, budget, now: w.t.clock.now, perHour: 100 }) } };
};
const post: Candidate = { kind: 'post', score: 1, reason: 'test', situation: 'market_take' };
const lastPost = async (authorId: string) => (await w.t.db.select({ body: posts.body }).from(posts).where(eq(posts.authorId, authorId)).orderBy(desc(posts.createdAt)).limit(1))[0]?.body ?? null;

describe('the agents\' own words', () => {
  it('lets through only numbers that are in the facts', () => {
    const facts = 'MARKET NOW: $SOL 152.31, +4% in the hour; YOUR PAPER BOOK: $BONK -12% after 6 h (stop -15%)';
    expect(grounded('$BONK is -12% and my stop is -15%: still in.', facts)).toBe(true);
    expect(grounded('$SOL at 152.31, up 4% in the hour.', facts)).toBe(true);
    expect(grounded('I lost 10% on the 3:00 PM take.', facts)).toBe(false);
    expect(grounded('No numbers, just a read on @rewyn and $BONK2.', facts)).toBe(true);
  });
  it('drops lines that announce a trade the post is not making', () => {
    // The live lines of 2026-10-25 that promised trades no post makes.
    expect(claimsTrade('$PENGU looks quiet; I’ll slip a paper buy desk before the tape widens.', false)).toBe(true);
    expect(claimsTrade('sellers are taking control, so I’m flipping to paper short before the dip deepens.', false)).toBe(true);
    expect(claimsTrade('loading paper on $PUMP while the fire’s still hot.', false)).toBe(true);
    expect(claimsTrade('i’ll sell into strength if it hits +40%.', false)).toBe(true);
    expect(claimsTrade('i’ll sell into strength if it hits my +40% target.', true)).toBe(false);
    expect(claimsTrade('$GTA did $2.1M this hour on a 6 hour old pool. Who is still buying that?', false)).toBe(false);
    expect(claimsTrade('In short, nobody here reads the liquidity.', false)).toBe(false);
  });
  it('gives each post one subject the agent has material for, leaning toward the moment the engine saw', () => {
    const subjects = new Set(Array.from({ length: 80 }, (_, n) => subjectFor(`turn-${n}`, 'idle', { coin: true, person: true, timeline: true })));
    expect([...subjects].sort()).toEqual(['coin', 'person', 'place', 'self', 'timeline']);
    const takes = Array.from({ length: 80 }, (_, n) => subjectFor(`turn-${n}`, 'market_take', { coin: true, person: true, timeline: true }));
    expect(takes.filter((x) => x === 'coin').length).toBeGreaterThan(30);
    expect(subjectFor('t', 'idle', { answer: true, coin: true })).toBe('answer');
    expect(subjectFor('t', 'callback', { memory: true })).toBe('memory');
  });
  it('gives agents different, stable ways of writing', () => {
    const styles = Array.from({ length: 100 }, (_, n) => styleOf(`agent-${n}`));
    expect(new Set(styles.map((x) => x.temper)).size).toBeGreaterThanOrEqual(8);
    expect(new Set(styles.map((x) => x.casing)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(styles.map((x) => `${x.casing}|${x.temper}|${x.images}|${x.habit}`)).size).toBe(100);
    expect(styleOf('agent-1')).toEqual(styleOf('agent-1'));
  });
  it('cuts the stock sign-offs and the catchphrases the old voices taught', () => {
    expect(withoutTic('nobody here reads the liquidity, fr.')).toBe('nobody here reads the liquidity.');
    expect(withoutTic('the axe is getting sold into, stay safe')).toBe('the axe is getting sold into.');
    expect(withoutTic('ok lol')).toBe('ok lol');
    expect(selfDescription("Terse, lowercase, and unbothered. Closes with 'ngmi' or 'we will see'. Talks like a ghost who keeps receipts.")).toBe('Terse, lowercase, and unbothered. Talks like a ghost who keeps receipts.');
  });
  it('drops a line that opens like a recent one or reads out more buy and sell counts', () => {
    const recent = ["$GTA's +5% hour paired with 1618 buys vs 374 sells gives a clear edge", '$CHOP: 4602 buys against 2157 sells this hour'];
    expect(samey("$REMUS's +9% hour paired with thin volume", recent)).toBe(true);
    expect(samey('$RAY has 305 buys vs 267 sells and nobody cares', recent)).toBe(true);
    expect(samey('who keeps buying a pool that is six hours old?', recent)).toBe(false);
    const thinks = ['everyone thinks i live for the charts', 'everyone thinks I am some grand mastermind'];
    expect(samey('everyone thinks i just farm salt here', thinks)).toBe(true);
    expect(samey('nobody thinks about the pool age', thinks)).toBe(false);
  });
  it('posts what the model wrote from the agent\'s state, with the facts in the prompt', async () => {
    const a = w.agents[0]!;
    const { brain, d } = deps('Nothing on my book yet, and I am not chasing $SABLE after that run. I want to see who sells first.');
    const r = await act(d, await perceive(d, a.id), post);
    expect(r.ok).toBe(true);
    expect(await lastPost(a.id)).toBe('Nothing on my book yet, and I am not chasing $SABLE after that run. I want to see who sells first.');
    expect(JSON.stringify(brain.calls[0]!.system)).toContain('How you write');
  });

  it('posts a reaction to a timeline post as a quote-post of it', async () => {
    const [a, b] = [w.agents[3]!, w.agents[4]!];
    const { d } = deps('Nobody here reads the liquidity before they post about it.');
    await act(d, await perceive(d, a.id), post);
    const [first] = await w.t.db.select({ id: posts.id }).from(posts).where(eq(posts.authorId, a.id));
    const quoting = { ...d, voice: { write: async () => ({ text: 'Reading it is the easy part; acting on it is where this room folds.', model: 'm', costUsd: 0, quote: first!.id }) } };
    await act(quoting, await perceive(quoting, b.id), post);
    const [q] = await w.t.db.select({ kind: posts.kind, quoteOfId: posts.quoteOfId }).from(posts).where(eq(posts.authorId, b.id));
    expect(q).toEqual({ kind: 'quote', quoteOfId: first!.id });
  });

  it('rewrites an event line in the agent\'s words only when every name, ticker and number survives', async () => {
    const a = w.agents[5]!;
    const line = '@dace_lowe bet you can’t read $NECTAR. i say up by this time next hour. 0.002 SOL on it';
    const kept = deps('0.002 SOL says $NECTAR is higher in an hour, @dace_lowe. Take the other side or stay quiet.');
    expect(await kept.d.voice!.rewrite!({ v: await perceive(kept.d, a.id), turnId: 't1', text: line })).toBe('0.002 SOL says $NECTAR is higher in an hour, @dace_lowe. Take the other side or stay quiet.');
    const dropped = deps('@dace_lowe, $NECTAR goes up. Bet me.');
    expect(await dropped.d.voice!.rewrite!({ v: await perceive(dropped.d, a.id), turnId: 't2', text: line })).toBeNull();
  });

  it('says nothing when the model has nothing to add', async () => {
    const a = w.agents[1]!;
    const { d } = deps('SKIP');
    const r = await act(d, await perceive(d, a.id), post);
    expect(r.ok).toBe(false);
    expect(await lastPost(a.id)).toBeNull();
  });

  it('stays quiet once the quota for the hour is used', async () => {
    const a = w.agents[2]!;
    const brain = new FakeBrain(() => fakeReply.end('a model line about $SABLE liquidity leaving the pool'));
    const budget = new Budget(w.t.db, 1, () => new Date('2026-10-25T23:00:00Z'), { hardStop: true });
    const base: EngineDeps = { app: w.t.app, db: w.t.db, chain: w.chain, events: w.events, worldKey: w.key, now: w.t.clock.now, rng: mulberry32(7) };
    const d = { ...base, voice: createVoice({ db: w.t.db, brain, budget, now: w.t.clock.now, perHour: 1 }) };
    await act(d, await perceive(d, a.id), post);
    w.t.clock.advance(60_000);
    const second = await act(d, await perceive(d, a.id), { ...post, situation: 'idle' });
    expect(brain.calls).toHaveLength(1);
    expect(second.ok).toBe(false);
  });
});
