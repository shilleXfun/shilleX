import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import bs58 from 'bs58';
import { hash } from '@node-rs/argon2';
import { worldTestCtx } from './world-helpers.ts';
import { makeTestApp } from './helpers.ts';
import { loadConfig } from '../src/config.ts';
import { runTool } from '../src/world/tools.ts';
import { Indexer } from '../src/world/indexer.ts';
import { Budget } from '../src/world/budget.ts';
import { registerWorldRoutes } from '../src/routes/world.ts';
import { registerAdminRoutes } from '../src/routes/admin.ts';
import { finishTurn } from '../src/world/provenance.ts';
import { signerFor } from '../src/world/wallets.ts';
import { agents as agentsTable, users, wallets } from '../src/db/schema.ts';
import { newId } from '../src/lib/ids.ts';
import { createSession, SESSION_COOKIE } from '../src/lib/auth.ts';

let w: Awaited<ReturnType<typeof worldTestCtx>>;
let postId = '', mint = '', convId = '', turnId = '';
const get = async (url: string, cookie?: string) => { const r = await w.t.app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} }); return { status: r.statusCode, body: r.json(), raw: r.body }; };

beforeAll(async () => {
  w = await worldTestCtx();
  const handles = { indexer: new Indexer(w.t.db, w.chain, w.t.clock.now, { balanceTtlMs: 0 }), budget: new Budget(w.t.db, 20, w.t.clock.now), chain: w.chain, key: w.key, runtime: null, network: 'memory' as const };
  await registerWorldRoutes(w.t.app, handles);
  await registerAdminRoutes(w.t.app, handles);
  const A = w.agents[0]!, B = w.agents[1]!;
  const ctxA = await w.ctxFor(A);
  turnId = ctxA.turnId;
  postId = ((await runTool(ctxA, 'post', { body: 'hello watchers' })).result as { post_id: string }).post_id;
  const read = await runTool(ctxA, 'read_wallet', { username: null }); // a turn that reads a wallet must still never leak a secret
  await finishTurn(w.t.db, turnId, { status: 'acted', context: [{ kind: 'trigger', text: 'heartbeat' }], reasoning: 'say hi', toolCalls: [{ name: 'post', input: { body: 'hello watchers' }, ok: true, result: { post_id: postId } }, { name: 'read_wallet', input: { username: null }, ok: read.ok, result: read.result }], usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, costUsd: 0.01, finishedAt: w.t.clock.now() });
  convId = ((await runTool(await w.ctxFor(A), 'start_dm', { username: B.username, body: 'secret plan: pump it' })).result as { conversation_id: string }).conversation_id;
  await runTool(await w.ctxFor(B), 'create_community', { name: 'Hidden', slug: 'hidden', description: 'invite only', visibility: 'invite' });
  mint = ((await runTool(await w.ctxFor(B), 'launch_coin', { name: 'Peek', symbol: 'PEEK', description: '', emoji: '👀', initial_buy_sol: 0.01 })).result as { mint: string }).mint;
});
afterAll(() => w.t.close());

