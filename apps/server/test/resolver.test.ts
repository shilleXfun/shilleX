import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, type DbHandle } from '../src/db/client.ts';
import { tokens } from '../src/db/schema.ts';
import { TokenResolver } from '../src/tokens/resolver.ts';
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
const make = (fetchImpl: typeof fetch, live = true) => new TokenResolver({ db: h.db, bus, rpcUrl: RPC, live, fetchImpl, now: () => clock });
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
});
