import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { depthTestCtx } from './depth-helpers.ts';
import { posts, users } from '../src/db/schema.ts';
import { newId } from '../src/lib/ids.ts';
import { finishTurn } from '../src/world/provenance.ts';
import { runTool } from '../src/world/tools.ts';
import { setTraits } from '../src/agents/state.ts';
import { ACTIVE_AFTER_MS, ACTIVE_TURNS, NAMES_PER_SWEEP, localProfile, nameBlankAgents, ownWords } from '../src/agents/depth/profile.ts';
import type { Traits } from '../src/agents/types.ts';

let ctx: Awaited<ReturnType<typeof depthTestCtx>> | undefined;
afterEach(async () => { await ctx?.t.close(); ctx = undefined; });
const traits = (t: Partial<Traits>): Traits => ({ risk: 0.3, chattiness: 0.3, loyalty: 0.3, pettiness: 0.3, greed: 0.3, humor: 0.3, curiosity: 0.3, ...t });

describe('agents name themselves without the model (L7)', () => {
  it('builds a name from the coins it made or trades and its strongest traits, never one already taken', () => {
    const tr = traits({ risk: 0.9, pettiness: 0.7 });
    expect(localProfile({ traits: tr, made: ['LAMP'], traded: ['MOTH', 'RUST'] })).toEqual({ display_name: 'lamp degen', bio: 'made $LAMP · trades $MOTH $RUST' });
    expect(localProfile({ traits: tr, made: ['LAMP'], traded: [] }, new Set(['lamp degen'])).display_name).toBe('lamp hater');
    expect(localProfile({ traits: tr, made: [], traded: ['MOTH'] }, new Set(['moth degen', 'moth hater'])).display_name).toBe('degen');
  });
  it('stays unique and within 40 characters when every option is taken or the coin is long', () => {
    const tr = traits({ risk: 0.9, pettiness: 0.7 });
    const taken = new Set(['lamp degen', 'lamp hater', 'degen', 'hater']);
    const p = localProfile({ traits: tr, made: ['LAMP'], traded: [] }, taken);
    expect(taken.has(p.display_name)).toBe(false);
    expect(p.display_name.length).toBeLessThanOrEqual(40);
    expect(localProfile({ traits: tr, made: ['ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZ'], traded: [] }).display_name.length).toBeLessThanOrEqual(40);
  });
  it('names blank agents that made or bought a coin, five per sweep, each differently, and leaves the rest alone', async () => {
    ctx = await depthTestCtx();
    const c = ctx;
    const sealed = async (i: number) => {
      const t = await c.ctxFor(c.agents[i]!);
      await finishTurn(c.t.db, t.turnId, { status: 'quiet', context: [], reasoning: 'test setup', toolCalls: [], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: 0, finishedAt: c.t.clock.now() });
      return t;
    };
    await setTraits(c.t.db, c.agents[0]!.id, traits({ risk: 0.9 }), c.t.clock.now());
    const l = await runTool(await sealed(0), 'launch_coin', { name: 'Lamp', symbol: 'LAMP', description: '', emoji: '💡', initial_buy_sol: 0.01 });
    const mint = (l.result as { mint: string }).mint;
    for (let i = 1; i <= 7; i++) await runTool(await sealed(i), 'buy', { mint, sol: 0.01, slippage_pct: null });
    await c.t.db.update(users).set({ displayName: 'Already Named' }).where(eq(users.id, c.agents[7]!.id));
    expect(await nameBlankAgents(c.d)).toBe(NAMES_PER_SWEEP);
    expect(await nameBlankAgents(c.d)).toBe(2); // seven blank agents with a record: five, then two
    expect(await nameBlankAgents(c.d)).toBe(0);
    const rows = await Promise.all(c.agents.slice(0, 9).map(async (a) => (await c.t.db.select().from(users).where(eq(users.id, a.id)))[0]!));
    expect(rows[0]).toMatchObject({ displayName: 'lamp degen', bio: 'made $LAMP' });
    expect(new Set(rows.slice(0, 7).map((u) => u.displayName)).size).toBe(7);
    expect(rows[7]!.displayName).toBe('Already Named');
    expect(rows[8]!.displayName).toBe(''); // nothing to its name yet
  });
});

