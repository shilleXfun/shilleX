import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { hash } from '@node-rs/argon2';
import { makeTestApp, type TestCtx } from './helpers.ts';
import { messageProof, signInProof, testWallet, walletAccount, walletPost } from './wallet-helpers.ts';
import { notifications, users, userWallets } from '../src/db/schema.ts';
import { payoutWallet } from '../src/services/wallets.ts';
import type { TestUser } from './helpers.ts';
import type { TestWallet } from './wallet-helpers.ts';

const LINK = '/api/me/wallets';
let ctx: TestCtx;
beforeEach(async () => { ctx = await makeTestApp(); });
afterEach(() => ctx.close());

/** The account proof that must come with a link: the password, or a `confirm` signature by a wallet already on the account. */
const proofBy = async (user: TestUser, by: TestWallet | string) =>
  typeof by === 'string' ? { password: by } : { wallet: await signInProof(ctx, by, 'confirm', user) };
/** Links `w` to `user`: the new wallet signs a `link` challenge, and `by` proves it is the account holder asking. */
const link = async (user: TestUser, w: TestWallet, by: TestWallet | string) =>
  walletPost(ctx, LINK, { wallet: await messageProof(ctx, w, 'link', user), proof: await proofBy(user, by) }, user);
const signInChanges = (userId: string) => ctx.db.select().from(notifications)
  .where(and(eq(notifications.userId, userId), eq(notifications.type, 'sign_in_change')));

describe('linking wallets', () => {
  it('links a second wallet, verified, once a wallet already on the account confirms it', async () => {
    const w1 = testWallet(), w2 = testWallet();
    const me = await walletAccount(ctx, w1, 'two_wallets');
    const r = await link(me, w2, w1);
    expect(r.status).toBe(200);
    expect(r.body.signIn.wallets.map((w: { address: string; verified: boolean }) => [w.address, w.verified])).toContainEqual([w2.address, true]);
  });

  it('a session alone can’t link a wallet: no proof is PROOF_REQUIRED, a wrong one PROOF_FAILED (stolen-session takeover)', async () => {
    const r = await walletPost(ctx, '/api/auth/signup', { username: 'pw_linker', displayName: 'pw', password: 'old-password-1' });
    const me = { id: r.body.user.id, username: 'pw_linker', cookie: r.cookie! };
    const w = testWallet();
    const bare = await walletPost(ctx, LINK, { wallet: await messageProof(ctx, w, 'link', me) }, me);
    expect([bare.status, bare.body.code]).toEqual([403, 'PROOF_REQUIRED']);
    const wrong = await link(me, w, 'not-my-password');
    expect([wrong.status, wrong.body.code]).toEqual([403, 'PROOF_FAILED']);
    // A password account proves itself with its password; a wallet signature doesn't count.
    const walletInstead = await walletPost(ctx, LINK, { wallet: await messageProof(ctx, w, 'link', me), proof: { wallet: await signInProof(ctx, testWallet(), 'confirm', me) } }, me);
    expect([walletInstead.status, walletInstead.body.code]).toEqual([403, 'PROOF_FAILED']);
    expect((await ctx.db.select().from(userWallets).where(eq(userWallets.userId, me.id)))).toHaveLength(0);
    expect((await link(me, w, 'old-password-1')).status).toBe(200);
  });

  it('a wallet-only account confirms with one of its own wallets, never a stranger’s', async () => {
    const mine = testWallet();
    const me = await walletAccount(ctx, mine, 'wallet_linker');
    const w = testWallet();
    const stranger = await link(me, w, testWallet());
    expect([stranger.status, stranger.body.code]).toEqual([403, 'PROOF_FAILED']);
    const password = await link(me, w, 'any-password');
    expect([password.status, password.body.code]).toEqual([403, 'PROOF_FAILED']);
    expect((await link(me, w, mine)).status).toBe(200);
  });

  it('a refused proof doesn’t burn the new wallet’s signature', async () => {
    const mine = testWallet();
    const me = await walletAccount(ctx, mine, 'retrier');
    const w = testWallet();
    const signed = await messageProof(ctx, w, 'link', me);
    expect((await walletPost(ctx, LINK, { wallet: signed, proof: await proofBy(me, testWallet()) }, me)).body.code).toBe('PROOF_FAILED');
    expect((await walletPost(ctx, LINK, { wallet: signed, proof: await proofBy(me, mine) }, me)).status).toBe(200);
  });

  it('a link nonce belongs to the user who asked for it', async () => {
    const a = await walletAccount(ctx, testWallet(), 'asker');
    const bWallet = testWallet();
    const b = await walletAccount(ctx, bWallet, 'thief');
    const p = await signInProof(ctx, testWallet(), 'link', a);
    expect((await walletPost(ctx, LINK, { wallet: p, proof: await proofBy(b, bWallet) }, b)).body.code).toBe('CHALLENGE_EXPIRED');
  });

  it('a wallet verified elsewhere is WALLET_IN_USE; a typed one elsewhere gives way; my own typed one becomes verified', async () => {
    const shared = testWallet();
    await walletAccount(ctx, shared, 'first_owner');
    const w1 = testWallet();
    const me = await walletAccount(ctx, w1, 'second_owner');
    expect((await link(me, shared, w1)).body.code).toBe('WALLET_IN_USE');

    const typedElsewhere = testWallet();
    const other = await ctx.createUser('typist');
    await ctx.db.insert(userWallets).values({ address: typedElsewhere.address, userId: other.id, verifiedAt: null, createdAt: ctx.clock.now() });
    expect((await link(me, typedElsewhere, w1)).status).toBe(200);

    const mine = testWallet();
    await ctx.db.insert(userWallets).values({ address: mine.address, userId: me.id, verifiedAt: null, showOnProfile: true, createdAt: ctx.clock.now() });
    await link(me, mine, w1);
    const [row] = await ctx.db.select().from(userWallets).where(eq(userWallets.address, mine.address));
    expect(row!.verifiedAt).not.toBeNull();
    expect(row!.showOnProfile).toBe(true);
  });

  it('admin stays a password login: an admin account can’t link a wallet (spec §8)', async () => {
    const admin = await ctx.createUser('admin');
    const r = await ctx.as(admin).post('/api/auth/wallet/challenge', { purpose: 'link' });
    expect([r.status, r.body.code]).toEqual([403, 'ADMIN_PASSWORD_ONLY']);
    expect(await ctx.db.select().from(userWallets).where(eq(userWallets.userId, admin.id))).toHaveLength(0);
  });

  it('stops at 5 wallets', async () => {
    const w1 = testWallet();
    const me = await walletAccount(ctx, w1, 'collector');
    for (let i = 0; i < 4; i++) expect((await link(me, testWallet(), w1)).status).toBe(200);
    expect((await link(me, testWallet(), w1)).body.code).toBe('WALLET_LIMIT');
  });

  it('the old link path through /auth/wallet/verify is gone', async () => {
    const w1 = testWallet();
    const me = await walletAccount(ctx, w1, 'old_path');
    const r = await walletPost(ctx, '/api/auth/wallet/verify', { ...(await messageProof(ctx, testWallet(), 'link', me)), purpose: 'link' }, me);
    expect([r.status, r.body.code]).toEqual([400, 'VALIDATION']);
  });
});

