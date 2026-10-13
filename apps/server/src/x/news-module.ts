import { and, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm';
import { posts, xEmbeds, xTopicUses } from '../db/schema.ts';
import { WEATHER_WORD, composeLine, feedSeen } from '../agents/phrasebook.ts';
import type { DepthModule } from '../agents/depth/registry.ts';
import type { Candidate } from '../agents/types.ts';
import { EMBEDS_PER_HOUR, TOPIC_AGENTS_MAX, clearNewsCache, newsView, sourceLink } from './news.ts';

const f2 = (n: number) => n.toFixed(2);
const errorOf = (r: unknown) => String((r as { error?: string } | null)?.error ?? 'tool failed');

/**
 * X news in the engine (x-feed §5.1, §5.7): perceive adds the live topics and shareable posts; candidates offer one take on the
 * hottest topic this agent has not posted (0.25 × curiosity × heat) and one share (0.2 × curiosity × heat, 6 an hour); execute
 * writes the agent's own line, claims the topic or the X post, and posts with the source link or the embed.
 */
export const newsModule: DepthModule = {
  name: 'news',
  async perceive(d, v) { v.news = await newsView(d.db, d.now(), v.agent.id); },
  candidates(v) {
    const n = v.news;
    if (!n) return [];
    const cur = v.state.traits.curiosity;
    const out: Candidate[] = [];
    const topic = n.topics.find((t) => !t.mine && t.uses < TOPIC_AGENTS_MAX);
    if (topic) out.push({ kind: 'post', situation: 'news', score: 0.25 * cur * topic.heat, news: { topicId: topic.id }, reason: `news from X (heat ${f2(topic.heat)}, curiosity ${f2(cur)})` });
    const embed = n.embedsLastHour < EMBEDS_PER_HOUR ? n.embeds[0] : undefined;
    if (embed) out.push({ kind: 'post', situation: 'news', score: 0.2 * cur * embed.heat, news: { embedId: embed.postId }, reason: `sharing a post from X (heat ${f2(embed.heat)}, curiosity ${f2(cur)})` });
    return out;
  },
  async execute(d, v, c, tool) {
    if (!c.news) return null;
    const n = v.news;
    if (!n) return { ok: false, quiet: true, error: 'nothing from X is live' };
    const now = d.now();
    // A news post on the feed ends in its source line; compare lines without it, so four agents don't post the same take.
    const seen = feedSeen((v.feed ?? []).map((f) => ({ body: f.body.replace(/\n(?:via x\.com\/\w+ · )?https:\/\/x\.com\/\S+$/, '') })));
    const weather = WEATHER_WORD[v.weather];
    if ('topicId' in c.news) {
      const topicId = c.news.topicId;
      const topic = n.topics.find((t) => t.id === topicId);
      if (!topic) return { ok: false, quiet: true, error: 'the topic is gone' };
      const line = composeLine(v.phrasebook, 'news', { weather, topic: topic.label }, v.state.recentLines, d.rng, seen);
      if (!line) return { ok: false, quiet: true, error: 'nothing fresh to say' };
      const [{ n: uses }] = await d.db.select({ n: sql<number>`count(*)::int` }).from(xTopicUses).where(eq(xTopicUses.topicId, topicId)) as [{ n: number }];
      if (Number(uses) >= TOPIC_AGENTS_MAX) return { ok: false, quiet: true, error: 'enough agents posted about this' };
      const claimed = await d.db.insert(xTopicUses).values({ topicId, agentId: v.agent.id, at: now }).onConflictDoNothing().returning({ id: xTopicUses.topicId });
      if (!claimed.length) return { ok: false, quiet: true, error: 'already posted about this' };
      clearNewsCache(d.db);
      // A topic may get a meme like any post (spec item 8); a failing picture never costs the post.
      const image = d.images ? await Promise.resolve().then(() => d.images!.maybeAttach(v, { ...c, situation: 'news', slots: { topic: topic.label } }, line.text)).catch(() => null) : null;
      const out = await tool('post', { body: `${line.text}\n${sourceLink(topic)}` }, image ? { uploadIds: [image.uploadId], alts: [image.alt] } : undefined);
      if (!out.ok) return { ok: false, error: errorOf(out.result) };
      const postId = (out.result as { post_id: string }).post_id;
      await d.db.update(xTopicUses).set({ postId }).where(and(eq(xTopicUses.topicId, topicId), eq(xTopicUses.agentId, v.agent.id)));
      return { ok: true, postId, text: line.text, line: { key: line.key, template: line.template, situation: 'news' } };
    }
    const embedId = c.news.embedId;
    // Read from the table, not the view: the view lists only the five hottest, and a candidate may name any live one.
    const [embed] = await d.db.select().from(xEmbeds).where(eq(xEmbeds.postId, embedId));
    if (!embed || embed.sharedAt || embed.expiresAt <= now) return { ok: false, quiet: true, error: 'that post from X is gone' };
    const topic = n.topics.find((t) => t.postIds.includes(embedId));
    const line = composeLine(v.phrasebook, 'news', { weather, ...(topic ? { topic: topic.label } : {}) }, v.state.recentLines, d.rng, seen);
    if (!line) return { ok: false, quiet: true, error: 'nothing fresh to say' };
    const [{ n: lastHour }] = await d.db.select({ n: sql<number>`count(*)::int` }).from(posts)
      .where(and(isNotNull(posts.xEmbed), gt(posts.createdAt, new Date(now.getTime() - 3600_000)))) as [{ n: number }];
    if (Number(lastHour) >= EMBEDS_PER_HOUR) return { ok: false, quiet: true, error: 'enough posts from X this hour' };
    const claimed = await d.db.update(xEmbeds).set({ sharedAt: now }).where(and(eq(xEmbeds.postId, embedId), isNull(xEmbeds.sharedAt), gt(xEmbeds.expiresAt, now))).returning({ id: xEmbeds.postId });
    if (!claimed.length) return { ok: false, quiet: true, error: 'someone shared it first' };
    clearNewsCache(d.db);
    const out = await tool('post', { body: line.text }, { xEmbed: { postId: embedId, handle: embed.handle } });
    if (!out.ok) {
      await d.db.update(xEmbeds).set({ sharedAt: null }).where(eq(xEmbeds.postId, embedId));
      return { ok: false, error: errorOf(out.result) };
    }
    return { ok: true, postId: (out.result as { post_id: string }).post_id, text: line.text, line: { key: line.key, template: line.template, situation: 'news' } };
  },
};
