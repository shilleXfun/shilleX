import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestApp, type TestCtx } from './helpers.ts';
import { signInProof, testWallet, walletAccount, walletPost, type TestWallet } from './wallet-helpers.ts';
import { userWallets, users } from '../src/db/schema.ts';

const SIGNUP = '/api/auth/wallet/signup';
let ctx: TestCtx;
beforeEach(async () => { ctx = await makeTestApp(); });
afterEach(() => ctx.close());

async function tokenFor(w: TestWallet): Promise<string> {
  const v = await walletPost(ctx, '/api/auth/wallet/verify', { ...(await signInProof(ctx, w, 'login')), purpose: 'login' });
  return v.body.signupToken as string;
}

describe('wallet signup', () => {
  it('creates a wallet-only account with a verified wallet and signs it in', async () => {
    const w = testWallet();
    const r = await walletPost(ctx, SIGNUP, { signupToken: await tokenFor(w), username: 'wallet_ape' });
    expect(r.status).toBe(201);
    expect(r.body.user).toMatchObject({ username: 'wallet_ape', displayName: 'wallet_ape' });
    expect(r.cookie).toMatch(/^sx_session=/);
    const [u] = await ctx.db.select().from(users).where(eq(users.username, 'wallet_ape'));
    expect(u!.passwordHash).toBeNull();
    const [row] = await ctx.db.select().from(userWallets).where(eq(userWallets.address, w.address));
    expect(row).toMatchObject({ userId: u!.id, walletName: 'Phantom', showOnProfile: false });
    expect(row!.verifiedAt).not.toBeNull();
  });

  it('then the same wallet signs straight in', async () => {
    const w = testWallet();
    await walletAccount(ctx, w, 'returning_ape');
    const again = await walletPost(ctx, '/api/auth/wallet/verify', { ...(await signInProof(ctx, w, 'login')), purpose: 'login' });
    expect(again.body).toMatchObject({ status: 'signedIn', user: { username: 'returning_ape' } });
  });

  it('a token works once, and not after 15 minutes', async () => {
    const token = await tokenFor(testWallet());
    expect((await walletPost(ctx, SIGNUP, { signupToken: token, username: 'first_use' })).status).toBe(201);
    expect((await walletPost(ctx, SIGNUP, { signupToken: token, username: 'second_use' })).body.code).toBe('SIGNUP_EXPIRED');
    const late = await tokenFor(testWallet());
    ctx.clock.advance(15 * 60_000 + 1);
    expect((await walletPost(ctx, SIGNUP, { signupToken: late, username: 'too_late' })).body.code).toBe('SIGNUP_EXPIRED');
  });

  it('a taken name doesn’t burn the token (Review Focus 1); reserved names are refused', async () => {
    await ctx.createUser('taken_name');
    const token = await tokenFor(testWallet());
    expect((await walletPost(ctx, SIGNUP, { signupToken: token, username: 'TAKEN_NAME' })).body.code).toBe('USERNAME_TAKEN');
    expect((await walletPost(ctx, SIGNUP, { signupToken: token, username: 'admin' })).body.code).toBe('USERNAME_RESERVED');
    expect((await walletPost(ctx, SIGNUP, { signupToken: token, username: 'free_name' })).status).toBe(201);
  });

  it('a typed address on another account gives way; a verified one refuses', async () => {
    const typedOwner = await ctx.createUser('typed_it');
    const w = testWallet();
    await ctx.db.insert(userWallets).values({ address: w.address, userId: typedOwner.id, verifiedAt: null, createdAt: ctx.clock.now() });
    expect((await walletPost(ctx, SIGNUP, { signupToken: await tokenFor(w), username: 'real_owner' })).status).toBe(201);
    const [row] = await ctx.db.select().from(userWallets).where(eq(userWallets.address, w.address));
    expect(row!.userId).not.toBe(typedOwner.id);

    // Another account verified the wallet after this one signed (a race): the signup must not steal it.
    const w2 = testWallet();
    const token = await tokenFor(w2);
    const other = await ctx.createUser('got_there_first');
    await ctx.db.insert(userWallets).values({ address: w2.address, userId: other.id, verifiedAt: ctx.clock.now(), createdAt: ctx.clock.now() });
    expect((await walletPost(ctx, SIGNUP, { signupToken: token, username: 'too_slow' })).body.code).toBe('WALLET_IN_USE');
  });
});
