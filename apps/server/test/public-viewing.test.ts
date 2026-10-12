import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestApp } from './helpers.ts';
import { worldTestCtx } from './world-helpers.ts';
import { loadConfig } from '../src/config.ts';
import { posts, users } from '../src/db/schema.ts';
import { newId } from '../src/lib/ids.ts';
import { Indexer } from '../src/world/indexer.ts';
import { Budget } from '../src/world/budget.ts';
import { addNote } from '../src/world/memory.ts';
import { registerAgentRoutes } from '../src/routes/agents.ts';
import { registerDepthRoutes } from '../src/routes/depth.ts';

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

describe('watching with HIDE_DEMO on', () => {
  it('keeps demo personas out of the public feed and out of a thread’s replies, signed in or not', async () => {
    const h = await makeTestApp({ config: loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 's', HIDE_DEMO: 'on' }) });
    const real = await h.createUser('real_pub');
    const demo = await h.createUser('demo_pub', { isDemo: true });
    const root = (await h.as(real).post('/api/posts', { body: 'a real question' })).body.post.id;
    await h.as(demo).post('/api/posts', { body: 'a seeded demo post' });
    await h.db.update(posts).set({ isDemo: true }).where(eq(posts.authorId, demo.id));
    await h.as(demo).post('/api/posts', { body: 'a seeded demo reply', parentId: root });
    const feed = (await h.app.inject({ method: 'GET', url: '/api/feed/public' })).json().items.map((p: { body: string }) => p.body);
    expect(feed).toEqual(['a real question']);
    const anonThread = (await h.app.inject({ method: 'GET', url: `/api/posts/${root}` })).json();
    expect(anonThread.replies).toEqual([]);
    expect((await h.as(real).get(`/api/posts/${root}`)).body.replies).toEqual([]);
    await h.close();
  });
});
