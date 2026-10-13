import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { hash } from '@node-rs/argon2';
import { Keypair } from '@solana/web3.js';
import { custodyCtx } from './ledger-helpers.ts';
import { createSession, SESSION_COOKIE } from '../src/lib/auth.ts';
import { adminAudit, ledgerChainSeen, users } from '../src/db/schema.ts';
import { registerMainnetAdminRoutes } from '../src/ledger/admin.ts';
import { registerMainnetRoutes } from '../src/ledger/routes.ts';
import { audit, verifyAudit } from '../src/ledger/audit.ts';
import { LEGAL_CONFIRMATION, LEGAL_KEY, legalReviewValid } from '../src/ledger/gate.ts';
import { HOUSE, lamportsOf } from '../src/ledger/accounts.ts';
import { setSetting } from '../src/world/launchpad.ts';
import { newId } from '../src/lib/ids.ts';

const SOL = 1e9;
let c: Awaited<ReturnType<typeof custodyCtx>>;
afterEach(async () => { await c.t.close(); });

async function adminCtx() {
  c = await custodyCtx();
  const id = newId();
  await c.t.db.insert(users).values({ id, username: 'admin', displayName: 'admin', passwordHash: await hash('pw'), createdAt: new Date('2026-01-01') });
  const admin = { id, username: 'admin', cookie: `${SESSION_COOKIE}=${await createSession(c.t.db, id, c.t.clock.now())}` };
  const h = { mode: 'rehearsal' as const, chain: c.chain, custody: c.custody, stop: async () => {} };
  await registerMainnetRoutes(c.t.app, h);
  await registerMainnetAdminRoutes(c.t.app, h);
  return { admin, as: c.t.as(admin) };
}

