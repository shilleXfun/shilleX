import { XApiError, type XApi, type XPage, type XPostItem } from '../src/x/api.ts';
import { loadXConfig, type XConfig } from '../src/x/config.ts';

/** An X post as the API returns it; ids are numeric strings, compared as numbers like X's. */
export const xPost = (id: string, text: string, over: Partial<XPostItem> = {}): XPostItem => ({
  id, text, createdAt: '2026-10-09T11:00:00.000Z', authorId: null, metrics: { likes: 10, reposts: 2, replies: 1, quotes: 0 }, hasMedia: false, ...over,
});
/** The config the tests use: reading on with a token, everything else at its default. */
export const xConfig = (over: Partial<XConfig> = {}): XConfig => ({ ...loadXConfig({ X_FEED: 'on', X_BEARER_TOKEN: 'test-token' }), ...over });

/** An in-memory X: timelines per user id, results per search, a log of calls, and one scripted failure at a time. */
export class FakeXApi implements XApi {
  readsConfigured = true;
  writesConfigured = true;
  calls: { method: string; args: unknown[] }[] = [];
  users = new Map<string, { id: string; username: string }>();
  timelines = new Map<string, XPostItem[]>();
  searches = new Map<string, XPostItem[]>();
  failNext: XApiError | Error | null = null;
  uploaded: { bytes: number; mime: string }[] = [];
  created: { text: string; mediaIds: string[] }[] = [];

  private fail() { if (this.failNext) { const e = this.failNext; this.failNext = null; throw e; } }
  private take(list: XPostItem[], o: { sinceId: string | null; max: number }): XPage {
    const fresh = [...list].sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1)).filter((p) => !o.sinceId || BigInt(p.id) > BigInt(o.sinceId)).slice(0, o.max);
    return { posts: fresh, resultCount: fresh.length, newestId: fresh[0]?.id ?? null };
  }
  async userByHandle(handle: string) { this.calls.push({ method: 'userByHandle', args: [handle] }); this.fail(); return this.users.get(handle.toLowerCase()) ?? null; }
  async userPosts(userId: string, o: { sinceId: string | null; max: number }) { this.calls.push({ method: 'userPosts', args: [userId, o] }); this.fail(); return this.take(this.timelines.get(userId) ?? [], o); }
  async search(query: string, o: { sinceId: string | null; max: number }) { this.calls.push({ method: 'search', args: [query, o] }); this.fail(); return this.take(this.searches.get(query) ?? [], o); }
  async uploadImage(bytes: Buffer, mime: string) { this.calls.push({ method: 'uploadImage', args: [bytes.length, mime] }); this.fail(); this.uploaded.push({ bytes: bytes.length, mime }); return `m${this.uploaded.length}`; }
  async createPost(text: string, mediaIds: string[]) { this.calls.push({ method: 'createPost', args: [text, mediaIds] }); this.fail(); this.created.push({ text, mediaIds }); return `18000000000000000${this.created.length}`; }
}
export { XApiError };
