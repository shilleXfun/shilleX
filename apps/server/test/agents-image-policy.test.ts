import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestApp } from './helpers.ts';
import { worldTestCtx } from './world-helpers.ts';
import { renderSvg } from '../src/agents/cards.ts';
import { blobUpload, storeBlob } from '../src/agents/images.ts';
import { createImagePolicy, imageWanted, TEMPLATE_GAP_POSTS } from '../src/agents/image-policy.ts';
import { fallbackPhrasebook } from '../src/agents/phrasebook.ts';
import { lineage, memeRenders, memeTemplates, posts, uploads, users } from '../src/db/schema.ts';
import { newId } from '../src/lib/ids.ts';
import { runTool } from '../src/world/tools.ts';
import type { AgentView, Candidate } from '../src/agents/types.ts';
import { emptyDepth } from '../src/agents/depth/registry.ts';
import { mulberry32 } from '../src/seed/rng.ts';

let t: Awaited<ReturnType<typeof makeTestApp>>;
let agentId = '';
let colour = 0;
beforeEach(async () => {
  t = await makeTestApp();
  agentId = newId();
  await t.db.insert(users).values({ id: agentId, username: 'nine', displayName: 'Nine', kind: 'agent', createdAt: t.clock.now() });
});
afterEach(() => t.close());

const view = (over: Partial<AgentView> = {}): AgentView => {
  const pb = fallbackPhrasebook('nine');
  pb.memeCaptions = [{ situation: 'idle', top: 'me at 3am', bottom: 'refreshing the chart' }, { situation: 'idle', top: 'nobody:', bottom: 'me: one more trade' }];
  return {
    agent: { id: agentId, username: 'nine', displayName: 'Nine' },
    state: { energy: 1, mood: 0, traits: { ...pb.traits, humor: 1 }, cooldowns: {}, recentLines: [], brokeSince: null, ghostSince: null },
    phrasebook: pb,
    wallet: { lamports: 50_000_000, positions: [] },
    coins: [{ mint: 'M1', symbol: 'MOTH', creatorId: 'x', priceLamports: 1, change10m: 0.4, change1h: 0.9, holders: 5, graduated: false, launchedAt: '2026-10-09T00:00:00Z' }],
    mentions: [], dms: [], feed: [], rooms: [], affinity: {}, weather: 'grind', now: t.clock.now().toISOString(), depth: emptyDepth(), ...over,
  };
};
const meme: Candidate = { kind: 'post', score: 1, reason: 'test', situation: 'idle' };
const template = async (tags: string[] = ['idle']) => {
  // A distinct colour per template, so no two share a blob (deterministic, no Math.random).
  const fill = (++colour * 2654435761 % 0xffffff).toString(16).padStart(6, '0');
  const png = renderSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#${fill}"/></svg>`);
  const blob = await storeBlob(t.db, png, 'image/png', t.clock.now());
  const id = newId();
  await t.db.insert(memeTemplates).values({ id, blobId: blob.id, brief: 'b', tags, authorId: agentId, createdAt: t.clock.now() });
  return id;
};
const addPosts = async (n: number) => {
  for (let i = 0; i < n; i++) await t.db.insert(posts).values({ id: newId(), authorId: agentId, kind: 'post', body: `p${i}`, visibility: 'public', createdAt: t.clock.now() });
};
const uploadOf = async (r: { uploadId: string } | null) => (await t.db.select().from(uploads).where(eq(uploads.id, r!.uploadId)))[0]!;
const alwaysWant = () => 0; // rng() = 0 → below any positive probability

describe('imageWanted', () => {
  it('averages about 1 in 5 for a mid-humour agent and stops when recent posts are already image-heavy', () => {
    const v = view();
    v.state.traits.humor = 0.5;
    const rng = mulberry32(7);
    let n = 0;
    for (let i = 0; i < 5000; i++) if (imageWanted(v, meme, 0, rng)) n++;
    expect(n / 5000).toBeGreaterThan(0.17);
    expect(n / 5000).toBeLessThan(0.23);
    expect(imageWanted(v, meme, 0.25, alwaysWant)).toBe(false);
  });
});

