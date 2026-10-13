import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { makeTestApp } from './helpers.ts';
import { FakeXApi, XApiError, xConfig, xPost } from './x-helpers.ts';
import { xPosts, xSources } from '../src/db/schema.ts';
import { newId } from '../src/lib/ids.ts';
import { pollOnce, ACCOUNT_EVERY_MS, QUERY_EVERY_MS } from '../src/x/poller.ts';
import { addSource, SourceError } from '../src/x/sources.ts';
import { bookX, xSpendToday } from '../src/x/spend.ts';

let t: Awaited<ReturnType<typeof makeTestApp>>;
let api: FakeXApi;
beforeEach(async () => { t = await makeTestApp(); api = new FakeXApi(); });
afterEach(async () => { await t.close(); });
async function source(kind: 'account' | 'query', value: string, xUserId: string | null = null, createdMs = 0) {
  const id = newId();
  await t.db.insert(xSources).values({ id, kind, value, xUserId, createdAt: new Date(t.clock.now().getTime() - 3600_000 + createdMs) });
  return id;
}
const many = (from: number, n: number) => Array.from({ length: n }, (_, i) => xPost(String(from + i), `post ${from + i}`));
const poll = (over = {}) => pollOnce({ db: t.db, api, config: xConfig(over), now: t.clock.now });

describe('sources (x-feed §2)', () => {
  it('resolves an account once, keeps X’s spelling, and books the user read', async () => {
    api.users.set('lamp', { id: '99', username: 'Lamp' });
    const row = await addSource({ db: t.db, api, config: xConfig(), now: t.clock.now() }, 'account', '@lamp');
    expect(row).toMatchObject({ kind: 'account', value: 'Lamp', xUserId: '99', enabled: true });
    expect(await xSpendToday(t.db, t.clock.now())).toMatchObject({ userReads: 1, usd: 0.01 });
  });
  it('refuses bad handles, unknown accounts, duplicates, a 16th account, a 4th query and reading without a token', async () => {
    const d = { db: t.db, api, config: xConfig(), now: t.clock.now() };
    await expect(addSource(d, 'account', 'not a handle!')).rejects.toMatchObject({ code: 'BAD_HANDLE' });
    await expect(addSource(d, 'account', 'ghost')).rejects.toMatchObject({ code: 'NO_SUCH_ACCOUNT' });
    api.readsConfigured = false;
    await expect(addSource(d, 'account', 'lamp')).rejects.toMatchObject({ code: 'X_NOT_CONFIGURED' });
    api.readsConfigured = true;
    for (const q of ['solana etf', 'memecoin', 'pump fun']) await addSource(d, 'query', q);
    await expect(addSource(d, 'query', 'SOLANA ETF')).rejects.toMatchObject({ code: 'SOURCE_EXISTS' });
    await expect(addSource(d, 'query', 'one more')).rejects.toMatchObject({ code: 'TOO_MANY_SOURCES' });
    for (let i = 0; i < 15; i++) { api.users.set(`a${i}`, { id: String(100 + i), username: `a${i}` }); await addSource(d, 'account', `a${i}`); }
    api.users.set('a15', { id: '115', username: 'a15' });
    await expect(addSource(d, 'account', 'a15')).rejects.toBeInstanceOf(SourceError);
    await expect(addSource(d, 'account', 'a15')).rejects.toMatchObject({ code: 'TOO_MANY_SOURCES' });
  });
});

