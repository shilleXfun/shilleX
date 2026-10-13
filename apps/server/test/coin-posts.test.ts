import { describe, it, expect } from 'vitest';
import type { UserRow } from '../src/db/schema.ts';
import { worldTestCtx } from './world-helpers.ts';
import { runTool } from '../src/world/tools.ts';
import { Indexer } from '../src/world/indexer.ts';
import { Budget } from '../src/world/budget.ts';
import { registerAgentRoutes } from '../src/routes/agents.ts';

/** A world with the agent routes registered (production registers them in bootAgents, as test/agents-routes.test.ts notes). */
async function world() {
  const w = await worldTestCtx();
  const indexer = new Indexer(w.t.db, w.chain, w.t.clock.now, { balanceTtlMs: 0 });
  await registerAgentRoutes(w.t.app, { indexer, budget: new Budget(w.t.db, 1, w.t.clock.now), chain: w.chain, key: w.key, engine: null, moments: null, network: 'memory', startAgents: () => 'AGENTS is off' });
  return w;
}
type W = Awaited<ReturnType<typeof world>>;
const launch = async (w: W, a: UserRow, symbol: string) =>
  ((await runTool(await w.ctxFor(a), 'launch_coin', { name: symbol, symbol, description: 'x', emoji: '🦋', initial_buy_sol: 0.02 })).result as { mint: string }).mint;
const say = async (w: W, a: UserRow, body: string) => ((await runTool(await w.ctxFor(a), 'post', { body })).result as { post_id: string }).post_id;
const read = async (w: W, url: string) => { const r = await w.t.app.inject({ method: 'GET', url }); return { status: r.statusCode, body: r.json() }; };

describe('GET /api/coins/:mint/posts', () => {
  it('lists public posts that name the coin as a whole word, in any case, and nothing from communities, other tickers or deleted posts', async () => {
    const w = await world();
    const [a, b, c, d] = w.agents;
    const mint = await launch(w, a!, 'MOTH');
    const named = await say(w, b!, 'buying $MOTH before it runs');
    const lower = await say(w, c!, 'ok $moth, prove it');
    await say(w, d!, '$MOTHER is a different coin');
    const human = await w.t.createUser('club_owner');
    const club = await w.t.as(human).post('/api/communities', { name: 'Moth Club', slug: 'moth-club', description: 'x', visibility: 'public' });
    // POST /api/communities answers { community: CommunityDetail }, whose summary sits under .community.
    const inClub = await w.t.as(human).post('/api/posts', { body: '$MOTH in the club', communityId: club.body.community.community.id });
    expect(inClub.body.post.community?.slug).toBe('moth-club');
    const gone = await w.t.as(human).post('/api/posts', { body: '$MOTH to the moon' });
    await w.t.as(human).del(`/api/posts/${gone.body.post.id}`);
    const r = await read(w, `/api/coins/${mint}/posts`);
    expect(r.status).toBe(200);
    expect(new Set(r.body.items.map((p: { id: string }) => p.id))).toEqual(new Set([named, lower]));
    expect(r.body.nextCursor).toBeNull();
    await w.t.close();
  });
  it('leaves out posts from before the coin launched (a ticker can be reused once the old coin is a week old)', async () => {
    const w = await world();
    const [a, b, c] = w.agents;
    await say(w, b!, '$LAMP was the old one');
    w.t.clock.advance(60_000);
    const mint = await launch(w, a!, 'LAMP');
    w.t.clock.advance(60_000);
    const fresh = await say(w, c!, '$LAMP is back');
    expect((await read(w, `/api/coins/${mint}/posts`)).body.items.map((p: { id: string }) => p.id)).toEqual([fresh]);
    await w.t.close();
  });
  it('answers 404 for a coin that does not exist, and shares one answer for 15 seconds', async () => {
    const w = await world();
    const [a, b, c] = w.agents;
    expect((await read(w, '/api/coins/NOPE/posts')).status).toBe(404);
    const mint = await launch(w, a!, 'LAMP');
    await say(w, b!, '$LAMP looks bright');
    expect((await read(w, `/api/coins/${mint}/posts`)).body.items).toHaveLength(1);
    await say(w, c!, '$LAMP again');
    expect((await read(w, `/api/coins/${mint}/posts`)).body.items).toHaveLength(1);
    await w.t.close();
  });
});

describe('GET /api/agents/:username/trades', () => {
  it('lists one agent’s trades, newest first, and 404s for anyone else', async () => {
    const w = await world();
    const [a, b] = w.agents;
    const mint = await launch(w, a!, 'RUG');
    await runTool(await w.ctxFor(b!), 'buy', { mint, sol: 0.01, slippage_pct: null });
    await runTool(await w.ctxFor(a!), 'sell', { mint, tokens: null, all: true, slippage_pct: null });
    const r = await read(w, `/api/agents/${a!.username}/trades`);
    expect(r.status).toBe(200);
    expect(r.body.trades.map((t: { kind: string }) => t.kind)).toEqual(['sell', 'launch']);
    expect(r.body.trades.every((t: { agent: { id: string } }) => t.agent.id === a!.id)).toBe(true);
    expect((await read(w, '/api/agents/nobody_here/trades')).status).toBe(404);
    await w.t.close();
  });
});
