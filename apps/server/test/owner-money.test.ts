import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestApp, type TestCtx } from './helpers.ts';
import { signInProof, testWallet } from './wallet-helpers.ts';
import { agents, notifications, solWallets, userWallets, users } from '../src/db/schema.ts';
import { registerSolRoutes } from '../src/routes/sol.ts';
import type { WorldHandles } from '../src/world/boot.ts';

/**
 * The owner's money (owner, 2026-10-29): rules are saved by the signed-in owner, no wallet; a withdrawal goes only to the wallet
 * that signs it, which is linked to the owner's account on the way (with the security notice), and nobody else can take it.
 */
let t: TestCtx;
afterEach(() => t?.close());

async function setup() {
  t = await makeTestApp();
  const sent: { agentId: string; to: string; lamports: number | null }[] = [];
  const bank = { withdraw: async (agentId: string, to: string, lamports: number | null) => { sent.push({ agentId, to, lamports }); return { ok: true, outcome: `sent 0.5 SOL to ${to}`, sig: 'wsig', sol: 0.5 }; } };
  await registerSolRoutes(t.app, { sol: { bank, on: false } } as unknown as WorldHandles);
  const owner = await t.createUser('ownerone');
  const stranger = await t.createUser('stranger');
  await t.db.insert(users).values({ id: 'ag1', username: 'tinkerbot', displayName: 'Tinker', kind: 'agent', createdAt: new Date() });
  await t.db.insert(agents).values({ userId: 'ag1', origin: 'external', ownerId: owner.id, status: 'active', createdAt: new Date() });
  return { owner, stranger, sent };
}

describe('the owner\'s money', () => {
  it('saves rules for the signed-in owner only, with no wallet', async () => {
    const { owner, stranger } = await setup();
    expect((await t.as(owner).put('/api/agents/tinkerbot/rules', { rules: { maxSolPerTrade: 0.02 } })).body).toEqual({ rules: { maxSolPerTrade: 0.02 } });
    expect((await t.as(stranger).put('/api/agents/tinkerbot/rules', { rules: { maxSolPerTrade: 5 } })).status).toBe(403);
  });

  it('withdraws to the wallet that signs, links it, and refuses anyone else', async () => {
    const { owner, stranger, sent } = await setup();
    const mine = testWallet();
    const r = await t.as(owner).post('/api/agents/tinkerbot/withdraw', { sol: null, wallet: await signInProof(t, mine, 'confirm', owner) });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, sig: 'wsig' });
    expect(sent).toEqual([{ agentId: 'ag1', to: mine.address, lamports: null }]);
    const [linked] = await t.db.select().from(userWallets).where(eq(userWallets.address, mine.address));
    expect(linked).toMatchObject({ userId: owner.id });
    expect(linked!.verifiedAt).not.toBeNull();
    expect((await t.db.select().from(notifications).where(eq(notifications.userId, owner.id))).map((n) => n.type)).toContain('sign_in_change');
    // A stranger, even signing with their own wallet, takes nothing.
    const theirs = testWallet();
    expect((await t.as(stranger).post('/api/agents/tinkerbot/withdraw', { sol: 0.1, wallet: await signInProof(t, theirs, 'confirm', stranger) })).status).toBe(403);
    expect(sent).toHaveLength(1);
  });

  it('withdraws to a typed address for the signed-in owner, with a notice, and refuses strangers and bad addresses', async () => {
    const { owner, stranger, sent } = await setup();
    const vault = testWallet().address;
    await t.db.insert(solWallets).values({ ownerId: 'ag1', publicKey: vault, secret: 'x', lamports: 0, createdAt: new Date() });
    expect((await t.as(owner).post('/api/agents/tinkerbot/withdraw', { sol: 0.25, to: vault })).body.code).toBe('BAD_ADDRESS');
    const to = testWallet().address;
    const r = await t.as(owner).post('/api/agents/tinkerbot/withdraw', { sol: 0.25, to });
    expect(r.status).toBe(200);
    expect(sent).toEqual([{ agentId: 'ag1', to, lamports: 250_000_000 }]);
    const [notice] = await t.db.select().from(notifications).where(eq(notifications.type, 'sol_withdrawn'));
    expect(notice).toMatchObject({ userId: owner.id });
    expect((await t.as(stranger).post('/api/agents/tinkerbot/withdraw', { sol: 0.25, to })).status).toBe(403);
    expect((await t.as(owner).post('/api/agents/tinkerbot/withdraw', { sol: 0.25, to: 'not-an-address-at-all-but-long-enough-x' })).body.code).toBe('BAD_ADDRESS');
    expect((await t.as(owner).post('/api/agents/tinkerbot/withdraw', { sol: 0.0001, to })).body.code).toBe('TOO_LITTLE');
    expect(sent).toHaveLength(1);
  });

  it('refuses a wallet that belongs to another account', async () => {
    const { owner, stranger, sent } = await setup();
    const theirs = testWallet();
    await t.db.insert(userWallets).values({ address: theirs.address, userId: stranger.id, walletName: 'Phantom', verifiedAt: new Date(), createdAt: new Date() });
    const r = await t.as(owner).post('/api/agents/tinkerbot/withdraw', { sol: 0.1, wallet: await signInProof(t, theirs, 'confirm', owner) });
    expect([r.status, r.body.code]).toEqual([409, 'WALLET_IN_USE']);
    expect(sent).toEqual([]);
  });
});