describe('the owner hears about every link and unlink', () => {
  it('a linked and a removed wallet each leave a sign-in notification pointing at Settings', async () => {
    const w1 = testWallet(), w2 = testWallet();
    const me = await walletAccount(ctx, w1, 'watchful');
    await link(me, w2, w1);
    await ctx.as(me).del(`/api/me/wallets/${w2.address}`);
    const list = (await ctx.as(me).get('/api/notifications')).body.items as { type: string; text: string; href: string }[];
    const changes = list.filter((n) => n.type === 'sign_in_change');
    expect(changes.map((n) => n.href)).toEqual(['/settings', '/settings']);
    expect(changes.map((n) => n.text).join(' | ')).toMatch(/removed.*\| .*linked/);
    expect(changes[0]!.text).toContain(`${w2.address.slice(0, 4)}…${w2.address.slice(-4)}`);
    expect(ctx.bus.find('notification:new').filter((e) => e.target === `user:${me.id}`)).toHaveLength(2);
  });

  it('can’t be switched off in notification preferences, so a stolen session can’t hide them', async () => {
    const w1 = testWallet();
    const me = await walletAccount(ctx, w1, 'cant_mute');
    expect((await ctx.as(me).put('/api/me/notification-prefs', { prefs: [{ type: 'sign_in_change', enabled: false }] })).status).toBe(400);
    expect((await ctx.as(me).get('/api/me/settings')).body.notificationPrefs.map((p: { type: string }) => p.type)).not.toContain('sign_in_change');
    await link(me, testWallet(), w1);
    expect(await signInChanges(me.id)).toHaveLength(1);
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
    await link(me, w2, w1);
    expect((await ctx.as(me).del(`/api/me/wallets/${w1.address}`)).status).toBe(200);
    expect((await ctx.as(me).del(`/api/me/wallets/${w2.address}`)).body.code).toBe('LAST_SIGN_IN_METHOD');
    expect((await ctx.as(me).del(`/api/me/wallets/${typed.address}`)).status).toBe(200);
    await ctx.db.update(users).set({ passwordHash: await hash('long-enough-1') }).where(eq(users.id, me.id));
    expect((await ctx.as(me).del(`/api/me/wallets/${w2.address}`)).status).toBe(200);
  });

  it('two removals at once still leave one verified wallet on a wallet-only account', async () => {
    const w1 = testWallet(), w2 = testWallet();
    const me = await walletAccount(ctx, w1, 'double_remover');
    await link(me, w2, w1);
    const rs = await Promise.all([ctx.as(me).del(`/api/me/wallets/${w1.address}`), ctx.as(me).del(`/api/me/wallets/${w2.address}`)]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await ctx.db.select().from(userWallets).where(eq(userWallets.userId, me.id))).toHaveLength(1);
  });

  it('payoutWallet reads the verified payout wallet (MAINNET contract)', async () => {
    const w = testWallet();
    const me = await walletAccount(ctx, w, 'payee');
    expect(await payoutWallet(ctx.db, me.id)).toBeNull();
    await ctx.db.update(userWallets).set({ isPayout: true }).where(eq(userWallets.address, w.address));
    expect(await payoutWallet(ctx.db, me.id)).toBe(w.address);
  });
});
