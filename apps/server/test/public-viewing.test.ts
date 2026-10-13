import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestApp } from './helpers.ts';
import { worldTestCtx } from './world-helpers.ts';
import { loadConfig } from '../src/config.ts';
import { agentTurns, posts, users } from '../src/db/schema.ts';
import { finishTurn, startTurn } from '../src/world/provenance.ts';
import { newId } from '../src/lib/ids.ts';
import { Indexer } from '../src/world/indexer.ts';
import { Budget } from '../src/world/budget.ts';
import { addNote } from '../src/world/memory.ts';
import { registerAgentRoutes } from '../src/routes/agents.ts';
import { registerDepthRoutes } from '../src/routes/depth.ts';
import { HUMAN_PURPOSE } from '../src/agents/types.ts';

let t: Awaited<ReturnType<typeof makeTestApp>>;
let publicId = '', privateId = '', repostId = '';
beforeAll(async () => {
  t = await makeTestApp();
  const alice = await t.createUser('alice_pub');
  const bob = await t.createUser('bob_pub');
  publicId = (await t.as(alice).post('/api/posts', { body: 'hello watchers' })).body.post.id;
  const c = await t.as(alice).post('/api/communities', { name: 'Secret Club', slug: 'secret-club', visibility: 'private', description: '' });
  expect(c.status).toBe(201);
  const members = await t.as(alice).post('/api/posts', { body: 'members only', communityId: c.body.community.community.id });
  expect(members.status).toBe(201);
  privateId = members.body.post.id;
  const dm = await t.as(alice).post('/api/conversations', { kind: 'dm', username: 'bob_pub' });
  expect((await t.as(alice).post(`/api/conversations/${dm.body.conversation.id}/messages`, { body: 'private hi' })).status).toBe(201);
  // A repost whose target is deleted afterwards: the public feed drops it, like the following tab does.
  const doomed = (await t.as(bob).post('/api/posts', { body: 'soon gone' })).body.post.id;
  repostId = (await t.as(alice).post(`/api/posts/${doomed}/repost`)).body.post.id;
  expect((await t.as(bob).del(`/api/posts/${doomed}`)).status).toBe(204);
});
afterAll(() => t.close());

const anon = (url: string) => t.app.inject({ method: 'GET', url });

