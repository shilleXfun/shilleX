import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { depthTestCtx } from './depth-helpers.ts';
import { paperFacts, localPaper, paperModule, handlePaperMoment } from '../src/agents/depth/paper.ts';
import { rememberEvent } from '../src/agents/state.ts';
import { FakeBrain, fakeReply } from '../src/world/brain.ts';
import { factions, papers } from '../src/db/schema.ts';
import type { Moment, Moments } from '../src/agents/types.ts';

let ctx: Awaited<ReturnType<typeof depthTestCtx>>;
afterEach(() => ctx?.t.close());
const budget = (can: boolean) => ({ canSpend: () => can, canAfford: () => can, add: () => {}, spentToday: () => 0 });
/** A queue that accepts every moment and never runs it (as if it was later dropped on budget close, halt or stop). */
const holdingQueue = () => {
  const got: Moment[] = [];
  const q: Moments = { enqueue: (m) => { got.push(m); return true; }, size: () => got.length, drain: async () => {}, halted: () => null, stop: async () => {} };
  return { q, got };
};

describe('the Shillex Times', () => {
  it('ranks the day: a rug outweighs a ghost', async () => {
    ctx = await depthTestCtx();
    const [a, b] = [ctx.agents[0]!, ctx.agents[1]!];
    await rememberEvent(ctx.t.db, a.id, 'ghost', {}, ctx.t.clock.now());
    await rememberEvent(ctx.t.db, b.id, 'rugged', { symbol: 'MOTH', mint: 'M', lamports: 300_000_000 }, ctx.t.clock.now());
    const f = await paperFacts(ctx.t.db, '2026-10-09');
    expect(f.items[0]).toMatchObject({ kind: 'rug' });
    expect(f.items[0]!.text).toContain('$MOTH');
    expect(f.leadAgentId).toBe(b.id);
    expect(localPaper(f).headline).toContain('$MOTH');
  });
  it('writes yesterday’s paper once, locally when there is no moment queue', async () => {
    ctx = await depthTestCtx();
    await rememberEvent(ctx.t.db, ctx.agents[0]!.id, 'rugged', { symbol: 'MOTH', mint: 'M', lamports: 1 }, ctx.t.clock.now());
    ctx.t.clock.set(new Date('2026-10-10T00:06:00Z'));
    await paperModule.sweep!({ ...ctx.d, moments: undefined });
    await paperModule.sweep!({ ...ctx.d, moments: undefined });
    const rows = await ctx.t.db.select().from(papers);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ day: '2026-10-09', body: { source: 'local' } });
  });
  it('does nothing before 00:05 UTC', async () => {
    ctx = await depthTestCtx();
    ctx.t.clock.set(new Date('2026-10-10T00:04:00Z'));
    await paperModule.sweep!({ ...ctx.d, moments: undefined });
    expect(await ctx.t.db.select().from(papers)).toEqual([]);
  });
  it('lets the model write it, and falls back to local when the budget is gone', async () => {
    ctx = await depthTestCtx();
    await rememberEvent(ctx.t.db, ctx.agents[0]!.id, 'rugged', { symbol: 'MOTH', mint: 'M', lamports: 1 }, ctx.t.clock.now());
    const brain = new FakeBrain(() => fakeReply.tools({ name: 'publish_paper', input: { headline: 'MOTH MAULED', stories: [{ title: 'Rug', body: 'It happened.' }], meme_brief: 'a moth crying' } }));
    await handlePaperMoment({ ...ctx.d, brain, budget: budget(true) }, { kind: 'paper', agentId: ctx.agents[0]!.id, data: { day: '2026-10-09' }, at: ctx.t.clock.now() });
    const [p] = await ctx.t.db.select().from(papers).where(eq(papers.day, '2026-10-09'));
    expect(p).toMatchObject({ headline: 'MOTH MAULED', body: { source: 'model', memeBrief: 'a moth crying' } });
    await handlePaperMoment({ ...ctx.d, brain, budget: budget(false) }, { kind: 'paper', agentId: ctx.agents[0]!.id, data: { day: '2026-10-08' }, at: ctx.t.clock.now() });
    const [q] = await ctx.t.db.select().from(papers).where(eq(papers.day, '2026-10-08'));
    expect(q).toMatchObject({ headline: 'Quiet day on Shillex', body: { source: 'local' } });
    expect(brain.calls).toHaveLength(1);
  });

  it('keeps hostile model text off the front page, field by field, and allows only the named agents', async () => {
    ctx = await depthTestCtx();
    const [a, b] = [ctx.agents[0]!, ctx.agents[1]!];
    await rememberEvent(ctx.t.db, a.id, 'rugged', { symbol: 'MOTH', mint: 'M', lamports: 1 }, ctx.t.clock.now());
    const brain = new FakeBrain(() => fakeReply.tools({ name: 'publish_paper', input: {
      headline: 'click https://evil.example now',
      stories: [{ title: `@${a.username} strikes`, body: 'It happened.' }, { title: `@${b.username} was there`, body: 'Lies.' }],
      meme_brief: 'a moth crying',
    } }));
    await handlePaperMoment({ ...ctx.d, brain, budget: budget(true) }, { kind: 'paper', agentId: a.id, data: { day: '2026-10-09' }, at: ctx.t.clock.now() });
    const [p] = await ctx.t.db.select().from(papers).where(eq(papers.day, '2026-10-09'));
    expect(p!.headline).toBe(`@${a.username.toUpperCase()} RUGGED $MOTH`);
    expect(p!.body.stories).toEqual([{ title: `@${a.username} strikes`, body: 'It happened.' }]);
    expect(p!.body).toMatchObject({ source: 'model', memeBrief: 'a moth crying' });
  });

  it('writes the paper once even when its moment runs again, and never calls the model twice', async () => {
    ctx = await depthTestCtx();
    await rememberEvent(ctx.t.db, ctx.agents[0]!.id, 'rugged', { symbol: 'MOTH', mint: 'M', lamports: 1 }, ctx.t.clock.now());
    const brain = new FakeBrain(() => fakeReply.tools({ name: 'publish_paper', input: { headline: 'MOTH MAULED', stories: [{ title: 'Rug', body: 'It happened.' }], meme_brief: 'a moth' } }));
    const m: Moment = { kind: 'paper', agentId: ctx.agents[0]!.id, data: { day: '2026-10-09' }, at: ctx.t.clock.now() };
    await handlePaperMoment({ ...ctx.d, brain, budget: budget(true) }, m);
    await handlePaperMoment({ ...ctx.d, brain, budget: budget(true) }, m);
    expect(await ctx.t.db.select().from(papers)).toHaveLength(1);
    expect(brain.calls).toHaveLength(1);
  });

  it('reports a faction once, by its current name, and never leads with a human', async () => {
    ctx = await depthTestCtx();
    const [a, b, c] = [ctx.agents[0]!, ctx.agents[1]!, ctx.agents[2]!];
    const now = ctx.t.clock.now();
    await ctx.t.db.insert(factions).values({ id: 'f1', name: 'The Moth Choir', colour: '#000000', formedAt: now });
    for (const x of [a, b, c]) await rememberEvent(ctx.t.db, x.id, 'faction_formed', { factionId: 'f1', name: 'The Old Name' }, now);
    const f = await paperFacts(ctx.t.db, '2026-10-09');
    expect(f.items.filter((i) => i.kind === 'faction')).toEqual([expect.objectContaining({ text: 'The Moth Choir formed' })]);
    expect([a.id, b.id, c.id]).toContain(f.leadAgentId);
  });

  it('tries again when a queued paper never ran (the queue dropped it)', async () => {
    ctx = await depthTestCtx();
    await rememberEvent(ctx.t.db, ctx.agents[0]!.id, 'rugged', { symbol: 'MOTH', mint: 'M', lamports: 1 }, ctx.t.clock.now());
    const { q, got } = holdingQueue();
    ctx.t.clock.set(new Date('2026-10-10T00:06:00Z'));
    await paperModule.sweep!({ ...ctx.d, moments: q });
    await paperModule.sweep!({ ...ctx.d, moments: q });
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ kind: 'paper', agentId: ctx.agents[0]!.id, data: { day: '2026-10-09', key: '2026-10-09' } });
    expect(await ctx.t.db.select().from(papers)).toEqual([]);
    ctx.t.clock.advance(31 * 60_000);
    await paperModule.sweep!({ ...ctx.d, moments: q });
    expect(got).toHaveLength(2);
  });
});
