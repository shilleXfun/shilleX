import { describe, it, expect, afterEach } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { eq } from 'drizzle-orm';
import { custodyCtx } from './ledger-helpers.ts';
import { chainTxs, ledgerChainSeen, ledgerDeposits } from '../src/db/schema.ts';
import { books } from '../src/ledger/books.ts';
import { excludeSelf } from '../src/ledger/consent.ts';

const SOL = 1e9;
let c: Awaited<ReturnType<typeof custodyCtx>>;
afterEach(async () => { await c.t.close(); });
const agentBalance = async () => (await c.chain.balances(await c.pk(0))).lamports;

describe('deposits', () => {
  it('credits an exact payment from the payout wallet at finalized, once', async () => {
    c = await custodyCtx();
    const d = await c.custody.createDeposit({ agentId: c.agentId, userId: c.owner.id, lamports: 0.1 * SOL });
    expect(d).toMatchObject({ status: 'pending', lamports: 0.1 * SOL, hot: await c.custody.hot() });
    expect(d.url).toBe(`solana:${d.hot}?amount=0.1&reference=${d.reference}&label=Shillex&message=Fund%20your%20Shillex%20agent`);
    const sig = c.rpc.pay(c.payer, d.hot, 0.1 * SOL, d.reference);
    expect(await c.custody.pollDeposits()).toMatchObject({ credited: 1, refunded: 0 });
    expect(await agentBalance()).toBe(0.1 * SOL);
    expect((await c.t.db.select().from(ledgerDeposits))[0]).toMatchObject({ status: 'credited', signature: sig });
    expect((await c.t.db.select().from(chainTxs).where(eq(chainTxs.kind, 'deposit')))[0]).toMatchObject({ agentId: c.agentId, lamportsDelta: 0.1 * SOL, signature: sig });
    expect((await books(c.t.db)).ok).toBe(true);
    expect(c.notes).toEqual(['got your 0.1 SOL deposit']);
  });

  it('credits a deposit once however many polls overlap (review focus 1)', async () => {
    c = await custodyCtx();
    const d = await c.custody.createDeposit({ agentId: c.agentId, userId: c.owner.id, lamports: 0.1 * SOL });
    c.rpc.pay(c.payer, d.hot, 0.1 * SOL, d.reference);
    const runs = await Promise.all([c.custody.pollDeposits(), c.custody.pollDeposits(), c.custody.pollDeposits()]);
    expect(runs.reduce((n, r) => n + r.credited, 0)).toBe(1);
    await c.custody.pollDeposits();
    expect(await agentBalance()).toBe(0.1 * SOL);
    expect(c.rpc.sent).toEqual([]);
  });

  it('refunds a late, short or foreign payment, minus the network fee (review focus 4)', async () => {
    c = await custodyCtx();
    const late = await c.custody.createDeposit({ agentId: c.agentId, userId: c.owner.id, lamports: 0.05 * SOL });
    c.t.clock.advance(31 * 60_000);
    c.rpc.pay(c.payer, late.hot, 0.05 * SOL, late.reference);
    const short = await c.custody.createDeposit({ agentId: c.agentId, userId: c.owner.id, lamports: 0.02 * SOL });
    c.rpc.pay(c.payer, short.hot, 0.02 * SOL - 1, short.reference);
    const foreign = await c.custody.createDeposit({ agentId: c.agentId, userId: c.owner.id, lamports: 0.02 * SOL });
    const stranger = Keypair.generate().publicKey.toBase58();
    c.rpc.pay(stranger, foreign.hot, 0.02 * SOL, foreign.reference);
    const random = Keypair.generate().publicKey.toBase58();
    c.rpc.pay(random, foreign.hot, 0.03 * SOL);
    expect(await c.custody.pollDeposits()).toMatchObject({ credited: 0, refunded: 4 });
    expect(await agentBalance()).toBe(0);
    expect(c.rpc.sent.map((s) => [s.to, s.lamports]).sort()).toEqual([
      [c.payer, 0.05 * SOL - 5000], [c.payer, 0.02 * SOL - 1 - 5000], [stranger, 0.02 * SOL - 5000], [random, 0.03 * SOL - 5000],
    ].sort());
    const statuses = (await c.t.db.select().from(ledgerDeposits)).map((r) => r.status).sort();
    expect(statuses).toEqual(['refunded', 'refunded', 'refunded']);
  });

  it('never refunds the cold address, and never retries a failed refund', async () => {
    c = await custodyCtx();
    const hot = await c.custody.hot();
    c.rpc.pay(c.cold, hot, 1 * SOL);
    c.rpc.failSend = new Error('rpc down');
    c.rpc.pay(Keypair.generate().publicKey.toBase58(), hot, 0.01 * SOL);
    await c.custody.pollDeposits();
    c.rpc.failSend = null;
    await c.custody.pollDeposits();
    expect(c.rpc.sent).toEqual([]);
    const seen = await c.t.db.select().from(ledgerChainSeen);
    expect(seen.map((s) => s.outcome).sort()).toEqual(['from_cold', 'refund_failed']);
  });

  it('holds every cap, counting pending requests', async () => {
    c = await custodyCtx({}, { MAINNET_AGENT_CAP_SOL: '0.15', MAINNET_WORLD_CAP_SOL: '0.25' });
    await c.custody.createDeposit({ agentId: c.agentId, userId: c.owner.id, lamports: 0.1 * SOL });
    await expect(c.custody.createDeposit({ agentId: c.agentId, userId: c.owner.id, lamports: 0.01 * SOL })).rejects.toMatchObject({ code: 'CAP' }); // daily 0.1
    c.t.clock.advance(86_400_000);
    await expect(c.custody.createDeposit({ agentId: c.agentId, userId: c.owner.id, lamports: 0.06 * SOL })).rejects.toMatchObject({ code: 'CAP', message: /lifetime/ });
    await c.chain.credit((await c.pk(5))!, 0.2 * SOL, 'house_stake', 'stake-x');
    await expect(c.custody.createDeposit({ agentId: c.agentId, userId: c.owner.id, lamports: 0.05 * SOL })).rejects.toMatchObject({ code: 'CAP', message: /world/ });
  });

  it('refuses without the notice, during an exclusion, without a payout wallet, or while frozen', async () => {
    c = await custodyCtx();
    const other = await c.t.createUser('nonotice');
    c.payouts.set(other.id, c.payer);
    await expect(c.custody.createDeposit({ agentId: c.agentId, userId: other.id, lamports: 0.1 * SOL })).rejects.toMatchObject({ code: 'NOTICE_REQUIRED' });
    c.payouts.delete(c.owner.id);
    await expect(c.custody.createDeposit({ agentId: c.agentId, userId: c.owner.id, lamports: 0.1 * SOL })).rejects.toMatchObject({ code: 'NO_PAYOUT_WALLET' });
    c.payouts.set(c.owner.id, c.payer);
    await expect(c.custody.createDeposit({ agentId: c.agentId, userId: c.owner.id, lamports: 0.001 * SOL })).rejects.toMatchObject({ code: 'BAD_AMOUNT' });
    await c.chain.freeze('test');
    await expect(c.custody.createDeposit({ agentId: c.agentId, userId: c.owner.id, lamports: 0.1 * SOL })).rejects.toMatchObject({ code: 'FROZEN' });
    await c.chain.unfreeze();
    await excludeSelf(c.t.db, c.owner.id, 7, c.t.clock.now());
    await expect(c.custody.createDeposit({ agentId: c.agentId, userId: c.owner.id, lamports: 0.1 * SOL })).rejects.toMatchObject({ code: 'EXCLUDED' });
  });

  it('never marks a payment the RPC cannot return yet as handled (C2)', async () => {
    c = await custodyCtx();
    const d = await c.custody.createDeposit({ agentId: c.agentId, userId: c.owner.id, lamports: 0.1 * SOL });
    const sig = c.rpc.pay(c.payer, d.hot, 0.1 * SOL, d.reference);
    c.rpc.notFound.add(sig);
    expect(await c.custody.pollDeposits()).toMatchObject({ credited: 0, refunded: 0 });
    expect(await c.t.db.select().from(ledgerChainSeen)).toEqual([]);
    c.rpc.notFound.delete(sig);
    expect(await c.custody.pollDeposits()).toMatchObject({ credited: 1 });
    expect(await agentBalance()).toBe(0.1 * SOL);
  });

  it('holds SOL that arrived in an unclear transaction for an admin, with its amount and payer (C2)', async () => {
    c = await custodyCtx();
    const stranger = Keypair.generate().publicKey.toBase58();
    const sig = c.rpc.pay(stranger, await c.custody.hot(), 0.02 * SOL, undefined, { unclear: true });
    await c.custody.pollDeposits();
    expect(c.rpc.sent).toEqual([]);
    expect((await c.t.db.select().from(ledgerChainSeen))[0]).toMatchObject({ signature: sig, outcome: 'review', lamports: 0.02 * SOL, fromAddress: stranger, network: 'devnet' });
    expect((await c.custody.payments()).map((p) => p.signature)).toEqual([sig]);
  });

  it('finds a deposit by its reference after the vault’s history scrolled past it (C2)', async () => {
    c = await custodyCtx();
    const d = await c.custody.createDeposit({ agentId: c.agentId, userId: c.owner.id, lamports: 0.1 * SOL });
    c.rpc.pay(c.payer, d.hot, 0.1 * SOL, d.reference);
    for (let i = 0; i < 5; i++) c.rpc.pay(Keypair.generate().publicKey.toBase58(), d.hot, 1000); // dust, newer than the deposit
    c.rpc.window = 3;
    expect(await c.custody.pollDeposits()).toMatchObject({ credited: 1 });
    expect(await agentBalance()).toBe(0.1 * SOL);
  });

  it('credits an on-time payment even when the poll runs after the request expired (I2)', async () => {
    c = await custodyCtx();
    const d = await c.custody.createDeposit({ agentId: c.agentId, userId: c.owner.id, lamports: 0.1 * SOL });
    c.t.clock.advance(5 * 60_000);
    c.rpc.pay(c.payer, d.hot, 0.1 * SOL, d.reference);
    c.t.clock.advance(40 * 60_000);
    expect(await c.custody.pollDeposits()).toMatchObject({ credited: 1, refunded: 0 });
    expect(await agentBalance()).toBe(0.1 * SOL);
  });

  it('keeps polling past a payment it cannot read, and comes back to it (I2)', async () => {
    c = await custodyCtx();
    const a = await c.custody.createDeposit({ agentId: c.agentId, userId: c.owner.id, lamports: 0.05 * SOL });
    const b = await c.custody.createDeposit({ agentId: c.agentId, userId: c.owner.id, lamports: 0.05 * SOL });
    const sigA = c.rpc.pay(c.payer, a.hot, 0.05 * SOL, a.reference);
    c.rpc.pay(c.payer, b.hot, 0.05 * SOL, b.reference);
    c.rpc.failInbound.add(sigA);
    expect(await c.custody.pollDeposits()).toMatchObject({ credited: 1 });
    c.rpc.failInbound.delete(sigA);
    expect(await c.custody.pollDeposits()).toMatchObject({ credited: 1 });
    expect(await agentBalance()).toBe(0.1 * SOL);
  });

  it('lets an admin finish a refund that failed, checking the chain first (I3)', async () => {
    c = await custodyCtx();
    const stranger = Keypair.generate().publicKey.toBase58();
    c.rpc.failSend = new Error('rpc down');
    const sig = c.rpc.pay(stranger, await c.custody.hot(), 0.02 * SOL);
    await c.custody.pollDeposits();
    c.rpc.failSend = null;
    const [row] = await c.t.db.select().from(ledgerChainSeen);
    expect(row).toMatchObject({ outcome: 'refund_failed', refundSignature: expect.any(String) });
    expect((await c.custody.payments()).map((p) => p.signature)).toEqual([sig]);
    await c.custody.resolvePayment(sig, { action: 'refund' }); // its stored signature never landed: send it again
    expect(c.rpc.sent).toEqual([expect.objectContaining({ to: stranger, lamports: 0.02 * SOL - 5000 })]);
    expect((await c.t.db.select().from(ledgerChainSeen))[0]!.outcome).toBe('refunded');
    await expect(c.custody.resolvePayment(sig, { action: 'refund' })).rejects.toMatchObject({ code: 'NOT_OPEN' });
    expect(await c.custody.payments()).toEqual([]);
  });

  it('never refunds twice when the first refund did land (I3)', async () => {
    c = await custodyCtx();
    const stranger = Keypair.generate().publicKey.toBase58();
    const sig = c.rpc.pay(stranger, await c.custody.hot(), 0.02 * SOL);
    await c.custody.pollDeposits();
    const [row] = await c.t.db.select().from(ledgerChainSeen);
    // The refund landed, but the database lost its last write: the row still says refund_failed.
    await c.t.db.update(ledgerChainSeen).set({ outcome: 'refund_failed' }).where(eq(ledgerChainSeen.signature, sig));
    await expect(c.custody.resolvePayment(sig, { action: 'refund' })).rejects.toMatchObject({ code: 'LANDED' });
    await c.custody.resolvePayment(sig, { action: 'refunded' });
    expect((await c.t.db.select().from(ledgerChainSeen))[0]).toMatchObject({ outcome: 'refunded', refundSignature: row!.refundSignature });
    expect(c.rpc.sent.length).toBe(1);
  });

  it('refunds an unclear payment to the address an admin gives (I3)', async () => {
    c = await custodyCtx();
    const payer = Keypair.generate().publicKey.toBase58();
    const sig = c.rpc.pay(payer, await c.custody.hot(), 0.02 * SOL, undefined, { unclear: true });
    await c.custody.pollDeposits();
    await expect(c.custody.resolvePayment(sig, { action: 'refund' })).rejects.toMatchObject({ code: 'BAD_ADDRESS' });
    await c.custody.resolvePayment(sig, { action: 'refund', to: payer });
    expect(c.rpc.sent).toEqual([expect.objectContaining({ to: payer, lamports: 0.02 * SOL - 5000 })]);
  });

  it('refuses to sign a refund on the wrong network', async () => {
    c = await custodyCtx();
    c.rpc.genesis = 'SomethingElse111111111111111111111111111111';
    c.rpc.pay(Keypair.generate().publicKey.toBase58(), await c.custody.hot(), 0.01 * SOL);
    await expect(c.custody.pollDeposits()).rejects.toMatchObject({ code: 'WRONG_NETWORK' });
    expect(c.rpc.sent).toEqual([]);
  });
});
