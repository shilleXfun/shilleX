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
import { registerAgentRoutes } from '../src/routes/agents.ts';
import { registerAdminRoutes } from '../src/routes/admin.ts';
import { finishTurn } from '../src/world/provenance.ts';
import { TREASURY, signerFor, walletOf } from '../src/world/wallets.ts';
import { agents as agentsTable, conversations, users, wallets } from '../src/db/schema.ts';
import { agentOnlyConversationIds } from '../src/services/backchannel.ts';
import { newId } from '../src/lib/ids.ts';
import { createSession, SESSION_COOKIE } from '../src/lib/auth.ts';

let w: Awaited<ReturnType<typeof worldTestCtx>>;
let postId = '', mint = '', convId = '', turnId = '';
let agentStarts = 0;
const get = async (url: string, cookie?: string) => { const r = await w.t.app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} }); return { status: r.statusCode, body: r.json(), raw: r.body }; };

beforeAll(async () => {
  w = await worldTestCtx();
  const handles = { indexer: new Indexer(w.t.db, w.chain, w.t.clock.now, { balanceTtlMs: 0 }), budget: new Budget(w.t.db, 20, w.t.clock.now), chain: w.chain, key: w.key, engine: null, moments: null, network: 'memory' as const, startAgents: () => { agentStarts++; return 'AGENTS is off'; } };
  await registerAgentRoutes(w.t.app, handles);
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
    expect((await get('/api/agents/info')).body).toMatchObject({ network: 'memory', agents: 50, runtime: 'off', budgetLevel: 'normal' });
    expect((await get(`/api/receipts/${turnId}`)).body.turn).toMatchObject({ id: turnId, reasoning: 'say hi', status: 'acted' });
    expect((await get(`/api/agents/${w.agents[0]!.username}/receipts`)).body.turns.length).toBeGreaterThan(0);
    expect((await get(`/api/agents/${w.agents[0]!.username}/chain/verify`)).body).toMatchObject({ ok: true });
  });
  it('lists backchannel conversations newest-activity first with their last message', async () => {
    const g = await runTool(await w.ctxFor(w.agents[2]!), 'start_group', { name: 'later', usernames: [w.agents[3]!.username] });
    const gid = (g.result as { conversation_id: string }).conversation_id;
    w.t.clock.advance(1000);
    await runTool(await w.ctxFor(w.agents[3]!), 'chat', { channel_id: null, conversation_id: gid, body: 'newest words', reply_to_id: null });
    const list = (await get('/api/agents/backchannel')).body.conversations as { id: string; lastMessage: { body: string } | null }[];
    expect(list[0]).toMatchObject({ id: gid, lastMessage: { body: 'newest words' } });
    expect(list.find((c) => c.id === convId)?.lastMessage?.body).toBe('secret plan: pump it');
  });
  it('shows agent-only DMs in the backchannel', async () => {
    expect((await get('/api/agents/backchannel')).body.conversations.map((c: { id: string }) => c.id)).toContain(convId);
    expect(JSON.stringify((await get(`/api/agents/backchannel/${convId}/messages`)).body)).toContain('secret plan');
  });
  it('serves coins, trades, the leaderboard, agent pages, avatars and metadata', async () => {
    expect((await get('/api/coins')).body.coins[0]).toMatchObject({ mint, symbol: 'PEEK' });
    expect((await get(`/api/coins/${mint}`)).body.trades[0]).toMatchObject({ kind: 'launch' });
    expect((await get('/api/coins/trades')).body.trades.length).toBeGreaterThan(0);
    expect((await get('/api/leaderboard')).body.agents).toHaveLength(50);
    expect((await get(`/api/agents/${w.agents[1]!.username}`)).body.agent.positions[0]).toMatchObject({ symbol: 'PEEK' });
    const av = await w.t.app.inject({ method: 'GET', url: `/api/agents/avatars/${w.agents[0]!.id}.svg` });
    expect(av.headers['content-type']).toContain('image/svg+xml');
    expect((await get(`/api/agents/coin-meta/${w.agents[1]!.id}/PEEK.json`)).body).toMatchObject({ name: 'Peek', symbol: 'PEEK' });
  });
  it('no route or receipt contains any wallet secret', async () => {
    const secrets: string[] = [];
    for (const row of await w.t.db.select().from(wallets)) {
      const kp = await signerFor(w.t.db, row.ownerId, w.key);
      secrets.push(row.encryptedSecret, bs58.encode(kp.secretKey), Buffer.from(kp.secretKey).toString('base64'), JSON.stringify(Array.from(kp.secretKey)).slice(1, 60));
    }
    const urls = ['/api/agents/info', '/api/agents/backchannel', `/api/agents/backchannel/${convId}/messages`,
      '/api/coins', `/api/coins/${mint}`, '/api/coins/trades', '/api/leaderboard', `/api/receipts/${turnId}`,
      ...w.agents.slice(0, 3).flatMap((a) => [`/api/agents/${a.username}`, `/api/agents/${a.username}/receipts`])];
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
    const setUp = () => w.t.app.inject({ method: 'POST', url: '/api/admin/world/fund', headers: { cookie } });
    const broke = await setUp();
    expect(broke.statusCode).toBe(409);
    expect(broke.json()).toMatchObject({ code: 'TREASURY_EMPTY', message: expect.stringMatching(/top it up with devnet SOL/) });
    expect(agentStarts).toBe(0);
    w.chain.airdrop((await walletOf(w.t.db, TREASURY))!.publicKey, 10_000_000_000);
    const ok = await setUp();
    expect(ok.json()).toMatchObject({ launchpad: null, funded: 50, skipped: 0, agents: 'AGENTS is off' });
    expect(agentStarts).toBe(1);
  });
});


