import { describe, it, expect } from 'vitest';
import { loadXConfig } from '../src/x/config.ts';
import { loadConfig } from '../src/config.ts';
import { testDb } from './helpers.ts';
import { posts, worldModelCalls, xEmbeds, xHighlights, xPosts, xSources, xSpend, xTopicUses, xTopics } from '../src/db/schema.ts';

describe('X config (x-feed §3, §6)', () => {
  it('is off and unconfigured by default, with the spec prices and limits', () => {
    expect(loadXConfig({})).toEqual({
      feed: false, bearerToken: null, dailyMaxPostReads: 200, dailyBudgetUsd: 1.5,
      prices: { postRead: 0.005, userRead: 0.01, postCreate: 0.015, postCreateUrl: 0.2, mediaUpload: 0 },
      highlights: 'off', highlightsPerDay: 3, linkedPostsPerDay: 1, oauth: null,
    });
  });
  it('reads every variable, needs all four posting keys, and ignores nonsense', () => {
    const c = loadXConfig({ X_FEED: 'on', X_BEARER_TOKEN: 'tok', X_DAILY_MAX_POST_READS: '50', X_DAILY_BUDGET_USD: '0.5', X_PRICE_MEDIA_UPLOAD: '0.01',
      X_HIGHLIGHTS: 'auto', X_HIGHLIGHTS_PER_DAY: '2', X_LINKED_POSTS_PER_DAY: '0', X_API_KEY: 'k', X_API_SECRET: 's', X_ACCESS_TOKEN: 't', X_ACCESS_SECRET: 'ts' });
    expect(c).toMatchObject({ feed: true, bearerToken: 'tok', dailyMaxPostReads: 50, dailyBudgetUsd: 0.5, highlights: 'auto', highlightsPerDay: 2, linkedPostsPerDay: 0,
      oauth: { apiKey: 'k', apiSecret: 's', accessToken: 't', accessSecret: 'ts' } });
    expect(c.prices.mediaUpload).toBe(0.01);
    expect(loadXConfig({ X_API_KEY: 'k', X_API_SECRET: 's', X_ACCESS_TOKEN: 't' }).oauth).toBeNull();
    expect(loadXConfig({ X_HIGHLIGHTS: 'sometimes' }).highlights).toBe('off');
    expect(loadXConfig({ X_HIGHLIGHTS: 'Drafts' }).highlights).toBe('drafts');
    expect(loadXConfig({ X_DAILY_BUDGET_USD: '-3', X_DAILY_MAX_POST_READS: 'lots' })).toMatchObject({ dailyBudgetUsd: 1.5, dailyMaxPostReads: 200 });
  });
  it('rides on the app config', () => {
    expect(loadConfig({ NODE_ENV: 'test', X_FEED: 'on' }).x.feed).toBe(true);
  });
  it('the migration creates every X table and the posts.x_embed column', async () => {
    const h = await testDb();
    try {
      for (const table of [xSources, xPosts, xTopics, xEmbeds, xTopicUses, xSpend, xHighlights, worldModelCalls]) expect(await h.db.select().from(table)).toEqual([]);
      expect(await h.db.select({ e: posts.xEmbed }).from(posts)).toEqual([]);
    } finally { await h.close(); }
  });
});
