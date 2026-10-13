import { describe, it, expect, afterEach } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { custodyCtx } from './ledger-helpers.ts';
import { ledgerAccounts, ledgerReconciliations } from '../src/db/schema.ts';
import { reconcile, reservesView } from '../src/ledger/reconcile.ts';
import { registerMainnetRoutes } from '../src/ledger/routes.ts';

const SOL = 1e9;
let c: Awaited<ReturnType<typeof custodyCtx>>;
afterEach(async () => { await c.t.close(); });
const run = () => reconcile({ db: c.t.db, chain: c.chain, custody: c.custody, mode: 'rehearsal', now: c.t.clock.now });

async function deposited(sol = 0.1) {
  c = await custodyCtx();
  const d = await c.custody.createDeposit({ agentId: c.agentId, userId: c.owner.id, lamports: sol * SOL });
  c.rpc.pay(c.payer, d.hot, sol * SOL, d.reference);
  await c.custody.pollDeposits();
  return d.hot;
}

describe('reconciliation', () => {
  it('passes when the books balance and the reserves cover them', async () => {
    await deposited();
    const r = await run();
    expect(r).toMatchObject({ ok: true, ledgerTotal: 0.1 * SOL, onchainTotal: 0.1 * SOL });
    expect(c.chain.frozen).toBeNull();
    expect((await reservesView(c.t.db, { mode: 'rehearsal', chain: c.chain, custody: c.custody, stop: async () => {} })).lastPassAt).toBe(r.at.toISOString());
  });
  it('freezes the books when a balance disagrees with the journal', async () => {
    await deposited();
    await c.t.db.update(ledgerAccounts).set({ lamports: sql`${ledgerAccounts.lamports} + 1` }).where(eq(ledgerAccounts.publicKey, await c.pk(0)));
    const r = await run();
    expect(r.ok).toBe(false);
    expect(r.details.mismatches.length).toBeGreaterThan(0);
    expect(c.chain.frozen).toMatch(/did not reconcile/);
  });
  it('freezes the books when the reserves fall short of them', async () => {
    const hot = await deposited();
    c.rpc.balances.set(hot, 0.05 * SOL);
    const r = await run();
    expect(r).toMatchObject({ ok: false, details: { shortBy: 0.05 * SOL } });
    expect(c.chain.frozen).not.toBeNull();
  });
  it('freezes only after three unreadable checks in a row', async () => {
    await deposited();
    c.rpc.failBalance = new Error('rpc down');
    for (let i = 0; i < 2; i++) expect((await run()).ok).toBeNull();
    expect(c.chain.frozen).toBeNull();
    await run();
    expect(c.chain.frozen).toMatch(/unreachable/);
    expect((await c.t.db.select().from(ledgerReconciliations)).length).toBe(3);
  });
  it('publishes the reserves', async () => {
    const hot = await deposited();
    await run();
    await registerMainnetRoutes(c.t.app, { mode: 'rehearsal', chain: c.chain, custody: c.custody, stop: async () => {} });
    const r = await c.t.as(null).get('/api/mainnet/reserves');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ mode: 'rehearsal', network: 'devnet', hot, cold: c.cold, ledgerTotalSol: 0.1, onchainTotalSol: 0.1, frozen: false });
  });
});
