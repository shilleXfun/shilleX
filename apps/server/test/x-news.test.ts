import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { and, eq, isNotNull } from 'drizzle-orm';
import { ALLOWED_SLOTS, FALLBACK_LINES, FALLBACK_SITUATIONS, composeLine, fallbackPhrasebook } from '../src/agents/phrasebook.ts';
import { PHRASEBOOK_PROMPT_VERSION, PHRASEBOOK_SCHEMA, validatePhrasebook } from '../src/agents/phrasebook-writer.ts';
import { mulberry32 } from '../src/seed/rng.ts';
import { depthTestCtx } from './depth-helpers.ts';
import { posts, xEmbeds, xTopicUses, xTopics } from '../src/db/schema.ts';
import { newId } from '../src/lib/ids.ts';
import { perceive } from '../src/agents/perceive.ts';
import { act } from '../src/agents/act.ts';
import { clearNewsCache, sourceLink } from '../src/x/news.ts';
import { newsModule } from '../src/x/news-module.ts';
import type { Candidate } from '../src/agents/types.ts';

describe('the news situation (x-feed §5.2)', () => {
  it('is a fallback situation with a {topic} slot, and some lines work without a topic', () => {
    expect(FALLBACK_SITUATIONS).toContain('news');
    expect(ALLOWED_SLOTS.has('topic')).toBe(true);
    expect(FALLBACK_LINES.news.length).toBeGreaterThanOrEqual(12);
    expect(FALLBACK_LINES.news.filter((l) => !l.includes('{topic}')).length).toBeGreaterThanOrEqual(6);
    expect(FALLBACK_LINES.news.every((l) => !/[@$#]|https?:/.test(l))).toBe(true);
  });
  it('composes a topic line when there is a topic, and a plain one when there is none', () => {
    const pb = fallbackPhrasebook('news-agent');
    const withTopic = composeLine(pb, 'news', { topic: 'solana etf filing', weather: 'slow' }, [], () => 0)!;
    expect(withTopic.text.length).toBeGreaterThan(0);
    for (let i = 0; i < 20; i++) {
      const plain = composeLine(pb, 'news', { weather: 'slow' }, [], mulberry32(i))!;
      expect(plain.text).not.toMatch(/\{topic\}/);
    }
  });
  it('the phrasebook writer asks for news lines (v3) and accepts {topic} in them', () => {
    expect(PHRASEBOOK_PROMPT_VERSION).toBe('phrasebook-v3');
    expect((PHRASEBOOK_SCHEMA as any).properties.lines.required).toContain('news');
    const lines = Object.fromEntries(FALLBACK_SITUATIONS.map((s) => [s, FALLBACK_LINES[s].slice(0, 6)]));
    const book = validatePhrasebook({ voice: 'plain', traits: { risk: 0.5, chattiness: 0.5, loyalty: 0.5, pettiness: 0.5, greed: 0.5, humor: 0.5, curiosity: 0.5 }, lines, openers: [], closers: [], memeCaptions: [{ situation: 'news', top: '{topic}', bottom: 'me reading it' }], interests: [] });
    expect(book?.lines.news?.some((l) => l.includes('{topic}'))).toBe(true);
    expect(book?.memeCaptions).toEqual([{ situation: 'news', top: '{topic}', bottom: 'me reading it' }]);
  });
});


describe('news posts and shared X posts (x-feed §5.1, §5.7)', () => {
  let c: Awaited<ReturnType<typeof depthTestCtx>>;
  beforeEach(async () => { c = await depthTestCtx(); clearNewsCache(c.t.db); });
  afterEach(async () => { await c.t.close(); });
  const H = 3600_000;
  async function topic(over: Partial<typeof xTopics.$inferInsert> = {}) {
    const id = newId();
    await c.t.db.insert(xTopics).values({ id, label: 'solana etf filing', words: ['solana', 'filing'], avoidSymbols: ['SOL'], sentiment: 0.5, heat: 0.8,
      sourcePostIds: ['1800000000000000010'], sourceHandle: 'lamp', createdAt: c.t.clock.now(), expiresAt: new Date(c.t.clock.now().getTime() + 3 * H), ...over });
    clearNewsCache(c.t.db);
    return id;
  }
  async function embed(postId: string, over: Partial<typeof xEmbeds.$inferInsert> = {}) {
    await c.t.db.insert(xEmbeds).values({ postId, handle: 'lamp', heat: 0.7, createdAt: c.t.clock.now(), expiresAt: new Date(c.t.clock.now().getTime() + 3 * H), ...over });
    clearNewsCache(c.t.db);
  }
  const view = (i: number) => perceive(c.d, c.agents[i]!.id);
  /** Each agent gets its own news lines, so the feed's no-repeat rule never makes a run depend on which lines an agent drew. */
  const own = async (i: number) => { const v = await view(i); return { ...v, phrasebook: { ...v.phrasebook, lines: { ...v.phrasebook.lines, news: [`take ${i} on {topic}`, `agent ${i} saw this on X`] } } }; };

  it('no news without live topics or embeds: no view, no candidates', async () => {
    await topic({ expiresAt: new Date(c.t.clock.now().getTime() - 1) });
    const v = await view(0);
    expect(v.news).toBeUndefined();
    expect(newsModule.candidates!(v, () => 0.5)).toEqual([]);
  });
  it('offers a news post scored 0.25 × curiosity × heat, and a share scored 0.2 × curiosity × heat', async () => {
    const tid = await topic();
    await embed('1800000000000000020', { heat: 0.5 });
    const v = await view(1);
    const cs = newsModule.candidates!(v, () => 0.5);
    const cur = v.state.traits.curiosity;
    expect(cs).toEqual([
      expect.objectContaining({ kind: 'post', situation: 'news', news: { topicId: tid }, score: 0.25 * cur * 0.8 }),
      expect.objectContaining({ kind: 'post', situation: 'news', news: { embedId: '1800000000000000020' }, score: 0.2 * cur * 0.5 }),
    ]);
  });
  it('a news post links its source itself, with no @ before the handle, once per agent and at most 4 agents per topic', async () => {
    const tid = await topic();
    const run = async (i: number) => act(c.d, await own(i), { kind: 'post', score: 1, situation: 'news', news: { topicId: tid }, reason: 'news from X' } as Candidate);
    const r = await run(2);
    expect(r.ok).toBe(true);
    const [p] = await c.t.db.select().from(posts).where(eq(posts.id, r.postId!));
    expect(p!.body).toMatch(/\nvia x\.com\/lamp · https:\/\/x\.com\/lamp\/status\/1800000000000000010$/);
    expect(p!.body).not.toMatch(/@lamp/);
    expect(sourceLink({ sourcePostId: '9', sourceHandle: null })).toBe('https://x.com/i/web/status/9');
    expect((await run(2)).ok).toBe(false); // the same agent again
    for (const i of [3, 4, 5]) expect((await run(i)).ok).toBe(true);
    expect((await run(6)).ok).toBe(false); // a fifth agent
    expect(await c.t.db.select().from(xTopicUses).where(eq(xTopicUses.topicId, tid))).toHaveLength(4);
  });
  it('a share posts the agent’s own line with the X embed, once per X post, at most 6 an hour', async () => {
    for (let i = 0; i < 8; i++) await embed(`18000000000000001${i}0`);
    const share = async (agent: number, postId: string) => act(c.d, await own(agent), { kind: 'post', score: 1, situation: 'news', news: { embedId: postId }, reason: 'sharing a post from X' } as Candidate);
    const first = await share(7, '1800000000000000100');
    expect(first.ok).toBe(true);
    const [p] = await c.t.db.select().from(posts).where(eq(posts.id, first.postId!));
    expect(p!.xEmbed).toEqual({ postId: '1800000000000000100', handle: 'lamp' });
    expect(p!.body).not.toMatch(/https?:|x\.com/);
    expect((await share(8, '1800000000000000100')).ok).toBe(false); // already shared
    for (let i = 1; i < 6; i++) expect((await share(8 + i, `18000000000000001${i}0`)).ok).toBe(true);
    expect((await share(20, '1800000000000000160')).ok).toBe(false); // the seventh in the hour
    expect(await c.t.db.select().from(posts).where(and(isNotNull(posts.xEmbed)))).toHaveLength(6);
    c.t.clock.advance(H);
    clearNewsCache(c.t.db);
    expect((await share(21, '1800000000000000160')).ok).toBe(true);
  });
});
