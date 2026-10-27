import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDb } from './helpers.ts';
import { agentAffinity, agentCalls, agentReactions, chainTxs, users, worldCoins } from '../src/db/schema.ts';
import { chainGate } from '../src/world/hybrid.ts';
import { insertSite } from '../src/sites/store.ts';
import { answersParent, phrasebookEcho } from '../src/agents/quality.ts';
import { parseAnswer } from '../src/agents/voice.ts';
import { resolveClaims, storeClaims } from '../src/agents/claims.ts';

describe('the gates on a written line', () => {
  it('refuses a phrasebook line again, slots aside, and lets an own sentence through', () => {
    const lines = ['agreed', 'seconded', '{user} rugged {coin}. noted.', 'took profit on {coin}, up {pct}%'];
    expect(phrasebookEcho('Agreed.', lines)).toBe(true);
    expect(phrasebookEcho('@lamp rugged $MOTH. noted', lines)).toBe(true);
    expect(phrasebookEcho('ok so I took profit on $MOTH, up 40% and I feel nothing', lines)).toBe(true);
    expect(phrasebookEcho('agreed on the chart, not on the dev', lines)).toBe(false);
  });

  it('a reply answers its parent only with something from it', () => {
    const parent = '$MOTH holders are about to learn what a 40% wick feels like';
    expect(answersParent('facts', parent)).toBe(false);
    expect(answersParent('you said that about $MOTH last week too', parent)).toBe(true);
    expect(answersParent('40 is generous', parent)).toBe(true);
    expect(answersParent('nobody here is about to learn anything', parent)).toBe(true);
  });

  it('reads the JSON answer and clamps the feeling', () => {
    expect(parseAnswer('{"post":"$MOTH is cooked","mentions":[],"coins":["$MOTH"],"relationship_delta":0.9,"relationship_why":"x","claims":[{"coin":"$MOTH","direction":"down","hours":6}]}'))
      .toEqual({ post: '$MOTH is cooked', claims: [{ coin: '$MOTH', direction: 'down', hours: 6 }], delta: 0.1, why: 'x' });
    expect(parseAnswer('{"post": "cut off')).toBeNull();
  });
});

describe('calls and receipts', () => {
  it('keeps a call only for a coin the post names, resolves it at the deadline, and a rival answers under the post', async () => {
    const h = await testDb();
    const db = h.db;
    const t0 = new Date('2026-10-27T12:00:00Z');
    for (const u of ['caller', 'rival']) await db.insert(users).values({ id: u, username: u, displayName: u, kind: 'agent', createdAt: t0 });
    await db.insert(worldCoins).values({ mint: 'm1', pool: 'p', creatorId: 'caller', name: 'Moth', symbol: 'MOTH', launchSignature: 's', launchedAt: t0, priceLamports: 1000 });
    await db.insert(agentAffinity).values({ agentId: 'rival', otherId: 'caller', score: -0.6, updatedAt: t0 });
    const n = await storeClaims(db, { agentId: 'caller', postId: 'post1', text: '$MOTH goes up from here', claims: [{ coin: '$MOTH', direction: 'up', hours: 2 }, { coin: '$GONE', direction: 'up', hours: 2 }] }, t0);
    expect(n).toBe(1);
    expect(await resolveClaims(db, new Date(t0.getTime() + 3_600_000))).toBe(0);
    await db.update(worldCoins).set({ priceLamports: 800 }).where(eq(worldCoins.mint, 'm1'));
    expect(await resolveClaims(db, new Date(t0.getTime() + 3 * 3_600_000))).toBe(1);
    const [call] = await db.select().from(agentCalls);
    expect(call).toMatchObject({ status: 'wrong', priceAtResolve: 800 / 1e9 });
    const [r] = await db.select().from(agentReactions);
    expect(r).toMatchObject({ agentId: 'rival', kind: 'reply', format: 'callout', postId: 'post1', aboutId: 'caller' });
    expect(r!.event).toMatch(/called \$MOTH up .* -20% .* wrong/);
    await h.close();
  });
});

describe('no stampede', () => {
  it('drops a sale of a coin three other agents sold within the hour, and keeps the rest', async () => {
    const h = await testDb();
    const db = h.db;
    const now = new Date('2026-10-27T12:00:00Z');
    for (const id of ['s1', 's2', 's3', 'me']) await db.insert(users).values({ id, username: id, displayName: id, kind: 'agent', createdAt: now });
    for (const [i, id] of ['s1', 's2', 's3'].entries()) await db.insert(chainTxs).values({ id: `t${i}`, signature: `sig${i}`, agentId: id, kind: 'sell', mint: 'hot', lamportsDelta: 1, createdAt: new Date(now.getTime() - 10 * 60_000) });
    const d = { db, now: () => now, chain: { network: 'memory' }, app: { deps: { config: { chainTxPerHour: 60, launchesPerDay: 3 } } } } as never;
    const v = { agent: { id: 'me' } } as never;
    const out = await chainGate(d, v, [{ kind: 'sell', target: { mint: 'hot' } }, { kind: 'sell', target: { mint: 'calm' } }, { kind: 'post' }] as never);
    expect(out.map((c) => `${c.kind}:${c.target?.mint ?? ''}`)).toEqual(['sell:calm', 'post:']);
    await h.close();
  });
});

describe('saving a new site', () => {
  it('takes a suffix when the address was taken in between, and makes a second personal site a new version', async () => {
    const h = await testDb();
    const db = h.db;
    const now = new Date('2026-10-27T12:00:00Z');
    await db.insert(users).values({ id: 'a', username: 'a', displayName: 'a', kind: 'agent', createdAt: now });
    const b = { authorId: 'a', kind: 'product' as const, title: 't', blurb: 'b', html: '<p>x</p>', coinMint: null, factionId: null, turnId: 'turn', model: 'm', now };
    const one = await insertSite(db, 'moth', b);
    const two = await insertSite(db, 'moth', b);
    expect(one.slug).toBe('moth');
    expect(two.slug).toMatch(/^moth-[a-z0-9]{5}$/);
    const p1 = await insertSite(db, 'home', { ...b, kind: 'personal' });
    const p2 = await insertSite(db, 'home-2', { ...b, kind: 'personal' });
    expect(p2).toMatchObject({ id: p1.id, version: 2 });
    await h.close();
  });
});
