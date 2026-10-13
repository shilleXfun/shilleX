/** Everything X reads from the environment (x-feed §3, §6, §7). Nothing here is secret-free: never log a whole XConfig. */
export type HighlightsMode = 'off' | 'drafts' | 'auto';
export interface XPrices { postRead: number; userRead: number; postCreate: number; postCreateUrl: number; mediaUpload: number }
export interface XOAuth { apiKey: string; apiSecret: string; accessToken: string; accessSecret: string }
export interface XConfig {
  /** X_FEED=on: the poller reads the sources (it also needs X_BEARER_TOKEN). */
  feed: boolean;
  bearerToken: string | null;
  /** Post reads a UTC day across every source (X_DAILY_MAX_POST_READS). */
  dailyMaxPostReads: number;
  /** The hard stop over every X cost a UTC day: reads, user lookups, posts, media (X_DAILY_BUDGET_USD). */
  dailyBudgetUsd: number;
  /** USD per item (X_PRICE_*); the media upload price is not published, so it starts at 0 until the owner sets it. */
  prices: XPrices;
  /** X_HIGHLIGHTS: off (default, the spec's rollout step 1), drafts (wait for the owner on /admin) or auto. */
  highlights: HighlightsMode;
  highlightsPerDay: number;
  linkedPostsPerDay: number;
  /** The official account's OAuth 1.0a user keys; null unless all four are set. */
  oauth: XOAuth | null;
}

const on = (v: string | undefined) => v !== undefined && ['on', 'true', '1', 'yes'].includes(v.toLowerCase());
const num = (v: string | undefined, def: number) => {
  const n = Number(v);
  return v !== undefined && v.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : def;
};

export function loadXConfig(env: Record<string, string | undefined>): XConfig {
  const mode = env.X_HIGHLIGHTS?.toLowerCase();
  const { X_API_KEY: apiKey, X_API_SECRET: apiSecret, X_ACCESS_TOKEN: accessToken, X_ACCESS_SECRET: accessSecret } = env;
  return {
    feed: on(env.X_FEED),
    bearerToken: env.X_BEARER_TOKEN || null,
    dailyMaxPostReads: Math.floor(num(env.X_DAILY_MAX_POST_READS, 200)),
    dailyBudgetUsd: num(env.X_DAILY_BUDGET_USD, 1.5),
    prices: {
      postRead: num(env.X_PRICE_POST_READ, 0.005), userRead: num(env.X_PRICE_USER_READ, 0.01), postCreate: num(env.X_PRICE_POST_CREATE, 0.015),
      postCreateUrl: num(env.X_PRICE_POST_CREATE_URL, 0.2), mediaUpload: num(env.X_PRICE_MEDIA_UPLOAD, 0),
    },
    highlights: mode === 'drafts' || mode === 'auto' ? mode : 'off',
    highlightsPerDay: Math.floor(num(env.X_HIGHLIGHTS_PER_DAY, 3)),
    linkedPostsPerDay: Math.floor(num(env.X_LINKED_POSTS_PER_DAY, 1)),
    oauth: apiKey && apiSecret && accessToken && accessSecret ? { apiKey, apiSecret, accessToken, accessSecret } : null,
  };
}
