import { describe, it, expect, afterEach } from 'vitest';
import { depthTestCtx } from './depth-helpers.ts';
import { registerDepthRoutes } from '../src/routes/depth.ts';
import { Indexer } from '../src/world/indexer.ts';
import { adjustAffinity } from '../src/agents/state.ts';
import { formFactions } from '../src/agents/depth/factions.ts';
import { writePaper } from '../src/agents/depth/paper.ts';
import { recordLineage } from '../src/agents/depth/lineage.ts';
import { posts, saidVsDid, weather, worldCoins } from '../src/db/schema.ts';
import { newId } from '../src/lib/ids.ts';
import { reputation } from '../src/agents/depth/reputation.ts';

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
    expect(r).toMatchObject({ reputation: 0, faction: null, saidVsDid: [], debts: { lent: 0, borrowed: 0, defaulted: 0 }, ghost: false, broke: false, mood: 0 });
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
});
