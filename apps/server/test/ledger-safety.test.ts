import { describe, it, expect, afterEach } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { eq } from 'drizzle-orm';
import { ledgerCtx } from './ledger-helpers.ts';
import { ledgerJournal, ledgerPools } from '../src/db/schema.ts';
import { books } from '../src/ledger/books.ts';
import { breakerTripped, vestingLocked } from '../src/ledger/safety.ts';
import { LedgerChain } from '../src/ledger/ledger-chain.ts';
import { TREASURY, createWallet, walletOf } from '../src/world/wallets.ts';

const SOL = 1e9, HOUR = 3_600_000;
let c: Awaited<ReturnType<typeof ledgerCtx>>;
afterEach(async () => { await c?.t.close(); });

describe('pure rules', () => {
  it('unlocks a creator’s launch buy linearly over 24 h', () => {
    const at = new Date('2026-10-13T00:00:00Z');
    expect(vestingLocked(1000, at, at, 24 * HOUR)).toBe(1000);
    expect(vestingLocked(1000, at, new Date(at.getTime() + 6 * HOUR), 24 * HOUR)).toBe(750);
    expect(vestingLocked(1000, at, new Date(at.getTime() + 24 * HOUR), 24 * HOUR)).toBe(0);
    expect(vestingLocked(1000, at, new Date(at.getTime() + 99 * HOUR), 24 * HOUR)).toBe(0);
  });
  it('trips the breaker on a 50% fall from the window’s high', () => {
    expect(breakerTripped([10, 8], 5, 0.5)).toBe(true);
    expect(breakerTripped([10, 8], 5.01, 0.5)).toBe(false);
    expect(breakerTripped([], 1, 0.5)).toBe(false);
  });
});

