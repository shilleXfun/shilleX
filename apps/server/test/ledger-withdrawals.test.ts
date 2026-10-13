import { describe, it, expect, afterEach } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { eq } from 'drizzle-orm';
import { custodyCtx } from './ledger-helpers.ts';
import { chainTxs, ledgerWithdrawals } from '../src/db/schema.ts';
import { books } from '../src/ledger/books.ts';
import { HOUSE, WITHDRAWALS, lamportsOf } from '../src/ledger/accounts.ts';

const SOL = 1e9;
let c: Awaited<ReturnType<typeof custodyCtx>>;
afterEach(async () => { await c.t.close(); });

/** The owner's agent holds `sol` from a real deposit; the house holds a little stake to pay network fees. */
async function funded(sol = 0.1, env: Record<string, string> = {}) {
  c = await custodyCtx({}, env);
  const d = await c.custody.createDeposit({ agentId: c.agentId, userId: c.owner.id, lamports: sol * SOL });
  c.rpc.pay(c.payer, d.hot, sol * SOL, d.reference);
  await c.custody.pollDeposits();
  c.rpc.pay(c.cold, d.hot, 0.01 * SOL);
  await c.chain.credit(HOUSE, 0.01 * SOL, 'house_stake', 'stake-1');
  return d.hot;
}

