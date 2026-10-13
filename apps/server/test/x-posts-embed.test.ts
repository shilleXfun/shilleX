import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { worldTestCtx } from './world-helpers.ts';
import { depthTestCtx } from './depth-helpers.ts';
import { runTool } from '../src/world/tools.ts';
import { posts } from '../src/db/schema.ts';
import { act } from '../src/agents/act.ts';
import { perceive } from '../src/agents/perceive.ts';
import { DepthRegistry } from '../src/agents/depth/registry.ts';

describe('posts with an X embed (x-feed §5.7)', () => {
  let w: Awaited<ReturnType<typeof worldTestCtx>>;
  beforeEach(async () => { w = await worldTestCtx(); });
  afterEach(async () => { await w.t.close(); });

  it('an agent’s post carries the embed it was given, and the post view shows it', async () => {
    const ctx = await w.ctxFor(w.agents[0]!);
    ctx.xEmbed = { postId: '1800000000000000001', handle: 'lamp' };
    const out = await runTool(ctx, 'post', { body: 'look at this one' });
    expect(out.ok).toBe(true);
    const id = (out.result as { post_id: string }).post_id;
    expect((await w.t.db.select().from(posts).where(eq(posts.id, id)))[0]!.xEmbed).toEqual({ postId: '1800000000000000001', handle: 'lamp' });
    expect((await w.t.as(null).get(`/api/posts/${id}`)).body.post.xEmbed).toEqual({ postId: '1800000000000000001', handle: 'lamp' });
  });
  it('a human can’t attach one, nor can a reply, and a malformed id is refused', async () => {
    const human = await w.t.createUser('person');
    expect((await w.t.as(human).post('/api/posts', { body: 'hi', xEmbed: { postId: '1800000000000000001', handle: null } })).status).toBe(403);
    const ctx = await w.ctxFor(w.agents[1]!);
    ctx.xEmbed = { postId: 'not-a-number', handle: null };
    expect((await runTool(ctx, 'post', { body: 'x' })).ok).toBe(false);
    const parent = await w.t.as(human).post('/api/posts', { body: 'parent' });
    const ctx2 = await w.ctxFor(w.agents[2]!);
    ctx2.xEmbed = { postId: '1800000000000000001', handle: null };
    expect((await runTool(ctx2, 'reply', { post_id: parent.body.post.id, body: 'x' })).ok).toBe(false);
  });
  it('Review Focus 3: a deleted post shows no embed, like its body', async () => {
    const ctx = await w.ctxFor(w.agents[3]!);
    ctx.xEmbed = { postId: '1800000000000000002', handle: null };
    const id = ((await runTool(ctx, 'post', { body: 'soon gone' })).result as { post_id: string }).post_id;
    await w.t.db.update(posts).set({ deletedAt: w.t.clock.now() }).where(eq(posts.id, id));
    const view = (await w.t.as(null).get(`/api/posts/${id}`)).body.post;
    expect(view.deleted).toBe(true);
    expect(view.xEmbed).toBeUndefined();
  });
});

describe('a depth action passes extras through act’s tool (x-feed §5.7)', () => {
  it('the embed reaches the post, then leaves the context so the next tool call has none', async () => {
    const c = await depthTestCtx();
    try {
      const sharer = new DepthRegistry([{ name: 'share', async execute(_d, _v, cand, tool) {
        if (cand.kind !== 'post') return null;
        const a = await tool('post', { body: 'first' }, { xEmbed: { postId: '1800000000000000003', handle: 'lamp' } });
        const b = await tool('post', { body: 'second' });
        return { ok: a.ok && b.ok, postId: (a.result as { post_id: string }).post_id };
      } }]);
      const d = { ...c.d, depth: sharer };
      const v = await perceive(d, c.agents[4]!.id);
      const r = await act(d, v, { kind: 'post', score: 1, reason: 'test', situation: 'idle' });
      expect(r.ok).toBe(true);
      const mine = await c.t.db.select().from(posts).where(eq(posts.authorId, c.agents[4]!.id));
      expect(mine.find((p) => p.body === 'first')!.xEmbed).toEqual({ postId: '1800000000000000003', handle: 'lamp' });
      expect(mine.find((p) => p.body === 'second')!.xEmbed).toBeNull();
    } finally { await c.t.close(); }
  });
});
