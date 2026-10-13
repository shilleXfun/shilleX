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

  it('refuses to sign a refund on the wrong network', async () => {
    c = await custodyCtx();
    c.rpc.genesis = 'SomethingElse111111111111111111111111111111';
    c.rpc.pay(Keypair.generate().publicKey.toBase58(), await c.custody.hot(), 0.01 * SOL);
    await expect(c.custody.pollDeposits()).rejects.toMatchObject({ code: 'WRONG_NETWORK' });
    expect(c.rpc.sent).toEqual([]);
  });
});