describe('withdrawals', () => {
  it('pays the payout wallet at once when the hot vault covers it; the house pays the fee', async () => {
    await funded();
    const w = await c.custody.requestWithdrawal({ agentId: c.agentId, userId: c.owner.id, lamports: 'all' });
    expect(w).toMatchObject({ status: 'queued', lamports: 0.1 * SOL, to: c.payer, position: 1 });
    expect(await c.custody.processWithdrawals()).toMatchObject({ sent: 1, held: 0, failed: 0 });
    expect(c.rpc.sent).toEqual([expect.objectContaining({ to: c.payer, lamports: 0.1 * SOL })]);
    expect((await c.chain.balances(await c.pk(0))).lamports).toBe(0);
    expect(await lamportsOf(c.t.db, WITHDRAWALS)).toBe(0);
    expect(await lamportsOf(c.t.db, HOUSE)).toBe(0.01 * SOL - 5000);
    expect((await c.t.db.select().from(chainTxs).where(eq(chainTxs.kind, 'withdraw')))[0]).toMatchObject({ lamportsDelta: -0.1 * SOL });
    expect((await books(c.t.db)).ok).toBe(true);
    expect(await c.custody.reserves()).toBeGreaterThanOrEqual((await books(c.t.db)).ledgerTotal);
  });

  it('sends only to the payout wallet in force when it was requested', async () => {
    await funded();
    const next = Keypair.generate().publicKey.toBase58();
    c.payouts.set(c.owner.id, next);
    const w = await c.custody.requestWithdrawal({ agentId: c.agentId, userId: c.owner.id, lamports: 0.05 * SOL });
    expect(w.to).toBe(next);
    await expect(c.custody.enqueue({ agentId: null, userId: null, to: next, lamports: 1000, approvedBy: 'admin' })).rejects.toMatchObject({ code: 'COLD_ONLY' });
  });

  it('holds past the daily outflow limit until an admin approves', async () => {
    await funded(0.1, { OUTFLOW_DAILY_MAX_SOL: '0.05' });
    const w = await c.custody.requestWithdrawal({ agentId: c.agentId, userId: c.owner.id, lamports: 0.08 * SOL });
    expect(await c.custody.processWithdrawals()).toMatchObject({ sent: 0, held: 1 });
    expect((await c.custody.withdrawals({ id: w.id }))[0]!.reason).toMatch(/outflow limit/);
    await c.custody.approve(w.id, 'admin-1');
    expect(await c.custody.processWithdrawals()).toMatchObject({ sent: 1 });
  });

  it('holds while the books are frozen and while the hot vault is low', async () => {
    const hot = await funded();
    await c.chain.freeze('mismatch');
    const w = await c.custody.requestWithdrawal({ agentId: c.agentId, userId: c.owner.id, lamports: 0.05 * SOL });
    await c.custody.processWithdrawals();
    expect((await c.custody.withdrawals({ id: w.id }))[0]!.reason).toMatch(/review/);
    await c.chain.unfreeze();
    c.rpc.balances.set(hot, 1000);
    await c.custody.processWithdrawals();
    expect((await c.custody.withdrawals({ id: w.id }))[0]).toMatchObject({ status: 'queued', reason: expect.stringMatching(/hot vault/) });
  });

  it('never re-sends a withdrawal whose send threw (review focus 2)', async () => {
    await funded();
    const w = await c.custody.requestWithdrawal({ agentId: c.agentId, userId: c.owner.id, lamports: 0.05 * SOL });
    c.rpc.failSend = new Error('timeout');
    expect(await c.custody.processWithdrawals()).toMatchObject({ failed: 1 });
    c.rpc.failSend = null;
    expect(await c.custody.processWithdrawals()).toMatchObject({ sent: 0, failed: 0 });
    expect(c.rpc.sent).toEqual([]);
    const [row] = await c.custody.withdrawals({ id: w.id });
    expect(row).toMatchObject({ status: 'sending', reason: expect.stringMatching(/check the chain/) });
    await c.custody.resolveStuck(w.id, 'return');
    expect((await c.chain.balances(await c.pk(0))).lamports).toBe(0.1 * SOL);
    expect((await c.custody.withdrawals({ id: w.id }))[0]!.status).toBe('failed');
    expect((await books(c.t.db)).ok).toBe(true);
  });

  it('finishes a stuck withdrawal that did land, after checking the transaction', async () => {
    const hot = await funded();
    const w = await c.custody.requestWithdrawal({ agentId: c.agentId, userId: c.owner.id, lamports: 0.05 * SOL });
    await c.t.db.update(ledgerWithdrawals).set({ status: 'sending' }).where(eq(ledgerWithdrawals.id, w.id));
    const wrong = c.rpc.pay(hot, c.payer, 0.04 * SOL);
    await expect(c.custody.resolveStuck(w.id, 'sent', wrong)).rejects.toMatchObject({ code: 'NOT_THIS_TRANSFER' });
    const right = c.rpc.pay(hot, c.payer, 0.05 * SOL);
    await c.custody.resolveStuck(w.id, 'sent', right);
    expect((await c.custody.withdrawals({ id: w.id }))[0]).toMatchObject({ status: 'sent', signature: right });
    expect((await books(c.t.db)).ok).toBe(true);
  });

  it('a withdrawal racing a buy never overdraws (review focus 3)', async () => {
    await funded(0.05);
    await c.fund(1, 0.1);
    const { mint } = await c.chain.launch(await c.signer(1), { name: 'X', symbol: 'X', uri: 'u', initialBuyLamports: 0 });
    const results = await Promise.allSettled([
      c.chain.buy(await c.signer(0), mint, 0.04 * SOL, 0),
      c.custody.requestWithdrawal({ agentId: c.agentId, userId: c.owner.id, lamports: 0.04 * SOL }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled').length).toBe(1);
    expect((await c.chain.balances(await c.pk(0))).lamports).toBeGreaterThanOrEqual(0);
    expect((await books(c.t.db)).ok).toBe(true);
  });

  it('cashes out: sells what vesting allows, then withdraws everything free', async () => {
    await funded(0.1);
    await c.fund(1, 0.1);
    const { mint } = await c.chain.launch(await c.signer(1), { name: 'X', symbol: 'X', uri: 'u', initialBuyLamports: 0 });
    await c.chain.buy(await c.signer(0), mint, 0.03 * SOL, 0);
    const r = await c.custody.cashOut({ agentId: c.agentId, userId: c.owner.id });
    expect(r.sold).toEqual([mint]);
    expect((await c.chain.balances(await c.pk(0))).tokens).toEqual([]);
    expect(r.withdrawal).toMatchObject({ to: c.payer, status: 'queued' });
    expect((await c.chain.balances(await c.pk(0))).lamports).toBe(0);
  });
});
