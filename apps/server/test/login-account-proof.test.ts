import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTestApp, type TestCtx, type TestUser } from './helpers.ts';
import { messageProof, signInProof, testWallet, walletAccount, walletPost } from './wallet-helpers.ts';

let ctx: TestCtx;
beforeEach(async () => { ctx = await makeTestApp(); });
afterEach(() => ctx.close());

async function passwordAccount(username: string, email?: string): Promise<TestUser> {
  const r = await walletPost(ctx, '/api/auth/signup', { username, displayName: username, password: 'old-password-1', ...(email ? { email } : {}) });
  return { id: r.body.user.id, username, cookie: r.cookie! };
}
const me = (u: TestUser) => ctx.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: u.cookie } }).then((r) => r.json().user);

describe('password changes', () => {
  it('a password account gives the current password; other sessions end, this one stays', async () => {
    const a = await passwordAccount('pw_changer');
    const other = { ...a, cookie: (await walletPost(ctx, '/api/auth/login', { username: 'pw_changer', password: 'old-password-1' })).cookie! };
    expect((await ctx.as(a).put('/api/me/password', { password: 'new-password-1', proof: { password: 'wrong-one' } })).body.code).toBe('PROOF_FAILED');
    const ok = await ctx.as(a).put('/api/me/password', { password: 'new-password-1', proof: { password: 'old-password-1' } });
    expect(ok.status).toBe(200);
    expect(await me(other)).toBeNull();
    expect((await me(a)).username).toBe('pw_changer');
    expect(ctx.bus.disconnectedSessions).toHaveLength(1);
    expect((await walletPost(ctx, '/api/auth/login', { username: 'pw_changer', password: 'new-password-1' })).status).toBe(200);
  });

  it('a wallet-only account sets a password with a confirm signature, never a password proof (Review Focus 5)', async () => {
    const w = testWallet();
    const a = await walletAccount(ctx, w, 'wallet_setter');
    expect((await ctx.as(a).put('/api/me/password', { password: 'first-password', proof: { password: 'anything' } })).body.code).toBe('PROOF_FAILED');
    const notMine = await signInProof(ctx, testWallet(), 'confirm', a);
    expect((await ctx.as(a).put('/api/me/password', { password: 'first-password', proof: { wallet: notMine } })).body.code).toBe('PROOF_FAILED');
    const proof = await messageProof(ctx, w, 'confirm', a);
    const r = await ctx.as(a).put('/api/me/password', { password: 'first-password', proof: { wallet: proof } });
    expect(r.body.signIn.hasPassword).toBe(true);
    expect((await walletPost(ctx, '/api/auth/login', { username: 'wallet_setter', password: 'first-password' })).status).toBe(200);
  });
});

describe('email changes', () => {
  it('sets, refuses a taken one, and removes, each with proof', async () => {
    await passwordAccount('mail_owner', 'taken@example.com');
    const a = await passwordAccount('mail_changer');
    const proof = { password: 'old-password-1' };
    expect((await ctx.as(a).put('/api/me/email', { email: 'New@Example.com', proof })).body.signIn.email).toBe('new@example.com');
    expect((await ctx.as(a).put('/api/me/email', { email: 'TAKEN@example.com', proof })).body.code).toBe('EMAIL_TAKEN');
    expect((await ctx.as(a).put('/api/me/email', { email: 'x@example.com', proof: { password: 'nope-nope' } })).body.code).toBe('PROOF_FAILED');
    expect((await ctx.as(a).put('/api/me/email', { email: null, proof })).body.signIn.email).toBeNull();
    // 5 an hour per user: that was 4; the 5th is allowed, the 6th is not.
    expect((await ctx.as(a).put('/api/me/email', { email: 'five@example.com', proof })).status).toBe(200);
    expect((await ctx.as(a).put('/api/me/email', { email: 'six@example.com', proof })).status).toBe(429);
  });
});

describe('reset with a wallet', () => {
  it('a linked wallet sets a new password, ends every session and signs in', async () => {
    const w = testWallet();
    const a = await walletAccount(ctx, w, 'forgetful');
    const proof = await signInProof(ctx, w, 'reset');
    const r = await walletPost(ctx, '/api/auth/password/reset-with-wallet', { proof, password: 'brand-new-pass' });
    expect(r.status).toBe(200);
    expect(r.body.user.username).toBe('forgetful');
    expect(await me(a)).toBeNull();
    expect((await walletPost(ctx, '/api/auth/login', { username: 'forgetful', password: 'brand-new-pass' })).status).toBe(200);
  });

  it('a wallet linked to nobody, or a login nonce, can’t reset', async () => {
    expect((await walletPost(ctx, '/api/auth/password/reset-with-wallet', { proof: await signInProof(ctx, testWallet(), 'reset'), password: 'brand-new-pass' })).body.code).toBe('NO_WALLET_ACCOUNT');
    const w = testWallet();
    await walletAccount(ctx, w, 'nonce_mixer');
    expect((await walletPost(ctx, '/api/auth/password/reset-with-wallet', { proof: await signInProof(ctx, w, 'login'), password: 'brand-new-pass' })).body.code).toBe('CHALLENGE_EXPIRED');
  });
});
