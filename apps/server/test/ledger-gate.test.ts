import { describe, it, expect, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import { custodyCtx, ledgerCtx } from './ledger-helpers.ts';
import { FakeRpc } from './ledger-fakes.ts';
import { loadConfig, type Config } from '../src/config.ts';
import { ledgerReconciliations, ledgerWithdrawals } from '../src/db/schema.ts';
import { gateStatus, recordLegalReview, rehearsalStatus } from '../src/ledger/gate.ts';
import { publishNotice } from '../src/ledger/consent.ts';
import { bootMainnet } from '../src/ledger/boot.ts';
import { startSeason } from '../src/ledger/season.ts';
import { MAINNET_GENESIS } from '../src/world/devnet-chain.ts';
import { MemoryChain } from '../src/world/chain.ts';
import { newId } from '../src/lib/ids.ts';

const DAY = 86_400_000;
const onEnv = (over: Record<string, string> = {}) => ({
  NODE_ENV: 'test', SESSION_SECRET: 's', WORLD_CHAIN: 'ledger', MAINNET: 'on', MAINNET_KEY: randomBytes(32).toString('base64'),
  MAINNET_RPC_URL: 'https://paid-rpc.example', MAINNET_COLD_ADDRESS: Keypair.generate().publicKey.toBase58(), ...over,
});
let close: (() => Promise<void>) | null = null;
afterEach(async () => { await close?.(); close = null; });

/** 14.5 days of clean rehearsal checks every 10 minutes, and one paid withdrawal. */
async function cleanRehearsal(db: Parameters<typeof rehearsalStatus>[0], now: Date, days = 14.5) {
  const rows = [];
  for (let t = now.getTime() - days * DAY; t <= now.getTime(); t += 10 * 60_000) rows.push({ id: newId(), season: 'rehearsal', mode: 'rehearsal' as const, at: new Date(t), ok: true, ledgerTotal: 0, onchainTotal: 0, details: { mismatches: [], shortBy: 0, error: null } });
  for (let i = 0; i < rows.length; i += 500) await db.insert(ledgerReconciliations).values(rows.slice(i, i + 500));
  await db.insert(ledgerWithdrawals).values({ id: newId(), season: 'rehearsal', agentId: null, userId: null, toAddress: 'x', lamports: 1, status: 'sent', reason: null, approvedBy: 'a', signature: 's', requestedAt: now, sentAt: now });
}

/** Every condition that needs no RPC: a notice, the legal review, a clean rehearsal and Season 1's own books. */
async function offlineGateOpen(c: Awaited<ReturnType<typeof ledgerCtx>>) {
  await publishNotice(c.t.db, 'Counsel: allowed for adults.', c.t.clock.now());
  await recordLegalReview(c.t.db, 'admin-id', { reviewer: 'A. Lawyer', date: '2026-11-01', note: 'Reviewed.', confirmedBy: 'admin' }, c.t.clock.now());
  await cleanRehearsal(c.t.db, c.t.clock.now());
  await startSeason(c.t.db, 'season1', new Map(), c.t.clock.now());
}

/** A FakeRpc that counts every call, to prove a closed gate never reaches the mainnet RPC. */
class CountingRpc extends FakeRpc {
  calls = 0;
  override async genesisHash() { this.calls++; return super.genesisHash(); }
  override async balance(a: string) { this.calls++; return super.balance(a); }
  override async signaturesFor(a: string) { this.calls++; return super.signaturesFor(a); }
}

describe('rehearsal status', () => {
  it('needs 14 clean days, 90% coverage and a paid withdrawal', async () => {
    const c = await ledgerCtx(); close = () => c.t.close();
    const now = c.t.clock.now();
    expect((await rehearsalStatus(c.t.db, now)).why).toMatch(/no rehearsal/);
    await cleanRehearsal(c.t.db, now, 13);
    expect((await rehearsalStatus(c.t.db, now)).why).toMatch(/13\.\d of 14 days/);
    c.t.clock.advance(1.5 * DAY);
    expect((await rehearsalStatus(c.t.db, c.t.clock.now())).why).toMatch(/checks passed/); // the last 1.5 days have no checks
  });
  it('starts the 14 days again after a failure', async () => {
    const c = await ledgerCtx(); close = () => c.t.close();
    const now = c.t.clock.now();
    await cleanRehearsal(c.t.db, now);
    expect(await rehearsalStatus(c.t.db, now)).toEqual({ ok: true, why: '' });
    await c.t.db.insert(ledgerReconciliations).values({ id: newId(), season: 'rehearsal', mode: 'rehearsal', at: new Date(now.getTime() - DAY), ok: false, ledgerTotal: 0, onchainTotal: 0, details: { mismatches: ['x'], shortBy: 0, error: null } });
    expect((await rehearsalStatus(c.t.db, now)).ok).toBe(false);
  });
});

describe('the launch gate', () => {
  it('names every missing condition, then opens when all hold', async () => {
    const c = await custodyCtx(); close = () => c.t.close();
    c.rpc.genesis = MAINNET_GENESIS;
    const bare = loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 's', WORLD_CHAIN: 'ledger', MAINNET: 'on', MAINNET_RPC_URL: 'https://api.mainnet-beta.solana.com' });
    const missing = await gateStatus({ db: c.t.db, config: bare, rpc: c.rpc, custody: c.custody, now: c.t.clock.now });
    expect(missing.join('\n')).toMatch(/MAINNET_COLD_ADDRESS/);
    expect(missing.join('\n')).toMatch(/MAINNET_KEY/);
    expect(missing.join('\n')).toMatch(/paid RPC/);
    expect(missing.join('\n')).toMatch(/legal review/);
    expect(missing.join('\n')).toMatch(/rehearsal/);
    const config: Config = loadConfig(onEnv());
    await recordLegalReview(c.t.db, 'admin-id', { reviewer: 'A. Lawyer', date: '2026-11-01', note: 'Reviewed.', confirmedBy: 'admin' }, c.t.clock.now());
    await cleanRehearsal(c.t.db, c.t.clock.now());
    // Everything else holds, but the books are still a practice season's (devnet or paper SOL): closed (C1).
    expect(await gateStatus({ db: c.t.db, config, rpc: c.rpc, custody: c.custody, now: c.t.clock.now })).toEqual([expect.stringMatching(/practice season/)]);
    await startSeason(c.t.db, 'season1', new Map(), c.t.clock.now());
    expect(await gateStatus({ db: c.t.db, config, rpc: c.rpc, custody: c.custody, now: c.t.clock.now })).toEqual([]);
    c.rpc.genesis = 'Devnet';
    expect((await gateStatus({ db: c.t.db, config, rpc: c.rpc, custody: c.custody, now: c.t.clock.now }))[0]).toMatch(/mainnet-beta/);
  });
});

