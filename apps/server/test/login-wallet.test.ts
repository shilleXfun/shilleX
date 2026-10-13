import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import bs58 from 'bs58';
import { makeTestApp, type TestCtx } from './helpers.ts';
import { b64, challenge, messageProof, signInProof, testWallet, walletPost } from './wallet-helpers.ts';
import { authNonces, userWallets } from '../src/db/schema.ts';

const VERIFY = '/api/auth/wallet/verify';
let ctx: TestCtx;
// A fresh app per test: the verify route allows 10 calls a minute per IP.
beforeEach(async () => { ctx = await makeTestApp(); });
afterEach(() => ctx.close());

describe('wallet challenge', () => {
  it('issues and stores a challenge bound to PUBLIC_URL', async () => {
    const r = await ctx.as(null).post('/api/auth/wallet/challenge', { purpose: 'login' });
    expect(r.status).toBe(200);
    expect(r.body.input).toMatchObject({ domain: 'localhost:5173', uri: 'http://localhost:5173', version: '1', chainId: 'mainnet', nonce: r.body.nonce });
    expect(r.body.message).toBeNull();
    const [row] = await ctx.db.select().from(authNonces).where(eq(authNonces.nonce, r.body.nonce));
    expect(row).toMatchObject({ purpose: 'login', userId: null, usedAt: null });
  });

  it('builds the message to sign when an address is given, and refuses a non-address', async () => {
    const w = testWallet();
    const ch = await challenge(ctx, null, 'login', w.address);
    expect(ch.message).toContain(`${w.address}\n\nSign in to Shillex.`);
    expect((await ctx.as(null).post('/api/auth/wallet/challenge', { purpose: 'login', address: bs58.encode(new Uint8Array(31)) })).status).toBe(400);
  });

  it('link and confirm need a session', async () => {
    expect((await ctx.as(null).post('/api/auth/wallet/challenge', { purpose: 'link' })).status).toBe(401);
    expect((await ctx.as(null).post('/api/auth/wallet/challenge', { purpose: 'confirm' })).status).toBe(401);
  });
});

describe('wallet sign-in', () => {
  it('an unknown wallet, in either mode, gets a signup token and no session', async () => {
    for (const make of [signInProof, messageProof]) {
      const w = testWallet();
      const r = await walletPost(ctx, VERIFY, { ...(await make(ctx, w, 'login')), purpose: 'login' });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ status: 'new', address: w.address, signupToken: expect.any(String) });
      expect(r.cookie).toBeNull();
    }
  });

  it('a verified wallet signs its owner in and records the login', async () => {
    const u = await ctx.createUser('wallet_owner');
    const w = testWallet();
    await ctx.db.insert(userWallets).values({ address: w.address, userId: u.id, walletName: 'Phantom', verifiedAt: ctx.clock.now(), createdAt: ctx.clock.now() });
    const r = await walletPost(ctx, VERIFY, { ...(await signInProof(ctx, w, 'login')), purpose: 'login' });
    expect(r.body).toMatchObject({ status: 'signedIn', user: { username: 'wallet_owner' } });
    expect(r.cookie).toMatch(/^sx_session=/);
    const me = await ctx.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: r.cookie! } });
    expect(me.json().user.username).toBe('wallet_owner');
    expect((await ctx.db.select().from(userWallets))[0]!.lastLoginAt).not.toBeNull();
  });

  it('a wallet that reports a long name still signs in; the name is cut to 40 characters', async () => {
    const w = testWallet();
    const r = await walletPost(ctx, VERIFY, { ...(await signInProof(ctx, w, 'login')), walletName: `  ${'Very Long Wallet Name '.repeat(4)}`, purpose: 'login' });
    expect(r.status).toBe(200);
    expect(r.body.walletName).toBe('Very Long Wallet Name Very Long Wallet N');
  });

  it('a typed (unverified) address never signs anyone in', async () => {
    const u = await ctx.createUser('typed_owner');
    const w = testWallet();
    await ctx.db.insert(userWallets).values({ address: w.address, userId: u.id, verifiedAt: null, createdAt: ctx.clock.now() });
    const r = await walletPost(ctx, VERIFY, { ...(await signInProof(ctx, w, 'login')), purpose: 'login' });
    expect(r.body.status).toBe('new');
    expect(r.cookie).toBeNull();
  });

  it('replay, expiry and an unknown nonce all give CHALLENGE_EXPIRED', async () => {
    const w = testWallet();
    const p = { ...(await signInProof(ctx, w, 'login')), purpose: 'login' };
    expect((await walletPost(ctx, VERIFY, p)).status).toBe(200);
    const replay = await walletPost(ctx, VERIFY, p);
    expect([replay.status, replay.body.code]).toEqual([400, 'CHALLENGE_EXPIRED']);
    const late = { ...(await signInProof(ctx, w, 'login')), purpose: 'login' };
    ctx.clock.advance(5 * 60_000 + 1);
    expect((await walletPost(ctx, VERIFY, late)).body.code).toBe('CHALLENGE_EXPIRED');
    expect((await walletPost(ctx, VERIFY, { ...p, nonce: 'no-such-nonce-at-all' })).body.code).toBe('CHALLENGE_EXPIRED');
  });

  it('a double submit of one signature succeeds once (Review Focus 2)', async () => {
    const p = { ...(await signInProof(ctx, testWallet(), 'login')), purpose: 'login' };
    const rs = await Promise.all([walletPost(ctx, VERIFY, p), walletPost(ctx, VERIFY, p)]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 400]);
  });

  it('a nonce issued for one purpose is useless for another', async () => {
    const w = testWallet();
    const ch = await challenge(ctx, null, 'reset');
    const p = await signInProof(ctx, w, 'login');
    expect((await walletPost(ctx, VERIFY, { ...p, nonce: ch.nonce, purpose: 'login' })).body.code).toBe('CHALLENGE_EXPIRED');
  });

  it('rejects a signature by another key, and a message that differs from the issued one', async () => {
    const w = testWallet();
    const byOther = { ...(await signInProof(ctx, w, 'login', null, { signer: testWallet() })), purpose: 'login' };
    expect((await walletPost(ctx, VERIFY, byOther)).body.code).toBe('SIGN_IN_INVALID');
    const edited = { ...(await messageProof(ctx, w, 'login', null, { text: (m) => m.replace('Sign in', 'Sign up') })), purpose: 'login' };
    expect((await walletPost(ctx, VERIFY, edited)).body.code).toBe('SIGN_IN_INVALID');
    const wrongField = { ...(await signInProof(ctx, w, 'login', null, { edit: (f) => ({ ...f, domain: 'evil.example' }) })), purpose: 'login' };
    expect((await walletPost(ctx, VERIFY, wrongField)).body.code).toBe('SIGN_IN_INVALID');
  });

  it('malformed input is a 400, never a 500 (Review Focus 3)', async () => {
    const w = testWallet();
    const cases: ((p: Record<string, unknown>) => Record<string, unknown>)[] = [
      (p) => ({ ...p, address: bs58.encode(new Uint8Array(31).fill(1)) }),
      (p) => ({ ...p, address: '0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl' }),
      (p) => ({ ...p, signature: b64(new Uint8Array(63)) }),
      (p) => ({ ...p, signedMessage: '***not base64***' }),
    ];
    for (const breakIt of cases) {
      const r = await walletPost(ctx, VERIFY, breakIt({ ...(await signInProof(ctx, w, 'login')), purpose: 'login' }));
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('SIGN_IN_INVALID');
    }
  });
});