describe('admin money actions', () => {
  it('are admins only, ask for the password again, and land in the audit trail', async () => {
    const { as } = await adminCtx();
    const stranger = await c.t.createUser('stranger');
    expect((await c.t.as(stranger).post('/api/admin/mainnet/unfreeze', { password: 'pw' })).status).toBe(403);
    expect((await as.post('/api/admin/mainnet/caps', { password: 'nope', caps: { worldCapSol: 10 } })).body.code).toBe('BAD_PASSWORD');
    expect((await as.post('/api/admin/mainnet/caps', { password: 'pw', caps: { worldCapSol: 10 } })).status).toBe(204);
    expect((await as.get('/api/admin/mainnet/status')).body.caps.worldCapSol).toBe(10);
    expect((await as.post('/api/admin/mainnet/caps', { password: 'pw', caps: { worldCapSol: 30 } })).body.code).toBe('CAPS_ONLY_LOWER');
    const audit = await c.t.db.select().from(adminAudit);
    expect(audit.map((a) => a.action)).toEqual(['caps']);
    expect(await verifyAudit(c.t.db)).toBe(true);
  });

  it('records a transfer from the cold address as house stake, once', async () => {
    const { as } = await adminCtx();
    const sig = c.rpc.pay(c.cold, await c.custody.hot(), 2 * SOL);
    await c.custody.pollDeposits();
    expect((await as.get('/api/admin/mainnet/status')).body.fromCold).toEqual([expect.objectContaining({ signature: sig, sol: 2 })]);
    expect((await as.post('/api/admin/mainnet/stake', { password: 'pw', signature: sig })).status).toBe(204);
    expect(await lamportsOf(c.t.db, HOUSE)).toBe(2 * SOL);
    expect((await as.post('/api/admin/mainnet/stake', { password: 'pw', signature: sig })).status).toBe(409);
  });

  it('never lists or stakes a cold transfer another custody network saw (C1)', async () => {
    const { as } = await adminCtx();
    // A rehearsal on devnet saw this one; now custody runs on another network.
    await c.t.db.insert(ledgerChainSeen).values({ signature: 'other-net-cold-1', outcome: 'from_cold', network: 'mainnet', depositId: null, fromAddress: c.cold, lamports: 1 * SOL, refundSignature: null, reason: null, createdAt: c.t.clock.now() });
    expect((await as.get('/api/admin/mainnet/status')).body.fromCold).toEqual([]);
    expect((await as.post('/api/admin/mainnet/stake', { password: 'pw', signature: 'other-net-cold-1' })).status).toBe(409);
    expect(await lamportsOf(c.t.db, HOUSE)).toBe(0);
  });

  it('keeps every cap lowered earlier when another one is lowered (I6)', async () => {
    const { as } = await adminCtx();
    expect((await as.post('/api/admin/mainnet/caps', { password: 'pw', caps: { worldCapSol: 10 } })).status).toBe(204);
    expect((await as.post('/api/admin/mainnet/caps', { password: 'pw', caps: { agentCapSol: 0.4 } })).status).toBe(204);
    expect((await as.get('/api/admin/mainnet/status')).body.caps).toMatchObject({ worldCapSol: 10, agentCapSol: 0.4 });
  });

  it('keeps the audit chain whole when admin actions overlap (I5)', async () => {
    await adminCtx();
    await Promise.all(Array.from({ length: 5 }, (_, i) => audit(c.t.db, 'admin', `act${i}`, { i }, c.t.clock.now())));
    expect((await c.t.db.select().from(adminAudit)).length).toBe(5);
    expect(await verifyAudit(c.t.db)).toBe(true);
  });

  it('refunds a payment held for review through the password-checked form (I3)', async () => {
    const { as } = await adminCtx();
    const payer = Keypair.generate().publicKey.toBase58();
    const sig = c.rpc.pay(payer, await c.custody.hot(), 0.02 * SOL, undefined, { unclear: true });
    await c.custody.pollDeposits();
    expect((await as.get('/api/admin/mainnet/status')).body.refundFailures).toEqual([expect.objectContaining({ signature: sig, outcome: 'review', sol: 0.02 })]);
    expect((await as.post(`/api/admin/mainnet/payments/${sig}/resolve`, { password: 'nope', action: 'refund', to: payer })).body.code).toBe('BAD_PASSWORD');
    expect((await as.post(`/api/admin/mainnet/payments/${sig}/resolve`, { password: 'pw', action: 'refund', to: payer })).status).toBe(204);
    expect(c.rpc.sent).toEqual([expect.objectContaining({ to: payer, lamports: 0.02 * SOL - 5000 })]);
    expect((await c.t.db.select().from(adminAudit)).map((a) => a.action)).toEqual(['resolve_payment']);
  });

  it('sends the house’s SOL only to the cold address, approved', async () => {
    const { as } = await adminCtx();
    const sig = c.rpc.pay(c.cold, await c.custody.hot(), 1 * SOL);
    await c.custody.pollDeposits();
    await as.post('/api/admin/mainnet/stake', { password: 'pw', signature: sig });
    const r = await as.post('/api/admin/mainnet/house-withdraw', { password: 'pw', sol: 0.5 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ to: c.cold, sol: 0.5 });
    await c.custody.processWithdrawals();
    expect(c.rpc.sent).toEqual([expect.objectContaining({ to: c.cold, lamports: 0.5 * SOL })]);
  });

  it('publishes the notice and records the legal review only through the typed form', async () => {
    const { as } = await adminCtx();
    expect((await as.post('/api/admin/mainnet/notice', { password: 'pw', legalPosition: 'Counsel: allowed for adults in X.' })).body).toMatchObject({ version: 'n2' });
    const review = { password: 'pw', reviewer: 'A. Lawyer', date: '2026-11-01', note: 'Reviewed the design.', confirm: 'yes' };
    expect((await as.post('/api/admin/mainnet/legal-review', review)).body.code).toBe('CONFIRMATION_MISMATCH');
    expect(await legalReviewValid(c.t.db)).toBe(false);
    expect((await as.post('/api/admin/mainnet/legal-review', { ...review, confirm: LEGAL_CONFIRMATION })).status).toBe(204);
    expect(await legalReviewValid(c.t.db)).toBe(true);
    expect((await as.get('/api/admin/mainnet/status')).body.legalReview).toMatchObject({ reviewer: 'A. Lawyer', confirmedBy: 'admin' });
  });

  it('ignores a legal review written straight into the settings', async () => {
    await adminCtx();
    await setSetting(c.t.db, LEGAL_KEY, JSON.stringify({ reviewer: 'x', date: '2026-11-01', note: 'n', confirmedBy: 'admin', auditId: 'fake' }));
    expect(await legalReviewValid(c.t.db)).toBe(false);
  });

  it('unfreezes only after a passing check, and resolves stuck sends', async () => {
    const { as } = await adminCtx();
    await c.chain.freeze('test');
    expect((await as.post('/api/admin/mainnet/unfreeze', { password: 'pw' })).status).toBe(204);
    expect(c.chain.frozen).toBeNull();
    c.rpc.balances.set(await c.custody.hot(), 0);
    await c.chain.credit(HOUSE, 1 * SOL, 'house_stake', 'paper-stake'); // books now exceed the reserves
    await c.chain.freeze('test');
    expect((await as.post('/api/admin/mainnet/unfreeze', { password: 'pw' })).body.code).toBe('STILL_FAILING');
    expect(c.chain.frozen).not.toBeNull();
    const [row] = await c.t.db.select().from(users).where(eq(users.username, 'admin'));
    expect(row).toBeTruthy();
  });
});
