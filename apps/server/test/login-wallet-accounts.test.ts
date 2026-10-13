import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { hash } from '@node-rs/argon2';
import { makeTestApp, type TestCtx } from './helpers.ts';
import { messageProof, signInProof, testWallet, walletAccount, walletPost } from './wallet-helpers.ts';
import { users, userWallets } from '../src/db/schema.ts';
import { payoutWallet } from '../src/services/wallets.ts';
import type { TestUser } from './helpers.ts';
import type { TestWallet } from './wallet-helpers.ts';

const VERIFY = '/api/auth/wallet/verify';
let ctx: TestCtx;
beforeEach(async () => { ctx = await makeTestApp(); });
afterEach(() => ctx.close());
const link = async (user: TestUser, w: TestWallet) => walletPost(ctx, VERIFY, { ...(await messageProof(ctx, w, 'link', user)), purpose: 'link' }, user);

describe('linking wallets', () => {
  it('links a second wallet, verified, and answers with the settings', async () => {
    const me = await walletAccount(ctx, testWallet(), 'two_wallets');
    const w2 = testWallet();
    const r = await link(me, w2);
    expect(r.body.status).toBe('linked');
    expect(r.body.settings.signIn.wallets.map((w: { address: string; verified: boolean }) => [w.address, w.verified])).toContainEqual([w2.address, true]);
  });

  it('a link nonce belongs to the user who asked for it', async () => {
    const a = await walletAccount(ctx, testWallet(), 'asker');
    const b = await walletAccount(ctx, testWallet(), 'thief');
    const p = await signInProof(ctx, testWallet(), 'link', a);
    expect((await walletPost(ctx, VERIFY, { ...p, purpose: 'link' }, b)).body.code).toBe('CHALLENGE_EXPIRED');
  });

  it('a wallet verified elsewhere is WALLET_IN_USE; a typed one elsewhere gives way; my own typed one becomes verified', async () => {
    const shared = testWallet();
    await walletAccount(ctx, shared, 'first_owner');
    const me = await walletAccount(ctx, testWallet(), 'second_owner');
    expect((await link(me, shared)).body.code).toBe('WALLET_IN_USE');

    const typedElsewhere = testWallet();
    const other = await ctx.createUser('typist');
    await ctx.db.insert(userWallets).values({ address: typedElsewhere.address, userId: other.id, verifiedAt: null, createdAt: ctx.clock.now() });
    expect((await link(me, typedElsewhere)).body.status).toBe('linked');

    const mine = testWallet();
    await ctx.db.insert(userWallets).values({ address: mine.address, userId: me.id, verifiedAt: null, showOnProfile: true, createdAt: ctx.clock.now() });
    await link(me, mine);
    const [row] = await ctx.db.select().from(userWallets).where(eq(userWallets.address, mine.address));
    expect(row!.verifiedAt).not.toBeNull();
    expect(row!.showOnProfile).toBe(true);
  });

  it('stops at 5 wallets', async () => {
    const me = await walletAccount(ctx, testWallet(), 'collector');
    for (let i = 0; i < 4; i++) expect((await link(me, testWallet())).body.status).toBe('linked');
    expect((await link(me, testWallet())).body.code).toBe('WALLET_LIMIT');
  });
});

describe('editing and unlinking', () => {
  it('shows a wallet on the profile; payout is off until mainnet; someone else’s wallet is 404', async () => {
    const w = testWallet();
    const me = await walletAccount(ctx, w, 'editor');
    const r = await ctx.as(me).patch(`/api/me/wallets/${w.address}`, { showOnProfile: true });
    expect(r.body.signIn.wallets[0].showOnProfile).toBe(true);
    expect((await ctx.as(me).patch(`/api/me/wallets/${w.address}`, { isPayout: true })).body.code).toBe('PAYOUT_OFF');
    const stranger = await ctx.createUser('stranger');
    expect((await ctx.as(stranger).patch(`/api/me/wallets/${w.address}`, { showOnProfile: false })).status).toBe(404);
    expect((await ctx.as(stranger).del(`/api/me/wallets/${w.address}`)).status).toBe(404);
  });

  it('the last-method guard: a wallet-only account keeps one verified wallet; a typed row doesn’t count (Review Focus 5)', async () => {
    const w1 = testWallet(), w2 = testWallet(), typed = testWallet();
    const me = await walletAccount(ctx, w1, 'careful');
    await ctx.db.insert(userWallets).values({ address: typed.address, userId: me.id, verifiedAt: null, createdAt: ctx.clock.now() });
    expect((await ctx.as(me).del(`/api/me/wallets/${w1.address}`)).body.code).toBe('LAST_SIGN_IN_METHOD');
    await link(me, w2);
    expect((await ctx.as(me).del(`/api/me/wallets/${w1.address}`)).status).toBe(200);
    expect((await ctx.as(me).del(`/api/me/wallets/${w2.address}`)).body.code).toBe('LAST_SIGN_IN_METHOD');
    expect((await ctx.as(me).del(`/api/me/wallets/${typed.address}`)).status).toBe(200);
    await ctx.db.update(users).set({ passwordHash: await hash('long-enough-1') }).where(eq(users.id, me.id));
    expect((await ctx.as(me).del(`/api/me/wallets/${w2.address}`)).status).toBe(200);
  });

  it('payoutWallet reads the verified payout wallet (MAINNET contract)', async () => {
    const w = testWallet();
    const me = await walletAccount(ctx, w, 'payee');
    expect(await payoutWallet(ctx.db, me.id)).toBeNull();
    await ctx.db.update(userWallets).set({ isPayout: true }).where(eq(userWallets.address, w.address));
    expect(await payoutWallet(ctx.db, me.id)).toBe(w.address);
  });
});