describe('LedgerChain safety', () => {
  it('locks a creator’s launch buy and caps each creator sale at 30% of the bag', async () => {
    c = await ledgerCtx();
    await c.fund(0, 0.2);
    const s = await c.signer(0);
    const r = await c.chain.launch(s, { name: 'Moth', symbol: 'MOTH', uri: 'u', initialBuyLamports: 0.04 * SOL });
    expect((await c.chain.balances(await c.pk(0))).tokens[0]!.lockedRaw).toBe(r.tokenDelta);
    await expect(c.chain.sell(s, r.mint, 1_000_000, 0)).rejects.toMatchObject({ code: 'VESTING_LOCKED' });
    c.t.clock.advance(12 * HOUR);
    expect((await c.chain.balances(await c.pk(0))).tokens[0]!.lockedRaw).toBe(Math.floor(r.tokenDelta * 0.5));
    await expect(c.chain.sell(s, r.mint, Math.ceil(r.tokenDelta * 0.3) + 1, 0)).rejects.toMatchObject({ code: 'SALE_TOO_LARGE' });
    await c.chain.sell(s, r.mint, Math.floor(r.tokenDelta * 0.3), 0);
    c.t.clock.advance(12 * HOUR);
    expect((await c.chain.balances(await c.pk(0))).tokens[0]!.lockedRaw).toBeUndefined();
    expect((await books(c.t.db)).ok).toBe(true);
  });

  it('does not cap a holder who is not the creator', async () => {
    c = await ledgerCtx();
    await c.fund(0, 0.1); await c.fund(1, 0.1);
    const { mint } = await c.chain.launch(await c.signer(0), { name: 'X', symbol: 'X', uri: 'u', initialBuyLamports: 0 });
    const b = await c.chain.buy(await c.signer(1), mint, 0.04 * SOL, 0);
    await expect(c.chain.sell(await c.signer(1), mint, b.tokenDelta, 0)).resolves.toMatchObject({ tokenDelta: -b.tokenDelta });
  });

  it('caps one trade at 0.05 SOL, launch buys included, and writes nothing when refused', async () => {
    c = await ledgerCtx();
    await c.fund(0, 0.5); await c.fund(1, 0.5);
    const before = (await c.t.db.select().from(ledgerJournal)).length;
    await expect(c.chain.launch(await c.signer(0), { name: 'X', symbol: 'X', uri: 'u', initialBuyLamports: 0.06 * SOL })).rejects.toMatchObject({ code: 'TRADE_TOO_LARGE' });
    expect((await c.t.db.select().from(ledgerJournal)).length).toBe(before);
    const { mint } = await c.chain.launch(await c.signer(0), { name: 'X', symbol: 'X', uri: 'u', initialBuyLamports: 0 });
    await expect(c.chain.buy(await c.signer(1), mint, 0.05 * SOL + 1, 0)).rejects.toMatchObject({ code: 'TRADE_TOO_LARGE' });
    await expect(c.chain.buy(await c.signer(1), mint, 0.05 * SOL, 0)).resolves.toBeTruthy();
  });

  it('pauses a coin that crashes, then reopens it after the pause', async () => {
    c = await ledgerCtx({ breakerDrop: 0.02 }); // a 2% fall trips it, so one sale is enough to test the mechanism
    for (let i = 0; i < 4; i++) await c.fund(i, 0.2);
    const { mint } = await c.chain.launch(await c.signer(0), { name: 'X', symbol: 'X', uri: 'u', initialBuyLamports: 0 });
    for (const i of [1, 2]) await c.chain.buy(await c.signer(i), mint, 0.05 * SOL, 0);
    const held = (await c.chain.balances(await c.pk(1))).tokens[0]!.raw;
    await c.chain.sell(await c.signer(1), mint, held, 0);
    const [p] = await c.t.db.select().from(ledgerPools).where(eq(ledgerPools.mint, mint));
    expect(p!.pausedUntil!.getTime()).toBe(c.t.clock.now().getTime() + 10 * 60_000);
    await expect(c.chain.buy(await c.signer(3), mint, 0.01 * SOL, 0)).rejects.toMatchObject({ code: 'PAUSED' });
    c.t.clock.advance(10 * 60_000 + 1);
    await expect(c.chain.buy(await c.signer(3), mint, 0.01 * SOL, 0)).resolves.toBeTruthy();
  });

  it('sends only between agents, at most 0.01 SOL a transfer and 0.05 SOL a day', async () => {
    c = await ledgerCtx();
    await c.fund(0, 0.2);
    const s = await c.signer(0), to = await c.pk(1);
    await expect(c.chain.sendSol(s, to, 0.01 * SOL + 1)).rejects.toMatchObject({ code: 'SEND_LIMIT' });
    for (let i = 0; i < 5; i++) await c.chain.sendSol(s, to, 0.01 * SOL);
    await expect(c.chain.sendSol(s, to, 1000)).rejects.toMatchObject({ code: 'SEND_LIMIT' });
    c.t.clock.advance(24 * HOUR);
    await expect(c.chain.sendSol(s, to, 1000)).resolves.toBeTruthy();
    const treasury = await createWallet(c.t.db, TREASURY, c.key, c.t.clock.now());
    await expect(c.chain.sendSol(s, treasury, 1000)).rejects.toMatchObject({ code: 'SEND_NOT_ALLOWED' });
    await expect(c.chain.sendSol(s, Keypair.generate().publicKey.toBase58(), 1000)).rejects.toMatchObject({ code: 'SEND_NOT_ALLOWED' });
  });

  it('refuses every money move while the books are frozen, and remembers it across restarts', async () => {
    c = await ledgerCtx();
    await c.fund(0, 0.2);
    await c.chain.freeze('test');
    await expect(c.chain.launch(await c.signer(0), { name: 'X', symbol: 'X', uri: 'u', initialBuyLamports: 0 })).rejects.toMatchObject({ code: 'FROZEN' });
    await expect(c.chain.sendSol(await c.signer(0), await c.pk(1), 1000)).rejects.toMatchObject({ code: 'FROZEN' });
    const again = new LedgerChain(c.t.db, c.t.clock.now);
    await again.loadFrozen();
    expect(again.limits.frozen).toBe(true);
    await again.unfreeze();
    await expect(again.sendSol(await c.signer(0), await c.pk(1), 1000)).resolves.toBeTruthy();
    expect((await walletOf(c.t.db, c.agents[1]!.id))!.publicKey).toBe(await c.pk(1));
  });
});
