import type { XOAuth } from './config.ts';
import { defaultNonce, oauth1Header } from './oauth1.ts';

const BASE = 'https://api.x.com';
/** Appended to every search (x-feed §2): originals only, in English. */
export const QUERY_SUFFIX = ' -is:retweet -is:reply lang:en';
/** How long one X call may take before it counts as failed (a 408, retried next tick like any other failure). */
export const X_TIMEOUT_MS = 15_000;

export interface XPostItem { id: string; text: string; createdAt: string; authorId: string | null; metrics: { likes: number; reposts: number; replies: number; quotes: number }; hasMedia: boolean }
export interface XPage { posts: XPostItem[]; resultCount: number; newestId: string | null }

/** A failed X call. `status` 0 means it never reached X (no keys); `resetAt` comes from a 429's x-rate-limit-reset. */
export class XApiError extends Error {
  constructor(readonly status: number, message: string, readonly resetAt: Date | null = null) { super(message); this.name = 'XApiError'; }
}

/** Everything Shillex asks of X. Tests use FakeXApi; production uses HttpXApi. */
export interface XApi {
  readonly readsConfigured: boolean;
  readonly writesConfigured: boolean;
  userByHandle(handle: string): Promise<{ id: string; username: string } | null>;
  userPosts(userId: string, o: { sinceId: string | null; max: number }): Promise<XPage>;
  search(query: string, o: { sinceId: string | null; max: number }): Promise<XPage>;
  uploadImage(bytes: Buffer, mime: string): Promise<string>;
  createPost(text: string, mediaIds: string[]): Promise<string>;
}

type Json = Record<string, any>;
function page(data: Json | null): XPage {
  const posts: XPostItem[] = (Array.isArray(data?.data) ? data!.data : []).map((p: Json) => ({
    id: String(p.id), text: String(p.text ?? ''), createdAt: String(p.created_at ?? ''), authorId: p.author_id ? String(p.author_id) : null,
    metrics: { likes: Number(p.public_metrics?.like_count ?? 0), reposts: Number(p.public_metrics?.retweet_count ?? 0), replies: Number(p.public_metrics?.reply_count ?? 0), quotes: Number(p.public_metrics?.quote_count ?? 0) },
    hasMedia: Array.isArray(p.attachments?.media_keys) && p.attachments.media_keys.length > 0,
  }));
  const newest = data?.meta?.newest_id ? String(data.meta.newest_id) : posts[0]?.id ?? null;
  return { posts, resultCount: Number(data?.meta?.result_count ?? posts.length), newestId: newest };
}

/** X API v2 over fetch. Reads use the app's bearer token; writes use the official account's OAuth 1.0a user keys. */
export class HttpXApi implements XApi {
  constructor(private o: { bearer: string | null; oauth: XOAuth | null; fetch?: typeof fetch; nonce?: () => string; now?: () => Date; timeoutMs?: number }) {}
  get readsConfigured() { return Boolean(this.o.bearer); }
  get writesConfigured() { return Boolean(this.o.oauth); }

  private async request(method: 'GET' | 'POST', path: string, query: Record<string, string>, auth: 'bearer' | 'oauth', body?: { json: unknown } | { form: FormData }): Promise<Json | null> {
    const url = new URL(path, BASE);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const headers: Record<string, string> = {};
    if (auth === 'bearer') {
      if (!this.o.bearer) throw new XApiError(0, 'X_BEARER_TOKEN is not set');
      headers.authorization = `Bearer ${this.o.bearer}`;
    } else {
      if (!this.o.oauth) throw new XApiError(0, 'The official account keys (X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET) are not set');
      const timestamp = Math.floor((this.o.now?.() ?? new Date()).getTime() / 1000);
      headers.authorization = oauth1Header({ method, url: `${url.origin}${url.pathname}`, params: query, creds: this.o.oauth, nonce: (this.o.nonce ?? defaultNonce)(), timestamp });
    }
    if (body && 'json' in body) headers['content-type'] = 'application/json';
    // A call X never answers must not hold the single-flight tick (and every other source) for Node's default 5 minutes.
    const signal = AbortSignal.timeout(this.o.timeoutMs ?? X_TIMEOUT_MS);
    let res: Response, text: string;
    try {
      res = await (this.o.fetch ?? fetch)(url, { method, headers, body: body ? ('json' in body ? JSON.stringify(body.json) : body.form) : undefined, signal });
      text = await res.text();
    } catch (e) {
      if (signal.aborted) throw new XApiError(408, `X did not answer within ${Math.round((this.o.timeoutMs ?? X_TIMEOUT_MS) / 1000)} s`);
      throw e;
    }
    let data: Json | null = null;
    try { data = text ? (JSON.parse(text) as Json) : null; } catch { data = null; }
    if (!res.ok) {
      const reset = Number(res.headers.get('x-rate-limit-reset'));
      throw new XApiError(res.status, `X answered ${res.status}: ${String(data?.detail ?? data?.title ?? text).slice(0, 200)}`, Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000) : null);
    }
    return data;
  }

  async userByHandle(handle: string) {
    const d = await this.request('GET', `/2/users/by/username/${encodeURIComponent(handle)}`, {}, 'bearer');
    return d?.data?.id ? { id: String(d.data.id), username: String(d.data.username ?? handle) } : null;
  }
  async userPosts(userId: string, o: { sinceId: string | null; max: number }) {
    const q: Record<string, string> = { max_results: String(o.max), exclude: 'retweets,replies', 'tweet.fields': 'created_at,public_metrics,attachments' };
    if (o.sinceId) q.since_id = o.sinceId;
    return page(await this.request('GET', `/2/users/${encodeURIComponent(userId)}/tweets`, q, 'bearer'));
  }
  async search(query: string, o: { sinceId: string | null; max: number }) {
    // No expansions=author_id: a user object costs twice a post (x-feed §3); results link by id instead.
    // Grouped, so the suffix holds for every term of an OR search.
    const q: Record<string, string> = { query: `(${query})${QUERY_SUFFIX}`, max_results: String(o.max), 'tweet.fields': 'created_at,public_metrics,attachments,author_id' };
    if (o.sinceId) q.since_id = o.sinceId;
    return page(await this.request('GET', '/2/tweets/search/recent', q, 'bearer'));
  }
  async uploadImage(bytes: Buffer, mime: string) {
    const form = new FormData();
    // A copy into a plain Uint8Array: TypeScript does not take a Node Buffer as a BlobPart.
    form.append('media', new Blob([new Uint8Array(bytes)], { type: mime }), 'image');
    form.append('media_category', 'tweet_image');
    const d = await this.request('POST', '/2/media/upload', {}, 'oauth', { form });
    const id = d?.data?.id ?? d?.media_id_string;
    if (!id) throw new XApiError(502, 'X accepted the upload but returned no media id');
    return String(id);
  }
  async createPost(text: string, mediaIds: string[]) {
    const d = await this.request('POST', '/2/tweets', {}, 'oauth', { json: mediaIds.length ? { text, media: { media_ids: mediaIds } } : { text } });
    if (!d?.data?.id) throw new XApiError(502, 'X accepted the post but returned no id');
    return String(d.data.id);
  }
}