describe('watching without an account', () => {
  it('serves the public feed without a session, without community posts and with no viewer state', async () => {
    expect(privateId).not.toBe('');
    const r = await anon('/api/feed/public');
    expect(r.statusCode).toBe(200);
    const bodies = r.json().items.map((p: { body: string }) => p.body);
    expect(bodies).toContain('hello watchers');
    expect(bodies).not.toContain('members only');
    expect(r.json().items[0].viewer).toMatchObject({ bookmarked: false, reposted: false });
  });
  it('serves only rows marked public, even one with no community left on it', async () => {
    const [alice] = await t.db.select().from(users).where(eq(users.username, 'alice_pub'));
    await t.db.insert(posts).values({ id: newId(), authorId: alice!.id, kind: 'post', body: 'marked for members', visibility: 'community', createdAt: t.clock.now() });
    expect((await anon('/api/feed/public')).body).not.toContain('marked for members');
  });
  it('drops reposts of deleted posts from the public feed', async () => {
    const ids = (await anon('/api/feed/public')).json().items.map((p: { id: string }) => p.id);
    expect(ids).not.toContain(repostId);
  });
  it('pages the public feed newest first', async () => {
    const first = (await anon('/api/feed/public?limit=1')).json();
    expect(first.nextCursor).not.toBeNull();
    const second = (await anon(`/api/feed/public?limit=1&cursor=${first.nextCursor}`)).json();
    expect(second.items.map((p: { body: string }) => p.body)).toEqual(['hello watchers']);
    expect(second.items[0].id < first.nextCursor).toBe(true);
  });
  it('filters the public feed to one author for an agent page', async () => {
    const r = await anon('/api/feed/public?author=ALICE_PUB');
    expect(r.statusCode).toBe(200);
    expect(r.json().items.map((p: { author: { username: string } }) => p.author.username)).toEqual(['alice_pub']);
    expect((await anon('/api/feed/public?author=nobody_here')).statusCode).toBe(404);
  });
  it('serves a public thread without a session and still hides private-community posts', async () => {
    const thread = await anon(`/api/posts/${publicId}`);
    expect(thread.statusCode).toBe(200);
    expect(thread.json().post.viewer).toMatchObject({ bookmarked: false, reposted: false, subscribed: false, canAddCallUpdate: false });
    expect((await anon(`/api/posts/${privateId}`)).statusCode).toBe(404);
  });
  it('keeps private things private', async () => {
    for (const url of ['/api/conversations', '/api/feed?tab=following', '/api/notifications', '/api/bookmarks']) {
      expect((await anon(url)).statusCode, url).toBe(401);
    }
    expect((await anon('/api/feed/public')).body).not.toContain('private hi');
    expect((await anon('/api/feed/public?author=alice_pub')).body).not.toContain('private hi');
  });
  it('serves the agent pages’ data without a session, with no memory notes', async () => {
    // Agent and depth routes are mounted by bootAgents (WORLD_KEY) in production; here they are registered by hand on a seeded world.
    const w = await worldTestCtx();
    const indexer = new Indexer(w.t.db, w.chain, w.t.clock.now, { balanceTtlMs: 0 });
    await registerAgentRoutes(w.t.app, { indexer, budget: new Budget(w.t.db, 1, w.t.clock.now), chain: w.chain, key: w.key, engine: null, moments: null, network: 'memory', startAgents: () => 'AGENTS is off' });
    await registerDepthRoutes(w.t.app, { indexer });
    for (const url of ['/api/agents/overview', '/api/agents/graph', '/api/weather', '/api/coins', '/api/leaderboard']) {
      expect((await w.t.app.inject({ method: 'GET', url })).statusCode, url).toBe(200);
    }
    // A memory note is free text with no record of the turn that wrote it, and the retired runtime wrote them in turns
    // that read human DMs, so no note reaches a public route.
    const a = w.agents[0]!;
    await addNote(w.t.db, a.id, 'SENTINEL-NOTE they DMed me their seed phrase', w.t.clock.now());
    const page = await w.t.app.inject({ method: 'GET', url: `/api/agents/${a.username}` });
    expect(page.statusCode).toBe(200);
    expect(page.json().agent.memory).toEqual([]);
    expect(page.body).not.toContain('SENTINEL-NOTE');
    await w.t.close();
  });
});

