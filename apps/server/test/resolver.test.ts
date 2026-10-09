import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import bs58 from 'bs58';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createDb, type DbHandle } from '../src/db/client.ts';
import { tokens } from '../src/db/schema.ts';
import { TokenResolver, BACKGROUND_QUEUE_CAP } from '../src/tokens/resolver.ts';
import { RecordingBus } from '../src/realtime/bus.ts';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@shillex/shared';

const MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const PAIR = '5zpyutJu9ee6jFymDGoK7F6S5Kczqtc9FomP3ueKuyA9';
const PAIR2 = 'So11111111111111111111111111111111111111112';
const RPC = 'https://rpc.test';

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
function fakeFetch(h: { rpc?: Handler; dex?: Handler }) {
  const calls = { rpc: 0, dex: 0 };
  const f = (async (input: any, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith(RPC)) { calls.rpc++; return h.rpc!(url, init); }
    if (url.startsWith('https://api.dexscreener.com/')) { calls.dex++; return h.dex!(url, init); }
    throw new Error(`unexpected ${url}`);
  }) as typeof fetch;
  return { f, calls };
}
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
const mintAccount = (owner = TOKEN_PROGRAM_ID, extra: object = {}) => json({ jsonrpc: '2.0', id: 1, result: { value: { owner, data: { parsed: { type: 'mint', info: { decimals: 6, ...extra } }, program: 'spl-token' } } } });
const pair = (o: Partial<{ base: string; liq: number | undefined; pairAddress: string; mcap: number }>) => ({
  chainId: 'solana', dexId: 'raydium', pairAddress: o.pairAddress ?? PAIR,
  baseToken: { address: o.base ?? MINT, name: 'Bonk', symbol: 'BONK' }, quoteToken: { address: PAIR2, name: 'SOL', symbol: 'SOL' },
  liquidity: o.liq === undefined ? undefined : { usd: o.liq }, marketCap: o.mcap ?? 1_000_000, fdv: 1_100_000,
  pairCreatedAt: Date.parse('2026-10-01T00:00:00Z'), info: { imageUrl: 'https://cdn.dexscreener.com/x.png' },
});

let h: DbHandle; let bus: RecordingBus; let clock: Date;
const make = (fetchImpl: typeof fetch, live = true, concurrency?: number) => new TokenResolver({ db: h.db, bus, rpcUrl: RPC, live, fetchImpl, now: () => clock, concurrency });
const randomMint = () => bs58.encode(randomBytes(32));
beforeEach(async () => { h = await createDb({}); bus = new RecordingBus(); clock = new Date('2026-10-09T12:00:00Z'); });
afterAll(async () => { await h?.close(); });

