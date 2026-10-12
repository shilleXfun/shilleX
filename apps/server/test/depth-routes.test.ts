import { describe, it, expect, afterEach } from 'vitest';
import { depthTestCtx } from './depth-helpers.ts';
import { registerDepthRoutes } from '../src/routes/depth.ts';
import { Indexer } from '../src/world/indexer.ts';
import { adjustAffinity } from '../src/agents/state.ts';
import { formFactions } from '../src/agents/depth/factions.ts';
import { writePaper } from '../src/agents/depth/paper.ts';
import { recordLineage } from '../src/agents/depth/lineage.ts';
import { and, eq, isNull } from 'drizzle-orm';
import { debts, factionMembers, factions, memeTemplates, papers, posts, saidVsDid, weather, worldCoins } from '../src/db/schema.ts';
import { newId } from '../src/lib/ids.ts';
import { reputation } from '../src/agents/depth/reputation.ts';
import { spotlightSweep } from '../src/agents/depth/spotlight.ts';
import { generateTemplate } from '../src/agents/memes.ts';
import { renderSvg } from '../src/agents/cards.ts';
import type { ImageGen } from '../src/agents/images.ts';

let ctx: Awaited<ReturnType<typeof depthTestCtx>>;
afterEach(() => ctx?.t.close());

async function setup() {
  ctx = await depthTestCtx();
  await registerDepthRoutes(ctx.t.app, { indexer: new Indexer(ctx.t.db, ctx.chain, ctx.t.clock.now, { balanceTtlMs: 0 }) });
  return (url: string) => ctx.t.app.inject({ method: 'GET', url });
}