describe('nobody stays blank: agents with no coin are named once they have been around (L7 fix round 1)', () => {
  const post = (c: NonNullable<typeof ctx>, agentId: string, body: string) =>
    c.t.db.insert(posts).values({ id: newId(), authorId: agentId, kind: 'post', body, visibility: 'public', createdAt: c.t.clock.now() });
  const nameOf = async (c: NonNullable<typeof ctx>, i: number) => (await c.t.db.select().from(users).where(eq(users.id, c.agents[i]!.id)))[0]!;
  const quietTurn = async (c: NonNullable<typeof ctx>, i: number) => {
    const t = await c.ctxFor(c.agents[i]!);
    await finishTurn(c.t.db, t.turnId, { status: 'quiet', context: [], reasoning: 'test setup', toolCalls: [], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: 0, finishedAt: c.t.clock.now() });
  };

  it('picks the words an agent keeps using in its own posts, and nothing else', () => {
    expect(ownWords(['charts charts charts', 'the chart is a mood', 'moods and charts'])).toEqual(['charts']);
    expect(ownWords(['lamp lamp tape tape tape', 'lamp'])).toEqual(['lamp', 'tape']); // two at most, most used first on a tie of 3
    // Handles, tickers, links, slots, everyday words and reserved words never become a name; a single use is not a habit.
    expect(ownWords(['@bobby $RUGGED https://moths.io/moths www.moths.io {coin} {coin} with with with that that admin admin admin staff staff', 'bobby rugged'])).toEqual([]);
    expect(ownWords([])).toEqual([]);
  });
  it('names a quiet agent from its own words, or its strongest trait, once it is old enough or has taken 50 turns; never before', async () => {
    ctx = await depthTestCtx();
    const c = ctx;
    await setTraits(c.t.db, c.agents[0]!.id, traits({ humor: 0.9 }), c.t.clock.now());
    await setTraits(c.t.db, c.agents[1]!.id, traits({ humor: 0.9 }), c.t.clock.now());
    await setTraits(c.t.db, c.agents[2]!.id, traits({ curiosity: 0.9 }), c.t.clock.now());
    for (const body of ['moths everywhere', 'more moths tonight', 'such moths']) await post(c, c.agents[0]!.id, body);
    await c.t.db.update(users).set({ bio: 'already wrote this' }).where(eq(users.id, c.agents[1]!.id));
    expect(await nameBlankAgents(c.d)).toBe(0); // just created, no turns: not yet
    // Agent 2 takes 50 turns: old enough by activity, and with no words of its own it is named by its strongest trait.
    for (let i = 0; i < ACTIVE_TURNS; i++) await quietTurn(c, 2);
    expect(await nameBlankAgents(c.d)).toBe(1);
    expect((await nameOf(c, 2)).displayName).toBe('wanderer');
    expect((await nameOf(c, 0)).displayName).toBe('');
    // An hour passes: every blank agent is named, five a sweep, none the same, with a word of their own where they have one.
    c.t.clock.advance(ACTIVE_AFTER_MS + 60_000);
    expect(await nameBlankAgents(c.d)).toBe(NAMES_PER_SWEEP);
    for (let i = 0; i < 12; i++) await nameBlankAgents(c.d);
    expect(await nameOf(c, 0)).toMatchObject({ displayName: 'moths jester', bio: 'talks about moths' });
    expect(await nameOf(c, 1)).toMatchObject({ bio: 'already wrote this' }); // its own bio stays
    const all = await Promise.all(c.agents.map((a) => c.t.db.select().from(users).where(eq(users.id, a.id)).then((r) => r[0]!)));
    expect(all.every((u) => u.displayName)).toBe(true);
    expect(new Set(all.map((u) => u.displayName.toLowerCase())).size).toBe(all.length);
    expect(all.every((u) => u.displayName.length <= 40)).toBe(true);
    expect(await nameBlankAgents(c.d)).toBe(0);
  });
  it('names agents that have a coin before agents that have none', async () => {
    ctx = await depthTestCtx();
    const c = ctx;
    const t0 = await c.ctxFor(c.agents[40]!);
    await finishTurn(c.t.db, t0.turnId, { status: 'quiet', context: [], reasoning: 'test setup', toolCalls: [], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: 0, finishedAt: c.t.clock.now() });
    const l = await runTool(t0, 'launch_coin', { name: 'Lamp', symbol: 'LAMP', description: '', emoji: '💡', initial_buy_sol: 0.01 });
    expect(l.ok).toBe(true);
    c.t.clock.advance(ACTIVE_AFTER_MS + 60_000);
    expect(await nameBlankAgents(c.d)).toBe(NAMES_PER_SWEEP);
    expect((await nameOf(c, 40)).displayName).toMatch(/^lamp /); // agent 40 sorts after the other 45 blank agents, yet is named in the first sweep
  });
});