describe('TokenResolver', () => {
  it('wallets and missing accounts are not tokens and never hit dexscreener', async () => {
    const { f, calls } = fakeFetch({ rpc: () => json({ result: { value: { owner: '11111111111111111111111111111111', data: ['', 'base64'] } } }) });
    expect((await make(f).resolve(MINT)).status).toBe('not_a_token');
    expect(calls.dex).toBe(0);
    const g = fakeFetch({ rpc: () => json({ result: { value: null } }) });
    expect((await make(g.f).resolve(PAIR)).status).toBe('not_a_token');
  });
  it('resolves using the highest-liquidity pair where the mint is the base token', async () => {
    const { f } = fakeFetch({ rpc: () => mintAccount(), dex: () => json([pair({ liq: 5_000, pairAddress: PAIR2 }), pair({ liq: 90_000 }), pair({ base: PAIR2, liq: 9e9 })]) });
    const v = await make(f).resolve(MINT);
    expect(v).toMatchObject({ status: 'resolved', source: 'live', symbol: 'BONK', liquidityUsd: 90_000, pairAddress: PAIR, decimals: 6, fetchedAt: clock.toISOString() });
    expect(bus.find('token:resolved')[0]!.target).toBe(`token:${MINT}`);
  });
  it('dedupes concurrent lookups', async () => {
    const { f, calls } = fakeFetch({ rpc: () => mintAccount(), dex: () => json([pair({ liq: 1 })]) });
    const r = make(f);
    await Promise.all([r.resolve(MINT), r.resolve(MINT), r.resolve(MINT)]);
    expect(calls.rpc).toBe(1);
  });

  describe('hostile upstream (Review Focus #2)', () => {
    it('empty pair list → unindexed, with Token-2022 metadata names', async () => {
      const { f } = fakeFetch({ rpc: () => mintAccount(TOKEN_2022_PROGRAM_ID, { extensions: [{ extension: 'tokenMetadata', state: { name: 'Fresh', symbol: 'FRSH' } }] }), dex: () => json([]) });
      expect(await make(f).resolve(MINT)).toMatchObject({ status: 'unindexed', name: 'Fresh', symbol: 'FRSH', liquidityUsd: null, pairAddress: null });
    });
    it('only quote-side pairs → unindexed (never borrow another token’s data)', async () => {
      const { f } = fakeFetch({ rpc: () => mintAccount(), dex: () => json([pair({ base: PAIR2, liq: 1e6 })]) });
      expect((await make(f).resolve(MINT)).status).toBe('unindexed');
    });
    it('missing liquidity → resolved with liquidityUsd null', async () => {
      const { f } = fakeFetch({ rpc: () => mintAccount(), dex: () => json([pair({ liq: undefined })]) });
      expect((await make(f).resolve(MINT)).liquidityUsd).toBeNull();
    });
    it('HTTP 429 → error, retried only after 60s', async () => {
      let status = 429;
      const { f, calls } = fakeFetch({ rpc: () => mintAccount(), dex: () => (status === 429 ? new Response('slow down', { status }) : json([pair({ liq: 10 })])) });
      const r = make(f);
      expect((await r.resolve(MINT)).status).toBe('error');
      status = 200;
      expect((await r.resolve(MINT)).status).toBe('error'); // still within retry window, cached
      expect(calls.dex).toBe(1);
      clock = new Date(clock.getTime() + 61_000);
      expect((await r.resolve(MINT)).status).toBe('resolved');
    });
    it('malformed JSON → error', async () => {
      const { f } = fakeFetch({ rpc: () => mintAccount(), dex: () => new Response('<html>cloudflare</html>', { status: 200 }) });
      expect((await make(f).resolve(MINT)).status).toBe('error');
    });
    it('RPC timeout → error, nothing invented', async () => {
      const { f } = fakeFetch({ rpc: () => { throw Object.assign(new Error('aborted'), { name: 'TimeoutError' }); } });
      const v = await make(f).resolve(MINT);
      expect(v).toMatchObject({ status: 'error', name: null, liquidityUsd: null });
    });
    it('a failed refresh keeps last good data instead of overwriting it', async () => {
      let fail = false;
      const { f } = fakeFetch({ rpc: () => mintAccount(), dex: () => (fail ? new Response('', { status: 500 }) : json([pair({ liq: 77 })])) });
      const r = make(f);
      await r.resolve(MINT);
      fail = true;
      clock = new Date(clock.getTime() + 6 * 60_000);
      const v = await r.resolve(MINT);
      expect(v).toMatchObject({ status: 'resolved', liquidityUsd: 77 });
    });
  });

  it('refreshes stale market data via dexscreener only', async () => {
    const { f, calls } = fakeFetch({ rpc: () => mintAccount(), dex: () => json([pair({ liq: 10 })]) });
    const r = make(f);
    await r.resolve(MINT);
    clock = new Date(clock.getTime() + 6 * 60_000);
    await r.resolve(MINT);
    expect(calls).toEqual({ rpc: 1, dex: 2 });
  });
  it('never fetches demo tokens', async () => {
    await h.db.insert(tokens).values({ mint: MINT, source: 'demo', status: 'resolved', name: 'Demo', symbol: 'DEMO' });
    const { f, calls } = fakeFetch({});
    expect((await make(f).resolve(MINT)).source).toBe('demo');
    expect(calls).toEqual({ rpc: 0, dex: 0 });
  });
  it('live lookup disabled → honest error, nothing persisted', async () => {
    const { f } = fakeFetch({});
    const v = await make(f, false).resolve(MINT);
    expect(v).toMatchObject({ status: 'error', error: 'Live lookup disabled' });
    expect(await h.db.select().from(tokens).where(eq(tokens.mint, MINT))).toHaveLength(0);
  });
  it('getViews returns pending for unknown mints and enqueues them', async () => {
    const { f, calls } = fakeFetch({ rpc: () => mintAccount(), dex: () => json([pair({ liq: 1 })]) });
    const r = make(f);
    const views = await r.getViews([MINT]);
    expect(views[MINT]!.status).toBe('pending');
    await r.idle();
    expect(calls.rpc).toBe(1);
  });

  describe('review fixes', () => {
    it('refresh with no base pairs clears market data and becomes unindexed', async () => {
      let empty = false;
      const { f } = fakeFetch({ rpc: () => mintAccount(), dex: () => json(empty ? [] : [pair({ liq: 500 })]) });
      const r = make(f);
      expect(await r.resolve(MINT)).toMatchObject({ status: 'resolved', liquidityUsd: 500, pairAddress: PAIR });
      empty = true;
      clock = new Date(clock.getTime() + 6 * 60_000);
      expect(await r.resolve(MINT)).toMatchObject({
        status: 'unindexed', symbol: 'BONK', decimals: 6, liquidityUsd: null, marketCapUsd: null, fdvUsd: null,
        pairAddress: null, dexId: null, pairCreatedAt: null, fetchedAt: clock.toISOString(),
      });
    });
    it('live lookup off: getViews reports an honest error for unknown mints, nothing enqueued or persisted', async () => {
      await h.db.insert(tokens).values({ mint: PAIR, source: 'demo', status: 'resolved', name: 'Demo', symbol: 'DEMO' });
      const { f, calls } = fakeFetch({});
      const r = make(f, false);
      const views = await r.getViews([MINT, PAIR]);
      expect(views[MINT]).toMatchObject({ status: 'error', error: 'Live lookup disabled' });
      expect(views[PAIR]).toMatchObject({ status: 'resolved', source: 'demo' });
      await r.idle();
      expect(calls).toEqual({ rpc: 0, dex: 0 });
      expect(await h.db.select().from(tokens).where(eq(tokens.mint, MINT))).toHaveLength(0);
    });
    it('non-upstream errors never leak into the view or the row', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { f } = fakeFetch({ rpc: () => ({ get ok(): boolean { throw new Error('ECONNRESET db internal secret'); } }) as unknown as Response });
      const v = await make(f).resolve(MINT);
      expect(v).toMatchObject({ status: 'error', error: 'lookup failed' });
      const [row] = await h.db.select().from(tokens).where(eq(tokens.mint, MINT));
      expect(row!.error).toBe('lookup failed');
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
    it('never exceeds the concurrency limit', async () => {
      let inflight = 0; let max = 0;
      const slow = async (r: () => Response) => { inflight++; max = Math.max(max, inflight); await new Promise((res) => setTimeout(res, 5)); inflight--; return r(); };
      const { f } = fakeFetch({ rpc: () => slow(() => mintAccount()), dex: () => slow(() => json([pair({ liq: 1 })])) });
      const r = make(f, true, 2);
      await Promise.all(Array.from({ length: 10 }, () => r.resolve(randomMint())));
      expect(max).toBeLessThanOrEqual(2);
      expect(max).toBe(2);
    });
    it('direct resolves jump ahead of queued background lookups', async () => {
      const order: string[] = [];
      const { f } = fakeFetch({
        rpc: (_u, init) => { order.push(JSON.parse(String(init!.body)).params[0]); return mintAccount(); },
        dex: () => json([pair({ liq: 1 })]),
      });
      const r = make(f, true, 1);
      const bg = Array.from({ length: 5 }, () => randomMint());
      r.enqueue(bg);
      const direct = randomMint();
      await r.resolve(direct);
      await r.idle();
      expect(order[0]).toBe(bg[0]);
      expect(order[1]).toBe(direct);
      expect(order).toHaveLength(6);
    });
    it('caps the background queue and drops the overflow', async () => {
      const { f } = fakeFetch({ rpc: () => mintAccount(), dex: () => json([pair({ liq: 1 })]) });
      const r = make(f, true, 1);
      r.enqueue(Array.from({ length: BACKGROUND_QUEUE_CAP + 50 }, () => randomMint()));
      expect(r.pendingBackground()).toBe(BACKGROUND_QUEUE_CAP); // 1 running + 200 waiting; 49 dropped
      r.enqueue([randomMint()]);
      expect(r.pendingBackground()).toBe(BACKGROUND_QUEUE_CAP);
      await r.idle();
    }, 120_000);
  });
});
