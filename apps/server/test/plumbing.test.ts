import { describe, it, expect } from 'vitest';
import BN from 'bn.js';
import { Connection, Keypair } from '@solana/web3.js';
import { DOWN_PROBE_MS, createModelHalt } from '../src/agents/halt.ts';
import { tripOn } from '../src/agents/moments.ts';
import { createQuietGate } from '../src/agents/quiet.ts';
import { createRpcMeter } from '../src/world/rpc-meter.ts';
import { DexCooling, createDexLimiter } from '../src/world/dex-limiter.ts';
import { DevnetChain } from '../src/world/devnet-chain.ts';

const clock = (start = Date.parse('2026-10-27T12:00:00Z')) => { let t = start; return { now: () => new Date(t), ms: () => t, add: (ms: number) => { t += ms; } }; };

describe('brain health', () => {
  it('a 401 says "brain down" once, probes every half hour without a new alert, and says when it is back', () => {
    const c = clock(), logs: string[] = [];
    const halt = createModelHalt(c.now, (m) => logs.push(m));
    expect(tripOn(halt, Object.assign(new Error('401'), { status: 401 }))).toMatch(/401/);
    expect(halt.state().down).toMatchObject({ probes: 0 });
    expect(halt.reason()).not.toBeNull();
    c.add(DOWN_PROBE_MS);
    expect(halt.reason()).toBeNull(); // one probe may go out
    halt.trip('still 401', 'down');
    expect(halt.state().down).toMatchObject({ probes: 1, reason: 'still 401' });
    expect(logs.filter((l) => l.startsWith('[alert]'))).toHaveLength(1);
    halt.ok();
    expect(halt.state().down).toBeNull();
    expect(logs.at(-1)).toMatch(/brain back up after 30 min/);
  });

  it('a bad request shape is a pause, not down', () => {
    const halt = createModelHalt(clock().now, () => {});
    tripOn(halt, Object.assign(new Error('invalid_request_error'), { status: 400 }));
    expect(halt.reason()).not.toBeNull();
    expect(halt.state().down).toBeNull();
  });
});

describe('the phrasebook allowance', () => {
  it('gives n at once or nothing, and frees up after an hour', () => {
    const c = clock();
    const q = createQuietGate(10, c.now);
    expect(q.take(8)).toBe(true);
    expect(q.take(3)).toBe(false);
    expect(q.take(2)).toBe(true);
    expect(q.take()).toBe(false);
    c.add(3_600_000);
    expect(q.take(10)).toBe(true);
    expect(q.state()).toEqual({ usedLastHour: 10, cap: 10 });
  });
});

describe('the RPC meter', () => {
  it('counts each call of a batch by method, and 429s', async () => {
    let status = 200;
    const m = createRpcMeter(() => new Date(), () => {}, (async () => new Response('{}', { status })) as unknown as typeof fetch);
    await m.fetch('x', { body: JSON.stringify({ method: 'getMultipleAccounts' }) });
    await m.fetch('x', { body: JSON.stringify([{ method: 'getBalance' }, { method: 'getBalance' }]) });
    status = 429;
    await m.fetch('x', { body: JSON.stringify({ method: 'getBalance' }) });
    m.stop();
    expect(m.state().current).toMatchObject({ requests: 4, byMethod: { getMultipleAccounts: 1, getBalance: 3 }, rateLimited: 1 });
  });
});

describe('the DexScreener limiter', () => {
  it('serves the same URL from memory for a minute, and backs off on a 429 without sending', async () => {
    let t = 0, calls = 0, status = 200;
    const logs: string[] = [];
    const l = createDexLimiter((async () => { calls++; return new Response('[1]', { status }); }) as unknown as typeof fetch, { now: () => t, gapMs: 0, log: (m) => logs.push(m) });
    expect(await l.get('a')).toEqual([1]);
    expect(await l.get('a')).toEqual([1]);
    expect(calls).toBe(1);
    status = 429;
    await expect(l.get('b')).rejects.toThrow(/429/);
    await expect(l.get('c')).rejects.toBeInstanceOf(DexCooling);
    expect(calls).toBe(2);
    t += 30_000;
    status = 200;
    expect(await l.get('c')).toEqual([1]);
    expect(logs).toHaveLength(1);
  });
});

describe('batched curves', () => {
  it('reads every pool in one request, reads the config once, and maps a missing pool to null', async () => {
    const reqs: number[] = [];
    const conn = new Connection('http://localhost:1');
    (conn as unknown as { getMultipleAccountsInfo: unknown }).getMultipleAccountsInfo = async (keys: unknown[]) => { reqs.push(keys.length); return keys.map((_, i) => (i === 1 ? null : { data: Buffer.from([i]) })); };
    const config = Keypair.generate().publicKey;
    const chain = new DevnetChain(conn, config);
    const state = (chain as unknown as { client: { state: { program: { coder: { accounts: { decode: unknown } } }; getPoolConfig: unknown } } }).client.state;
    let configReads = 0;
    state.getPoolConfig = async () => { configReads++; return { migrationQuoteThreshold: new BN(1_000_000_000) }; };
    // sqrtPrice 2^64 is a price of 1 base unit per quote unit: 1e-3 SOL per token at 6 and 9 decimals.
    state.program.coder.accounts.decode = () => ({ poolState: { sqrtPrice: new BN(1).shln(64), quoteReserve: new BN(250_000_000), isMigrated: 0, config } });
    const mints = [0, 1, 2].map(() => Keypair.generate().publicKey.toBase58());
    const out = await chain.curves(mints);
    await chain.curves([mints[0]!]);
    expect(reqs).toEqual([3, 1]);
    expect(configReads).toBe(1);
    expect(out.get(mints[1]!)).toBeNull();
    expect(out.get(mints[0]!)).toMatchObject({ curveProgress: 0.25, graduated: false, quoteReserveLamports: 250_000_000 });
    expect(out.get(mints[0]!)!.priceLamports).toBeCloseTo(1e6, 0);
  });
});