describe('one Shillex: humans act next to agents', () => {
  it('lets humans sign up and post, and agents keep their sessions', async () => {
    const t = await makeTestApp({ config: loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 's', WORLD_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=' }) });
    expect((await t.as(null).post('/api/auth/signup', { username: 'real_person', displayName: 'Real', password: 'password1' })).status).toBe(201);
    const human = await t.createUser('somehuman');
    expect((await t.as(human).post('/api/posts', { body: 'hi agents' })).status).toBe(201);
    await t.close();
  });
});

describe('backchannel privacy (spec §3c)', () => {
  it('lists only all-agent conversations and 404s a human-agent DM', async () => {
    const human = await w.t.createUser('a_human');
    const A = w.agents[0]!, B = w.agents[1]!;
    const agentDm = await runTool(await w.ctxFor(A), 'start_dm', { username: B.username, body: 'agents only' });
    const humanDm = await w.t.as(human).post('/api/conversations', { kind: 'dm', username: A.username });
    await w.t.as(human).post(`/api/conversations/${humanDm.body.conversation.id}/messages`, { body: 'my private words' });
    const list = (await w.t.as(null).get('/api/agents/backchannel')).body.conversations;
    expect(list.map((c: any) => c.id)).toContain((agentDm.result as any).conversation_id);
    expect(JSON.stringify(list)).not.toContain('my private words');
    expect((await w.t.as(null).get(`/api/agents/backchannel/${humanDm.body.conversation.id}/messages`)).status).toBe(404);
  });
});

describe('agentOnlyConversationIds without ids (the backchannel poll)', () => {
  it('starts from conversations with an agent in them and finds exactly what checking every conversation finds', async () => {
    const [h1, h2] = [await w.t.createUser('dm_one'), await w.t.createUser('dm_two')];
    const humans = await w.t.as(h1).post('/api/conversations', { kind: 'dm', username: h2.username });
    await w.t.as(h1).post(`/api/conversations/${humans.body.conversation.id}/messages`, { body: 'between two humans' });
    const all = (await w.t.db.select({ id: conversations.id }).from(conversations)).map((c) => c.id);
    expect(all).toContain(humans.body.conversation.id);
    const listed = await agentOnlyConversationIds(w.t.db);
    expect(listed).not.toContain(humans.body.conversation.id);
    expect(listed).toContain(convId);
    expect([...listed].sort()).toEqual([...await agentOnlyConversationIds(w.t.db, all)].sort());
  });
});

describe('an agent page without an agent', () => {
  it('answers 404 for an agent user with no agents row, and for a human, as for a name nobody has', async () => {
    const id = newId();
    await w.t.db.insert(users).values({ id, username: 'half_made', displayName: '', kind: 'agent', createdAt: new Date() });
    const human = await w.t.createUser('just_a_human');
    for (const name of ['half_made', human.username, 'nobody_at_all']) {
      const r = await get(`/api/agents/${name}`);
      expect(r.status, name).toBe(404);
      expect(r.body).toMatchObject({ code: 'NOT_FOUND' });
    }
  });
});

describe('agent summaries', () => {
  it('mark agents with isAgent and leave human summaries unchanged', async () => {
    const lb = (await w.t.as(null).get('/api/leaderboard')).body.agents;
    expect(lb[0].user.isAgent).toBe(true);
    const human = await w.t.createUser('plain_human');
    const r = await w.t.as(human).post('/api/posts', { body: 'hello' });
    expect('isAgent' in r.body.post.author).toBe(false);
  });
});

describe('backchannel privacy after a human leaves a group', () => {
  it('does not list the group or serve its messages', async () => {
    const human = await w.t.createUser('leaver');
    const A = w.agents[6]!, B = w.agents[7]!;
    const g = await w.t.as(human).post('/api/conversations', { kind: 'group', name: 'trio', usernames: [A.username, B.username] });
    const gid = g.body.conversation.id;
    await w.t.as(human).post(`/api/conversations/${gid}/messages`, { body: 'leaver private words' });
    await runTool(await w.ctxFor(A), 'chat', { channel_id: null, conversation_id: gid, body: 'agent reply' });
    expect((await w.t.as(human).del(`/api/conversations/${gid}/members/me`)).status).toBe(204);
    const list = (await w.t.as(null).get('/api/agents/backchannel')).body.conversations;
    expect(list.map((c: any) => c.id)).not.toContain(gid);
    expect(JSON.stringify(list)).not.toContain('leaver private words');
    expect((await w.t.as(null).get(`/api/agents/backchannel/${gid}/messages`)).status).toBe(404);
  });
});
