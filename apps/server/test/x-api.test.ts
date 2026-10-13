import { describe, it, expect } from 'vitest';
import { HttpXApi, QUERY_SUFFIX, XApiError } from '../src/x/api.ts';
import { oauth1Header, oauth1Signature } from '../src/x/oauth1.ts';

type Seen = { url: string; method: string; headers: Record<string, string>; body: unknown };
function fakeFetch(answer: (s: Seen) => Response) {
  const seen: Seen[] = [];
  const f = (async (input: string | URL, init?: RequestInit) => {
    const s = { url: String(input), method: init?.method ?? 'GET', headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body };
    seen.push(s);
    return answer(s);
  }) as typeof fetch;
  return { f, seen };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const OAUTH = { apiKey: 'xvz1evFS4wEEPTGEFPHBog', apiSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw', accessToken: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb', accessSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE' };

describe('OAuth 1.0a', () => {
  it('matches the signature from X’s own documentation example', () => {
    expect(oauth1Signature({
      method: 'POST', url: 'https://api.twitter.com/1.1/statuses/update.json', consumerSecret: OAUTH.apiSecret, tokenSecret: OAUTH.accessSecret,
      params: { status: 'Hello Ladies + Gentlemen, a signed OAuth request!', include_entities: 'true', oauth_consumer_key: OAUTH.apiKey, oauth_nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg',
        oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: '1318622958', oauth_token: OAUTH.accessToken, oauth_version: '1.0' },
    })).toBe('hCtSmYh+iHYCEqBWrE7C7hYmtUk=');
  });
  it('builds the header with every oauth field, percent-encoded and sorted', () => {
    const h = oauth1Header({ method: 'POST', url: 'https://api.x.com/2/tweets', params: {}, creds: OAUTH, nonce: 'abc', timestamp: 1700000000 });
    expect(h).toMatch(/^OAuth oauth_consumer_key="xvz1evFS4wEEPTGEFPHBog", oauth_nonce="abc", oauth_signature="[^"]+", oauth_signature_method="HMAC-SHA1", oauth_timestamp="1700000000", oauth_token="[^"]+", oauth_version="1.0"$/);
  });
});

describe('HttpXApi', () => {
  it('reads an account’s new posts with the bearer token and the spec’s fields', async () => {
    const { f, seen } = fakeFetch(() => json({ data: [{ id: '12', text: 'hi', created_at: '2026-10-09T10:00:00.000Z', public_metrics: { like_count: 3, retweet_count: 1, reply_count: 0, quote_count: 0 }, attachments: { media_keys: ['3_1'] } }], meta: { result_count: 1, newest_id: '12' } }));
    const page = await new HttpXApi({ bearer: 'tok', oauth: null, fetch: f }).userPosts('44', { sinceId: '10', max: 20 });
    const u = new URL(seen[0]!.url);
    expect(u.origin + u.pathname).toBe('https://api.x.com/2/users/44/tweets');
    expect(Object.fromEntries(u.searchParams)).toEqual({ max_results: '20', exclude: 'retweets,replies', 'tweet.fields': 'created_at,public_metrics,attachments', since_id: '10' });
    expect(seen[0]!.headers.authorization).toBe('Bearer tok');
    expect(page).toEqual({ resultCount: 1, newestId: '12', posts: [{ id: '12', text: 'hi', createdAt: '2026-10-09T10:00:00.000Z', authorId: null, metrics: { likes: 3, reposts: 1, replies: 0, quotes: 0 }, hasMedia: true }] });
  });
  it('searches with the fixed suffix, ten results, no author expansion and no since_id on a first read', async () => {
    const { f, seen } = fakeFetch(() => json({ meta: { result_count: 0 } }));
    const page = await new HttpXApi({ bearer: 'tok', oauth: null, fetch: f }).search('solana etf', { sinceId: null, max: 10 });
    const q = Object.fromEntries(new URL(seen[0]!.url).searchParams);
    expect(q).toEqual({ query: `solana etf${QUERY_SUFFIX}`, max_results: '10', 'tweet.fields': 'created_at,public_metrics,attachments,author_id' });
    expect(q).not.toHaveProperty('expansions');
    expect(page).toEqual({ posts: [], resultCount: 0, newestId: null });
  });
  it('resolves a handle, and answers null for an account X does not know', async () => {
    const { f } = fakeFetch((s) => (s.url.includes('/lamp') ? json({ data: { id: '99', username: 'Lamp' } }) : json({ errors: [{ title: 'Not Found Error' }] })));
    const api = new HttpXApi({ bearer: 'tok', oauth: null, fetch: f });
    expect(await api.userByHandle('lamp')).toEqual({ id: '99', username: 'Lamp' });
    expect(await api.userByHandle('nobody_here')).toBeNull();
  });
  it('turns a 429 into an XApiError with the reset time, and a 401 into an XApiError', async () => {
    const reset = Math.floor(Date.parse('2026-10-09T12:15:00Z') / 1000);
    const { f } = fakeFetch((s) => (s.url.includes('/tweets') ? json({ title: 'Too Many Requests' }, 429, { 'x-rate-limit-reset': String(reset) }) : json({ title: 'Unauthorized' }, 401)));
    const api = new HttpXApi({ bearer: 'tok', oauth: null, fetch: f });
    const e1 = await api.userPosts('1', { sinceId: null, max: 5 }).catch((e) => e);
    expect(e1).toBeInstanceOf(XApiError);
    expect(e1).toMatchObject({ status: 429, resetAt: new Date(reset * 1000) });
    await expect(api.userByHandle('x')).rejects.toMatchObject({ status: 401 });
  });
  it('posts with OAuth 1.0a: uploads the image, then the post with its media id', async () => {
    const { f, seen } = fakeFetch((s) => (s.url.endsWith('/2/media/upload') ? json({ data: { id: '777' } }) : json({ data: { id: '1800', text: 'x' } }, 201)));
    const api = new HttpXApi({ bearer: null, oauth: OAUTH, fetch: f, nonce: () => 'n', now: () => new Date(1_700_000_000_000) });
    expect(api.readsConfigured).toBe(false);
    expect(api.writesConfigured).toBe(true);
    const media = await api.uploadImage(Buffer.from('png-bytes'), 'image/png');
    expect(media).toBe('777');
    expect(seen[0]!.method).toBe('POST');
    expect(seen[0]!.body).toBeInstanceOf(FormData);
    expect((seen[0]!.body as FormData).get('media_category')).toBe('tweet_image');
    expect(seen[0]!.headers.authorization).toMatch(/^OAuth .*oauth_nonce="n".*oauth_timestamp="1700000000"/);
    expect(await api.createPost('hello', [media])).toBe('1800');
    expect(seen[1]!.url).toBe('https://api.x.com/2/tweets');
    expect(JSON.parse(String(seen[1]!.body))).toEqual({ text: 'hello', media: { media_ids: ['777'] } });
    expect(seen[1]!.headers['content-type']).toBe('application/json');
  });
  it('refuses to call X without the needed keys', async () => {
    const api = new HttpXApi({ bearer: null, oauth: null, fetch: (async () => { throw new Error('no network in tests'); }) as typeof fetch });
    await expect(api.search('a', { sinceId: null, max: 10 })).rejects.toMatchObject({ status: 0 });
    await expect(api.createPost('a', [])).rejects.toMatchObject({ status: 0 });
  });
});
