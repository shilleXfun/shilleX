import { describe, it, expect } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testDb } from './helpers.ts';
import { coinLogos, imageSpend, users, worldCoins } from '../src/db/schema.ts';
import { signS3, localStore } from '../src/world/object-store.ts';
import { checkPlan, createLogoMaker, logoKey, shrinkPng } from '../src/agents/coin-launch.ts';
import { renderSvg } from '../src/agents/cards.ts';
import { imageInfo } from '../src/lib/image-size.ts';

describe('the bucket signer', () => {
  it("signs AWS's own example request (GET /test.txt with a Range header) to the published signature", () => {
    const s = { bucket: 'examplebucket', endpoint: 'https://s3.amazonaws.com', region: 'us-east-1', accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' };
    const r = signS3(s, 'GET', 'test.txt', Buffer.alloc(0), new Date('2013-05-24T00:00:00Z'), { range: 'bytes=0-9' });
    expect(r.url).toBe('https://examplebucket.s3.amazonaws.com/test.txt');
    expect(r.headers.authorization).toBe('AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  });
});

describe('the coin the model writes', () => {
  it('keeps a fresh, clean ticker and refuses a taken, famous or crude one', () => {
    const ok = { name: 'Moth Season', ticker: '$moth', lore: 'For everyone @lamp burned.', logo: 'a moth over a flame, orange on black' };
    expect(checkPlan(ok, new Set())).toEqual({ name: 'Moth Season', symbol: 'MOTH', lore: 'For everyone @lamp burned.', logo: 'a moth over a flame, orange on black' });
    expect(checkPlan(ok, new Set(['MOTH']))).toBeNull();
    expect(checkPlan({ ...ok, ticker: 'BONK' }, new Set())).toBeNull();
    expect(checkPlan({ ...ok, ticker: 'TITS' }, new Set())).toBeNull();
    expect(checkPlan({ ...ok, lore: 'see https://x.y' }, new Set())?.lore).toBe('see');
  });
});

describe('logos', () => {
  it('shrinks the original to 512 px', () => {
    const big = renderSvg('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><circle cx="512" cy="512" r="400" fill="#f80"/></svg>');
    expect(imageInfo(shrinkPng(big))).toMatchObject({ mime: 'image/png', width: 512, height: 512 });
  });

  it('draws a coin once, books what it cost, and draws nothing over the day\'s budget', async () => {
    const h = await testDb();
    const db = h.db;
    const now = new Date('2026-10-27T23:00:00Z');
    await db.insert(users).values({ id: 'dev', username: 'dev', displayName: 'dev', kind: 'agent', createdAt: now });
    for (const m of ['m1', 'm2']) await db.insert(worldCoins).values({ mint: m, pool: 'p', creatorId: 'dev', name: 'Moth', symbol: m.toUpperCase(), launchSignature: m, launchedAt: now, description: 'lore' });
    const png = renderSvg('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#08f"/></svg>');
    let drawn = 0;
    const gen = { generate: async () => { drawn++; return { png, usd: 0.02 }; } };
    const store = localStore(await mkdtemp(join(tmpdir(), 'logos-')));
    const maker = createLogoMaker({ db, store, gen, model: 'gpt-image-1', limits: { usd: 0.05, max: 15 }, now: () => now });
    expect(await maker.make('m1', 'a moth')).toBe('made');
    expect(await maker.make('m1')).toBe('exists');
    expect(drawn).toBe(1);
    expect(imageInfo((await store.get(logoKey('m1')))!.bytes)?.width).toBe(512);
    const [spend] = await db.select().from(imageSpend);
    expect(spend).toMatchObject({ usd: 0.02, count: 1 });
    // $0.02 spent of $0.05: another worst-case image (about $0.021) still fits; then the day is full.
    expect(await maker.make('m2')).toBe('made');
    expect((await db.select().from(coinLogos)).length).toBe(2);
    await h.close();
  });
});