describe('world routes (anonymous viewer)', () => {
  it('serves info, feed, thread and receipts without a session', async () => {
    expect((await get('/api/world/info')).body).toMatchObject({ worldMode: true, network: 'memory', agents: 50, runtime: 'off', budgetLevel: 'normal' });
    const feed = await get('/api/world/feed');
    expect(feed.body.posts[0]).toMatchObject({ id: postId, turnId });
    expect((await get(`/api/world/posts/${postId}`)).body.post.body).toBe('hello watchers');
    expect((await get(`/api/world/turns/${turnId}`)).body.turn).toMatchObject({ id: turnId, reasoning: 'say hi', status: 'acted' });
    expect((await get(`/api/world/agents/${w.agents[0]!.username}/turns`)).body.turns.length).toBeGreaterThan(0);
    expect((await get(`/api/world/agents/${w.agents[0]!.username}/chain/verify`)).body).toMatchObject({ ok: true });
  });
  it('filters the feed by author, replies included', async () => {
    const posts = (await get(`/api/world/feed?author=${w.agents[0]!.username}`)).body.posts;
    expect(posts.length).toBeGreaterThan(0);
    expect(posts.every((p: { author: { id: string } }) => p.author.id === w.agents[0]!.id)).toBe(true);
    expect((await get('/api/world/feed?author=nobody_here')).status).toBe(404);
  });
  it('shows DMs and invite-only communities to everyone', async () => {
    expect((await get('/api/world/conversations')).body.conversations.map((c: { id: string }) => c.id)).toContain(convId);
    expect(JSON.stringify((await get(`/api/world/conversations/${convId}/messages`)).body)).toContain('secret plan');
    const comms = (await get('/api/world/communities')).body.communities;
    const hidden = comms.find((c: { slug: string }) => c.slug === 'hidden');
    expect(hidden.channels[0].name).toBe('general');
    expect((await get('/api/world/communities/hidden')).body.members).toHaveLength(1);
  });
  it('serves coins, trades, the leaderboard, agent pages, avatars and metadata', async () => {
    expect((await get('/api/world/coins')).body.coins[0]).toMatchObject({ mint, symbol: 'PEEK' });
    expect((await get(`/api/world/coins/${mint}`)).body.trades[0]).toMatchObject({ kind: 'launch' });
    expect((await get('/api/world/trades')).body.trades.length).toBeGreaterThan(0);
    expect((await get('/api/world/leaderboard')).body.agents).toHaveLength(50);
    expect((await get(`/api/world/agents/${w.agents[1]!.username}`)).body.agent.positions[0]).toMatchObject({ symbol: 'PEEK' });
    const av = await w.t.app.inject({ method: 'GET', url: `/api/world/avatars/${w.agents[0]!.id}.svg` });
    expect(av.headers['content-type']).toContain('image/svg+xml');
    expect((await get(`/api/world/coin-meta/${w.agents[1]!.id}/PEEK.json`)).body).toMatchObject({ name: 'Peek', symbol: 'PEEK' });
  });
  it('no route or receipt contains any wallet secret', async () => {
    const secrets: string[] = [];
    for (const row of await w.t.db.select().from(wallets)) {
      const kp = await signerFor(w.t.db, row.ownerId, w.key);
      secrets.push(row.encryptedSecret, bs58.encode(kp.secretKey), Buffer.from(kp.secretKey).toString('base64'), JSON.stringify(Array.from(kp.secretKey)).slice(1, 60));
    }
    const urls = ['/api/world/info', '/api/world/feed', '/api/world/communities', '/api/world/conversations', `/api/world/conversations/${convId}/messages`,
      '/api/world/coins', `/api/world/coins/${mint}`, '/api/world/trades', '/api/world/leaderboard', `/api/world/turns/${turnId}`,
      ...w.agents.slice(0, 3).flatMap((a) => [`/api/world/agents/${a.username}`, `/api/world/agents/${a.username}/turns`])];
    for (const u of urls) {
      const { raw } = await get(u);
      for (const s of secrets) expect(raw.includes(s), `${u} leaked a secret`).toBe(false);
    }
  });
});

describe('admin routes', () => {
  it('reject anonymous users and let the admin pause an agent', async () => {
    expect((await w.t.app.inject({ method: 'GET', url: '/api/admin/world' })).statusCode).toBe(401);
    const id = newId();
    await w.t.db.insert(users).values({ id, username: 'admin', displayName: 'admin', passwordHash: await hash('pw-pw-pw-pw'), createdAt: new Date() });
    const cookie = `${SESSION_COOKIE}=${await createSession(w.t.db, id, w.t.clock.now())}`;
    expect((await get('/api/admin/world', cookie)).body).toMatchObject({ budgetLevel: 'normal' });
    const r = await w.t.app.inject({ method: 'POST', url: `/api/admin/world/agents/${w.agents[5]!.username}/pause`, headers: { cookie } });
    expect(r.statusCode).toBe(204);
    expect((await w.t.db.select().from(agentsTable).where(eq(agentsTable.userId, w.agents[5]!.id)))[0]!.status).toBe('paused');
    const other = await w.t.createUser('someone_else');
    expect((await get('/api/admin/world', other.cookie)).status).toBe(403);
  });
});

describe('world mode is read-only for humans', () => {
  it('blocks human writes and signups but allows agent sessions and login', async () => {
    const t = await makeTestApp({ config: loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 's', WORLD_MODE: 'agents' }) });
    const human = await t.createUser('somehuman');
    expect((await t.as(human).post('/api/posts', { body: 'let me in' })).status).toBe(403);
    expect((await t.as(null).post('/api/auth/signup', { username: 'x_x_x', displayName: 'x', password: 'password1' })).status).toBe(403);
    expect((await t.as(null).post('/api/auth/demo')).status).toBe(403);
    const agent = await t.createUser('agent_99');
    await t.db.update(users).set({ kind: 'agent' }).where(eq(users.id, agent.id));
    expect((await t.as(agent).post('/api/posts', { body: 'agents may' })).status).toBe(201);
    expect((await t.as(null).post('/api/auth/login', { username: 'nobody', password: 'nope-nope' })).status).not.toBe(403);
    await t.close();
  });
});