describe('pollOnce (x-feed §3)', () => {
  it('reads only new posts per account, advances since_id and books result_count reads', async () => {
    const id = await source('account', 'lamp', 'u1');
    api.timelines.set('u1', [xPost('105', 'b', { hasMedia: true }), xPost('104', 'a')]);
    expect(await poll()).toEqual({ read: 2, halted: null });
    const rows = await t.db.select().from(xPosts).orderBy(asc(xPosts.id));
    expect(rows.map((r) => [r.id, r.authorHandle, r.text, r.hasMedia])).toEqual([['104', 'lamp', 'a', false], ['105', 'lamp', 'b', true]]);
    expect((await t.db.select().from(xSources).where(eq(xSources.id, id)))[0]).toMatchObject({ sinceId: '105', lastPolledAt: t.clock.now() });
    expect(await xSpendToday(t.db, t.clock.now())).toMatchObject({ postReads: 2, usd: 0.01 });
    // Inside 15 minutes nothing is read again; after it, only what is new.
    api.timelines.set('u1', [xPost('106', 'c'), xPost('105', 'b'), xPost('104', 'a')]);
    expect((await poll()).read).toBe(0);
    t.clock.advance(ACCOUNT_EVERY_MS);
    expect((await poll()).read).toBe(1);
    expect(api.calls.filter((c) => c.method === 'userPosts').at(-1)!.args[1]).toEqual({ sinceId: '105', max: 20 });
  });
  it('spends the allowance on accounts first: a source with fewer than 5 reads left waits, and a query needs 10', async () => {
    await source('account', 'one', 'u1', 0);
    await source('account', 'two', 'u2', 1);
    await source('query', 'solana etf', null, 2);
    api.timelines.set('u1', many(1000, 20));
    api.timelines.set('u2', many(2000, 20));
    api.searches.set('solana etf', many(3000, 10));
    expect((await poll({ dailyMaxPostReads: 24 })).read).toBe(20);
    expect(api.calls.map((c) => c.method)).toEqual(['userPosts']); // 4 left: below 5 for the second account and 10 for the query
    expect(await xSpendToday(t.db, t.clock.now())).toMatchObject({ postReads: 20 });
  });
  it('polls a query every 2 hours with ten results and no handle on its posts', async () => {
    await source('query', 'solana etf');
    api.searches.set('solana etf', many(5000, 12));
    expect((await poll()).read).toBe(10);
    expect(api.calls[0]).toEqual({ method: 'search', args: ['solana etf', { sinceId: null, max: 10 }] });
    expect((await t.db.select().from(xPosts)).every((p) => p.authorHandle === null)).toBe(true);
    t.clock.advance(QUERY_EVERY_MS - 60_000);
    await poll();
    expect(api.calls).toHaveLength(1);
  });
  it('stops at the X budget hard stop before calling X', async () => {
    await source('account', 'lamp', 'u1');
    api.timelines.set('u1', many(100, 20));
    await bookX(t.db, t.clock.now(), { usd: 1.45 });
    expect((await poll()).read).toBe(0); // 20 reads × $0.005 = $0.10 would pass the $1.50 stop
    expect(api.calls).toEqual([]);
  });
  it('backs off only the source that got a 429, until X’s reset', async () => {
    const a = await source('account', 'one', 'u1', 0);
    const b = await source('account', 'two', 'u2', 1);
    api.timelines.set('u2', many(10, 5));
    const reset = new Date(t.clock.now().getTime() + 600_000);
    api.failNext = new XApiError(429, 'slow down', reset);
    expect((await poll()).read).toBe(5);
    const [ra] = await t.db.select().from(xSources).where(eq(xSources.id, a));
    const [rb] = await t.db.select().from(xSources).where(eq(xSources.id, b));
    expect(ra).toMatchObject({ backoffUntil: reset, lastPolledAt: null });
    expect(rb!.lastPolledAt).toEqual(t.clock.now());
  });
  it('halts the whole feed on a 401 or 403', async () => {
    await source('account', 'one', 'u1');
    api.failNext = new XApiError(401, 'Unauthorized');
    expect((await poll()).halted).toMatch(/401.*X_BEARER_TOKEN/);
  });
  it('Review Focus 2: a source that fails with a 500 is retried next tick, the others are read, and no post is stored twice', async () => {
    const a = await source('account', 'one', 'u1', 0);
    await source('account', 'two', 'u2', 1);
    await source('query', 'dup', null, 2);
    api.timelines.set('u1', many(10, 5));
    api.timelines.set('u2', [xPost('77', 'same post')]);
    api.searches.set('dup', [xPost('77', 'same post'), ...many(500, 9)]);
    api.failNext = new XApiError(500, 'boom');
    const r = await poll();
    expect(r).toEqual({ read: 11, halted: null });
    expect((await t.db.select().from(xSources).where(eq(xSources.id, a)))[0]!.lastPolledAt).toBeNull();
    expect((await t.db.select().from(xPosts).where(eq(xPosts.id, '77')))).toHaveLength(1);
  });
});