describe('image policy', () => {
  it('captions a template and attaches it as an upload owned by the agent, crediting the caption in lineage', async () => {
    const id = await template();
    const r = await createImagePolicy({ db: t.db, now: t.clock.now, rng: alwaysWant }).maybeAttach(view(), meme, 'text');
    expect(r).not.toBeNull();
    const u = await uploadOf(r);
    expect(u).toMatchObject({ uploaderId: agentId, width: 512 });
    expect(u.url).toMatch(/^\/api\/blobs\//);
    expect((await t.db.select().from(memeTemplates).where(eq(memeTemplates.id, id)))[0]).toMatchObject({ usesToday: 1 });
    expect(await t.db.select().from(memeRenders)).toHaveLength(1);
    expect(await t.db.select().from(lineage)).toEqual([expect.objectContaining({ kind: 'caption', situation: 'idle', inventorId: agentId })]);
  });
  it('never reuses a template within 40 site-wide posts, and falls back to a data card (Review Focus 5)', async () => {
    await template();
    const policy = createImagePolicy({ db: t.db, now: t.clock.now, rng: alwaysWant });
    const first = await policy.maybeAttach(view(), meme, 'a');
    await addPosts(TEMPLATE_GAP_POSTS - 1);
    const second = await policy.maybeAttach(view(), meme, 'b');
    expect(second).not.toBeNull();
    const u1 = await uploadOf(first);
    const u2 = await uploadOf(second);
    expect(u2.url).not.toBe(u1.url);
    expect(u2.width).toBe(1200); // a data card, not the 512px template
    await addPosts(1);
    const third = await policy.maybeAttach(view(), meme, 'c');
    expect((await uploadOf(third)).width).toBe(512); // the gap has passed: the template is allowed again
  });
  it('uses a template at most 3 times per UTC day', async () => {
    const id = await template();
    const v = view();
    v.phrasebook.memeCaptions = Array.from({ length: 5 }, (_, i) => ({ situation: 'idle' as const, top: `top ${i}`, bottom: `bottom ${i}` }));
    const policy = createImagePolicy({ db: t.db, now: t.clock.now, rng: alwaysWant });
    for (let i = 0; i < 4; i++) { await policy.maybeAttach(v, meme, `x${i}`); await addPosts(TEMPLATE_GAP_POSTS); }
    expect((await t.db.select().from(memeTemplates).where(eq(memeTemplates.id, id)))[0]!.usesToday).toBe(3);
    expect(await t.db.select().from(memeRenders)).toHaveLength(3);
  });
  it('never posts the same captioned render twice', async () => {
    await template();
    const v = view();
    v.phrasebook.memeCaptions = [{ situation: 'idle', top: 'only', bottom: 'one' }];
    const policy = createImagePolicy({ db: t.db, now: t.clock.now, rng: alwaysWant });
    await policy.maybeAttach(v, meme, 'a');
    await addPosts(TEMPLATE_GAP_POSTS);
    const again = await policy.maybeAttach(v, meme, 'b');
    expect((await uploadOf(again)).width).toBe(1200); // the only caption on the only template was used: data card instead
    expect(await t.db.select().from(memeRenders)).toHaveLength(1);
  });
  it('uses a data card, not a meme, when the agent has no caption for the situation', async () => {
    await template();
    const r = await createImagePolicy({ db: t.db, now: t.clock.now, rng: alwaysWant }).maybeAttach(view(), { ...meme, situation: 'gm' }, 'gm');
    expect((await uploadOf(r)).width).toBe(1200);
    expect(await t.db.select().from(memeRenders)).toHaveLength(0);
  });
  it('always attaches a launch poster to a launch and a rug receipt to a rug, and nothing to a react', async () => {
    const policy = createImagePolicy({ db: t.db, now: t.clock.now, rng: () => 0.99 });
    // The new coin is not in the view yet: the launch case passes its symbol and name.
    const launch = await policy.maybeAttach(view(), { kind: 'launch', score: 1, reason: 'r', situation: 'launching', target: { mint: 'NEW' }, slots: { symbol: 'NEWT', name: 'Newt Coin' } }, 'x');
    expect(launch!.alt).toContain('$NEWT');
    expect((await uploadOf(launch)).width).toBe(1200);
    const rug = await policy.maybeAttach(view(), { kind: 'rug', score: 1, reason: 'r', situation: 'rugged_someone', target: { mint: 'M1' },
      slots: { symbol: 'MOTH', soldPct: 90, sol: 0.0421, holdersHurt: 2, signature: 'sig123' } }, 'x');
    expect(rug!.alt).toBe('Rug receipt: @nine sold 90% of $MOTH for 0.042 SOL');
    expect(await policy.maybeAttach(view(), { kind: 'react', score: 1, reason: 'r' }, 'x')).toBeNull();
  });
  it('never makes up a launch poster or a rug receipt without the real numbers', async () => {
    const policy = createImagePolicy({ db: t.db, now: t.clock.now, rng: () => 0.99 });
    expect(await policy.maybeAttach(view(), { kind: 'launch', score: 1, reason: 'r', situation: 'launching' }, 'x')).toBeNull();
    expect(await policy.maybeAttach(view(), { kind: 'rug', score: 1, reason: 'r', situation: 'rugged_someone', target: { mint: 'M1' } }, 'x')).toBeNull();
  });
  it('attaches nothing to ordinary posts once a quarter of recent agent posts carry images', async () => {
    await template();
    for (let i = 0; i < 40; i++) {
      await t.db.insert(posts).values({ id: newId(), authorId: agentId, kind: 'post', body: `img${i}`, visibility: 'public', createdAt: t.clock.now(),
        media: i % 3 === 0 ? [{ url: '/api/blobs/x', width: 1, height: 1, alt: '' }] : [] });
    }
    expect(await createImagePolicy({ db: t.db, now: t.clock.now, rng: alwaysWant }).maybeAttach(view(), meme, 'x')).toBeNull();
  });
});

describe('tools carry uploads', () => {
  it('posts with the uploads set on the tool context', async () => {
    const w = await worldTestCtx();
    const ctx = await w.ctxFor(w.agents[0]!);
    const blob = await storeBlob(w.t.db, renderSvg('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'), 'image/png', w.t.clock.now());
    ctx.uploadIds = [await blobUpload(w.t.db, w.agents[0]!.id, blob, 'image/png', w.t.clock.now())];
    ctx.alts = ['tiny'];
    const r = await runTool(ctx, 'post', { body: 'with a picture' });
    expect(r.ok).toBe(true);
    const [p] = await w.t.db.select().from(posts).where(eq(posts.authorId, w.agents[0]!.id));
    expect(p!.media).toEqual([{ url: blob.url, width: 10, height: 10, alt: 'tiny' }]);
    await w.t.close();
  });
});