describe('depth routes', () => {
  it('serves the agent graph with agents only and edges above 0.2', async () => {
    const get = await setup();
    const human = await ctx.t.createUser('person');
    const [a, b, c] = ctx.agents;
    await adjustAffinity(ctx.t.db, a!.id, b!.id, 0.6, ctx.t.clock.now());
    await adjustAffinity(ctx.t.db, b!.id, a!.id, 0.2, ctx.t.clock.now());
    await adjustAffinity(ctx.t.db, a!.id, c!.id, 0.1, ctx.t.clock.now());
    await adjustAffinity(ctx.t.db, a!.id, human.id, 0.9, ctx.t.clock.now());
    const g = (await get('/api/agents/graph')).json();
    expect(g.nodes).toHaveLength(50);
    expect(g.nodes.some((n: { id: string }) => n.id === human.id)).toBe(false);
    expect(g.edges).toEqual([{ a: [a!.id, b!.id].sort()[0], b: [a!.id, b!.id].sort()[1], score: 0.4 }]);
  });
  it('lists factions, papers, weather and lineage', async () => {
    const get = await setup();
    const trio = ctx.agents.slice(0, 3);
    for (const x of trio) for (const y of trio) if (x !== y) await adjustAffinity(ctx.t.db, x.id, y.id, 0.7, ctx.t.clock.now());
    await formFactions(ctx.d);
    const f = (await get('/api/factions')).json();
    expect(f.factions[0].members.map((m: { username: string }) => m.username).sort()).toEqual(trio.map((x) => x.username).sort());
    expect((await get('/api/papers/latest')).statusCode).toBe(404);
    await writePaper(ctx.d, '2026-10-08', { headline: 'H', stories: [{ title: 't', body: 'b' }], memeBrief: null }, 'local');
    expect((await get('/api/papers/latest')).json()).toMatchObject({ day: '2026-10-08', headline: 'H', source: 'local', memeUrl: null });
    expect((await get('/api/papers/2026-10-08')).statusCode).toBe(200);
  });
  it('lists a faction that split this week with the members it had when it split', async () => {
    const get = await setup();
    const trio = ctx.agents.slice(0, 4);
    for (const x of trio) for (const y of trio) if (x !== y) await adjustAffinity(ctx.t.db, x.id, y.id, 0.7, ctx.t.clock.now());
    await formFactions(ctx.d);
    const [f] = await ctx.t.db.select().from(factions);
    // One member walked out a day before the split; the rest were in it when it broke.
    const left = new Date(ctx.t.clock.now().getTime() - 86_400_000), splitAt = ctx.t.clock.now();
    await ctx.t.db.update(factionMembers).set({ leftAt: left }).where(and(eq(factionMembers.factionId, f!.id), eq(factionMembers.agentId, trio[3]!.id)));
    await ctx.t.db.update(factionMembers).set({ leftAt: splitAt }).where(and(eq(factionMembers.factionId, f!.id), isNull(factionMembers.leftAt)));
    await ctx.t.db.update(factions).set({ splitAt }).where(eq(factions.id, f!.id));
    const [view] = (await get('/api/factions')).json().factions;
    expect(view).toMatchObject({ id: f!.id, splitAt: splitAt.toISOString() });
    expect(view.members.map((m: { username: string }) => m.username).sort()).toEqual(trio.slice(0, 3).map((x) => x.username).sort());
  });
  it('shares one factions answer for 30 s', async () => {
    const get = await setup();
    expect((await get('/api/factions')).json().factions).toEqual([]);
    const trio = ctx.agents.slice(0, 3);
    for (const x of trio) for (const y of trio) if (x !== y) await adjustAffinity(ctx.t.db, x.id, y.id, 0.7, ctx.t.clock.now());
    await formFactions(ctx.d);
    ctx.t.clock.advance(29_000);
    expect((await get('/api/factions')).json().factions).toEqual([]);
    ctx.t.clock.advance(1_000);
    expect((await get('/api/factions')).json().factions).toHaveLength(1);
    expect((await get('/api/weather')).json().regime).toMatch(/^(euphoria|grind|fear|chaos)$/);
    const id = await recordLineage(ctx.t.db, { kind: 'line', text: 'ngmi {user}', situation: 'roast', inventorId: trio[0]!.id }, ctx.t.clock.now());
    expect((await get(`/api/lineage/${id}`)).json()).toMatchObject({ text: 'ngmi {user}', inventor: { username: trio[0]!.username }, uses: 1 });
  });
  it('serves an agent’s depth page data', async () => {
    const get = await setup();
    const [a, b, c] = ctx.agents;
    const human = await ctx.t.createUser('fan');
    await adjustAffinity(ctx.t.db, a!.id, b!.id, 0.6, ctx.t.clock.now());
    await adjustAffinity(ctx.t.db, a!.id, c!.id, -0.7, ctx.t.clock.now());
    await adjustAffinity(ctx.t.db, a!.id, human.id, 0.9, ctx.t.clock.now());
    const r = (await get(`/api/agents/${a!.username}/depth`)).json();
    expect(r).toMatchObject({ reputation: 0, faction: null, saidVsDid: [], debts: { lent: 0, borrowed: 0, defaulted: 0, owesSol: 0, recent: [] }, ghost: false, broke: false, mood: 0 });
    expect(typeof r.voice).toBe('string');
    expect(Object.keys(r.traits).sort()).toEqual(['chattiness', 'curiosity', 'greed', 'humor', 'loyalty', 'pettiness', 'risk']);
    expect(r.allies).toEqual([{ user: expect.objectContaining({ id: b!.id }), affinity: 0.6 }]); // the human is never listed
    expect(r.enemies).toEqual([{ user: expect.objectContaining({ id: c!.id }), affinity: -0.7 }]);
    expect((await get('/api/agents/nobody_here/depth')).statusCode).toBe(404);
  });

  it('shows said-vs-did only for public, live posts', async () => {
    const get = await setup();
    const a = ctx.agents[0]!;
    const now = ctx.t.clock.now();
    const mint = newId();
    await ctx.t.db.insert(worldCoins).values({ mint, pool: 'pool', creatorId: a.id, name: 'Moon', symbol: 'MOON', launchSignature: 'sig', launchedAt: now });
    const base = { authorId: a.id, kind: 'post' as const, createdAt: now };
    const [pub, priv, gone] = [newId(), newId(), newId()];
    await ctx.t.db.insert(posts).values([
      { ...base, id: pub, body: 'PUBLIC-LINE $MOON to the moon', visibility: 'public' },
      { ...base, id: priv, body: 'SENTINEL-COMMUNITY $MOON is great', visibility: 'community', communityId: 'private-c' },
      { ...base, id: gone, body: 'SENTINEL-DELETED $MOON forever', visibility: 'public', deletedAt: now },
    ]);
    for (const postId of [pub, priv, gone]) await ctx.t.db.insert(saidVsDid).values({ postId, agentId: a.id, mint, stance: 0.8, signature: `s-${postId}`, side: 'sell', at: now });
    const res = await get(`/api/agents/${a.username}/depth`);
    expect(res.json().saidVsDid).toEqual([{ postId: pub, mint, side: 'sell', said: 'PUBLIC-LINE $MOON to the moon', did: 'sold $MOON', at: now.toISOString() }]);
    expect(res.body).not.toContain('SENTINEL');
  });

  it('lists an agent’s debts: who with, how much, and whether it is open, repaid or dodged; agents only', async () => {
    const get = await setup();
    const [a, b, c, d] = ctx.agents;
    const human = await ctx.t.createUser('loan_shark');
    const now = ctx.t.clock.now();
    const ago = (h: number) => new Date(now.getTime() - h * 3600_000);
    const debt = (id: string, lenderId: string, borrowerId: string, lamports: number, h: number, x: { repaidAt?: Date; defaultedAt?: Date } = {}) =>
      ({ id, lenderId, borrowerId, lamports, signature: `sig-${id}`, createdAt: ago(h), ...x });
    await ctx.t.db.insert(debts).values([
      debt('d1', b!.id, a!.id, 20_000_000, 100, { defaultedAt: ago(28) }), // a dodged b
      debt('d2', c!.id, a!.id, 40_000_000, 2),                            // a owes c
      debt('d3', a!.id, d!.id, 10_000_000, 50, { repaidAt: ago(10) }),    // d paid a back
      debt('d4', human.id, a!.id, 500_000_000, 1),                        // a human is never the other side: not as the lender
      debt('d5', a!.id, human.id, 300_000_000, 3),                        // and not as the borrower
    ]);
    const r = (await get(`/api/agents/${a!.username}/depth`)).json();
    expect(r.debts).toMatchObject({ lent: 1, borrowed: 2, defaulted: 1, owesSol: 0.04 });
    expect(r.debts.recent).toEqual([
      { id: 'd2', side: 'borrowed', counterpart: expect.objectContaining({ id: c!.id, username: c!.username }), sol: 0.04, state: 'open', at: ago(2).toISOString() },
      { id: 'd3', side: 'lent', counterpart: expect.objectContaining({ id: d!.id }), sol: 0.01, state: 'repaid', at: ago(50).toISOString() },
      { id: 'd1', side: 'borrowed', counterpart: expect.objectContaining({ id: b!.id }), sol: 0.02, state: 'dodged', at: ago(100).toISOString() },
    ]);
    expect(JSON.stringify(r)).not.toContain(human.id);
    expect(JSON.stringify(r)).not.toContain('sig-');
  });

  it('gives a faction its banner picture once the spotlight has drawn one from its brief, and nothing before', async () => {
    const get = await setup();
    const trio = ctx.agents.slice(0, 3);
    for (const x of trio) for (const y of trio) if (x !== y) await adjustAffinity(ctx.t.db, x.id, y.id, 0.7, ctx.t.clock.now());
    await formFactions(ctx.d);
    // The brief keeps an emoji the stored template brief drops, so the match must go through the same cleanup.
    const brief = 'a lantern over still water 🏮';
    await ctx.t.db.update(factions).set({ banner: brief });
    const art = (fill: string): ImageGen => ({ async generate() { return { png: renderSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${fill}"/></svg>`), usd: 0.011 }; } });
    const limits = { usd: 1, max: 5 };
    expect((await get('/api/factions')).json().factions[0]).toMatchObject({ banner: brief, bannerUrl: null });
    // A picture drawn from the same words that is not a faction banner never counts.
    await generateTemplate({ db: ctx.t.db, gen: art('#112233'), limits, now: ctx.t.clock.now }, { brief, tags: ['idle'], authorId: trio[0]!.id });
    ctx.t.clock.advance(30_000); // past the factions cache
    expect((await get('/api/factions')).json().factions[0].bannerUrl).toBeNull();
    ctx.t.clock.advance(1000);
    await spotlightSweep({ db: ctx.t.db, bus: ctx.t.bus, now: ctx.t.clock.now, gen: art('#334455'), limits });
    const [tpl] = (await ctx.t.db.select().from(memeTemplates)).filter((m) => m.tags.includes('faction_cheer'));
    expect(tpl).toBeDefined();
    const url = `/api/blobs/${tpl!.blobId}`;
    ctx.t.clock.advance(30_000);
    expect((await get('/api/factions')).json().factions[0].bannerUrl).toBe(url);
    expect((await get(`/api/agents/${trio[0]!.username}/depth`)).json().faction.bannerUrl).toBe(url);
    expect((await get(url)).statusCode).toBe(200);
  });

  it('weather is deterministic for the day and returns the engine’s active regime when there is one', async () => {
    const get = await setup();
    const first = (await get('/api/weather')).json();
    expect(first).toMatchObject({ regime: expect.stringMatching(/^(euphoria|grind|fear|chaos)$/) });
    const rows = await ctx.t.db.select().from(weather);
    expect(rows).toHaveLength(1);
    // A second read sees the same active row and writes nothing.
    expect((await get('/api/weather')).json()).toEqual(first);
    expect(await ctx.t.db.select().from(weather)).toHaveLength(1);
    // The same day always rolls the same regime, so a GET adds no randomness.
    await ctx.t.db.delete(weather);
    expect((await get('/api/weather')).json()).toEqual(first);
  });

  it('shows reputation only from this database’s cache', async () => {
    const get = await setup();
    const a = ctx.agents[0]!;
    reputation.set(a.id, 0.9); // the singleton is still owned by another (or no) db
    expect((await get(`/api/agents/${a.username}/depth`)).json().reputation).toBe(0);
    await reputation.refresh(ctx.t.db, ctx.t.clock.now());
    reputation.set(a.id, 0.5);
    expect((await get(`/api/agents/${a.username}/depth`)).json().reputation).toBe(0.5);
    expect((await get('/api/agents/graph')).json().nodes.find((n: { id: string }) => n.id === a.id).reputation).toBe(0.5);
  });

  it('a paper exposes only its day, headline, stories, meme url and source', async () => {
    const get = await setup();
    await writePaper(ctx.d, '2026-10-09', { headline: 'H2', stories: [{ title: 't', body: 'b' }], memeBrief: 'a frog on a rocket' }, 'model');
    const p = (await get('/api/papers/2026-10-09')).json();
    expect(p).toEqual({ day: '2026-10-09', headline: 'H2', stories: [{ title: 't', body: 'b' }], memeUrl: null, source: 'model' });
    expect((await get('/api/papers/not-a-day')).statusCode).toBe(404);
    expect((await get('/api/lineage/nope')).statusCode).toBe(404);
  });

  it('lists the days that have an edition, newest first, at most 60, and nothing else', async () => {
    const get = await setup();
    expect((await get('/api/papers/days')).json()).toEqual({ days: [] });
    // 62 editions with gaps (every other day), written out of order.
    const day = (i: number) => new Date(Date.UTC(2026, 5, 1) + i * 2 * 86_400_000).toISOString().slice(0, 10);
    const rows = Array.from({ length: 62 }, (_, i) => ({ day: day(i), headline: `SECRET-HEADLINE-${i}`, body: { stories: [], memeBrief: 'SECRET-BRIEF', source: 'local' as const }, createdAt: ctx.t.clock.now() }));
    await ctx.t.db.insert(papers).values([...rows.slice(31), ...rows.slice(0, 31)]);
    const r = await get('/api/papers/days');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ days: Array.from({ length: 60 }, (_, i) => day(61 - i)) });
    expect(r.body).not.toMatch(/SECRET/);
  });
});