describe('booting mainnet', () => {
  it('refuses to boot against the wrong network (review focus 5)', async () => {
    const c = await ledgerCtx(); close = () => c.t.close();
    const mainnet = new FakeRpc(); mainnet.genesis = MAINNET_GENESIS;
    c.t.app.deps.config = loadConfig(onEnv({ MAINNET: 'rehearsal' }));
    await expect(bootMainnet(c.t.app, { chain: c.chain, worldKey: c.key, rpc: mainnet, intervals: false })).rejects.toThrow(/devnet only/);
    await offlineGateOpen(c);
    const devnet = new FakeRpc();
    c.t.app.deps.config = loadConfig(onEnv());
    await expect(bootMainnet(c.t.app, { chain: c.chain, worldKey: c.key, rpc: devnet, intervals: false })).rejects.toThrow(/mainnet-beta/);
  });
  it('refuses MAINNET=on while the gate is closed, naming what is missing, without touching the RPC', async () => {
    const c = await ledgerCtx(); close = () => c.t.close();
    const rpc = new CountingRpc(); rpc.genesis = MAINNET_GENESIS;
    c.t.app.deps.config = loadConfig(onEnv());
    await expect(bootMainnet(c.t.app, { chain: c.chain, worldKey: c.key, rpc, intervals: false })).rejects.toThrow(/MAINNET=on refused.*legal review/s);
    expect(rpc.calls).toBe(0);
  });
  it('refuses a rehearsal on books that hold real SOL (C1)', async () => {
    const c = await ledgerCtx(); close = () => c.t.close();
    await startSeason(c.t.db, 'season1', new Map(), c.t.clock.now());
    c.t.app.deps.config = loadConfig(onEnv({ MAINNET: 'rehearsal' }));
    const rpc = new CountingRpc();
    await expect(bootMainnet(c.t.app, { chain: c.chain, worldKey: c.key, rpc, intervals: false })).rejects.toThrow(/real SOL/);
    expect(rpc.calls).toBe(0);
  });
  it('refuses a MAINNET_KEY equal to WORLD_KEY', async () => {
    const c = await ledgerCtx(); close = () => c.t.close();
    const same = randomBytes(32).toString('base64');
    c.t.app.deps.config = loadConfig(onEnv({ MAINNET: 'rehearsal', MAINNET_KEY: same, WORLD_KEY: same }));
    await expect(bootMainnet(c.t.app, { chain: c.chain, worldKey: c.key, rpc: new FakeRpc(), intervals: false })).rejects.toThrow(/differ from WORLD_KEY/);
  });
  it('boots a rehearsal: custody on devnet, routes up', async () => {
    const c = await ledgerCtx(); close = () => c.t.close();
    c.t.app.deps.config = loadConfig(onEnv({ MAINNET: 'rehearsal' }));
    await publishNotice(c.t.db, 'Rehearsal: devnet SOL only.', c.t.clock.now());
    const h = await bootMainnet(c.t.app, { chain: c.chain, worldKey: c.key, rpc: new FakeRpc(), intervals: false });
    expect(h).toMatchObject({ mode: 'rehearsal' });
    expect(h!.custody!.network).toBe('devnet');
    expect((await c.t.as(null).get('/api/mainnet/reserves')).body).toMatchObject({ mode: 'rehearsal', network: 'devnet' });
    await h!.stop();
  });
  it('does nothing outside a ledger world', async () => {
    const c = await ledgerCtx(); close = () => c.t.close();
    expect(await bootMainnet(c.t.app, { chain: new MemoryChain(), worldKey: c.key, intervals: false })).toBeNull();
  });
});