describe('receipts from the retired model runtime', () => {
  // The second run's trigger carries today's human-reply note: the full scrub must still run for it (re-review E).
  it.each([{}, { note: HUMAN_PURPOSE }])('serve no DM text, no memory note and no private tool input, and the chain still verifies (%o)', async (extra) => {
    const w = await worldTestCtx();
    const indexer = new Indexer(w.t.db, w.chain, w.t.clock.now, { balanceTtlMs: 0 });
    await registerAgentRoutes(w.t.app, { indexer, budget: new Budget(w.t.db, 1, w.t.clock.now), chain: w.chain, key: w.key, engine: null, moments: null, network: 'memory', startAgents: () => 'AGENTS is off' });
    const agent = w.agents[4]!;
    const human = await w.t.createUser('dm_human');
    const conv = (await w.t.as(human).post('/api/conversations', { kind: 'dm', username: agent.username })).body.conversation.id as string;
    const msg = await w.t.as(human).post(`/api/conversations/${conv}/messages`, { body: 'SENTINEL-DM my seed is apple banana' });
    expect(msg.status).toBe(201);
    // A turn exactly as the Opus runtime (world-v2) sealed it: woken by the DM, with the DM and every note in its context.
    const { id } = await startTurn(w.t.db, { agentId: agent.id, triggers: [{ type: 'dm', refId: conv, byUserId: human.id, ...extra }], model: 'claude-opus-4-1', effort: 'medium', promptVersion: 'world-v2', snapshotId: null, now: w.t.clock.now() });
    await finishTurn(w.t.db, id, {
      status: 'acted', finishedAt: w.t.clock.now(), usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 }, costUsd: 0.01,
      context: [
        { kind: 'trigger', ref: conv, text: `A message arrived in conversation ${conv}.` },
        { kind: 'message', ref: msg.body.message.id, text: `Message ${msg.body.message.id} by dm_human in conversation ${conv}: SENTINEL-DM my seed is apple banana` },
        { kind: 'memory', text: '- [n0] SENTINEL-NOTE-OLD dm_human trusts me' },
      ],
      reasoning: 'They told me SENTINEL-DM their seed. I should remember it.',
      toolCalls: [
        { name: 'remember', input: { note: 'SENTINEL-NOTE dm_human seed is apple banana' }, ok: true, result: { note_id: 'n1' } },
        { name: 'chat', input: { conversation_id: conv, channel_id: null, body: 'SENTINEL-REPLY never share that', reply_to_id: null }, ok: true, result: { message_id: 'm2' } },
        { name: 'post', input: { body: 'public hello from the old days' }, ok: true, result: { post_id: 'p1' } },
      ],
    });
    const [row] = await w.t.db.select().from(agentTurns).where(eq(agentTurns.id, id));
    const one = await w.t.app.inject({ method: 'GET', url: `/api/receipts/${id}` });
    const list = await w.t.app.inject({ method: 'GET', url: `/api/agents/${agent.username}/receipts` });
    for (const r of [one, list]) {
      expect(r.statusCode).toBe(200);
      expect(r.body).not.toContain('SENTINEL');
      expect(r.body).not.toContain('apple banana');
      expect(r.body).not.toContain(conv);
      expect(r.body).not.toContain(human.id);
    }
    const turn = one.json().turn;
    expect(turn).toMatchObject({ context: [], reasoning: '', triggers: [{ type: 'dm' }], hash: row!.hash, prevHash: row!.prevHash });
    expect(turn.toolCalls).toEqual([
      { name: 'remember', input: { private: true }, ok: true, result: { private: true } },
      { name: 'chat', input: { private: true }, ok: true, result: { private: true } },
      { name: 'post', input: { body: 'public hello from the old days' }, ok: true, result: { post_id: 'p1' } },
    ]);
    // The scrub happens when the receipt is served; the stored turn and its hash chain are untouched.
    expect(JSON.stringify(row!.context)).toContain('SENTINEL-DM');
    expect((await w.t.app.inject({ method: 'GET', url: `/api/agents/${agent.username}/chain/verify` })).json()).toMatchObject({ ok: true, brokenAtSeq: null });
    await w.t.close();
  });
});

describe('watching with HIDE_DEMO on', () => {
  it('keeps demo personas out of the public feed and out of a thread’s replies, signed in or not', async () => {
    const h = await makeTestApp({ config: loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 's', HIDE_DEMO: 'on' }) });
    const real = await h.createUser('real_pub');
    const demo = await h.createUser('demo_pub', { isDemo: true });
    const root = (await h.as(real).post('/api/posts', { body: 'a real question' })).body.post.id;
    // Posted through the route, as a seeded persona's posts are: the post row itself is not flagged, its author is.
    const demoPost = (await h.as(demo).post('/api/posts', { body: 'a seeded demo post' })).body.post.id;
    expect((await h.db.select().from(posts).where(eq(posts.id, demoPost)))[0]!.isDemo).toBe(false);
    const repost = (await h.as(real).post(`/api/posts/${demoPost}/repost`)).body.post.id;
    await h.as(demo).post('/api/posts', { body: 'a seeded demo reply', parentId: root });
    const page = (await h.app.inject({ method: 'GET', url: '/api/feed/public' })).json();
    expect(page.items.map((p: { body: string }) => p.body)).toEqual(['a real question']);
    expect(page.items.map((p: { id: string }) => p.id)).not.toContain(repost);
    expect((await h.app.inject({ method: 'GET', url: '/api/feed/public?author=demo_pub' })).json().items).toEqual([]);
    const anonThread = (await h.app.inject({ method: 'GET', url: `/api/posts/${root}` })).json();
    expect(anonThread.replies).toEqual([]);
    expect((await h.as(real).get(`/api/posts/${root}`)).body.replies).toEqual([]);
    await h.close();
  });
});
