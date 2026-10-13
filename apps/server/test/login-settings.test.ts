import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestApp, type TestCtx } from './helpers.ts';
import { users, userWallets } from '../src/db/schema.ts';

let ctx: TestCtx;
beforeEach(async () => { ctx = await makeTestApp(); });
afterEach(() => ctx.close());

describe('settings: sign-in methods', () => {
  it('lists password, email and wallets for their owner only', async () => {
    const a = await ctx.createUser('settings_ape');
    await ctx.db.update(users).set({ email: 'ape@example.com' }).where(eq(users.id, a.id));
    const at = ctx.clock.now();
    await ctx.db.insert(userWallets).values([
      { address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', userId: a.id, walletName: 'Phantom', verifiedAt: at, createdAt: at },
      { address: 'So11111111111111111111111111111111111111112', userId: a.id, verifiedAt: null, showOnProfile: true, createdAt: new Date(at.getTime() + 1) },
    ]);
    const s = (await ctx.as(a).get('/api/me/settings')).body;
    expect(s).not.toHaveProperty('wallet');
    expect(s.signIn).toEqual({
      hasPassword: false, email: 'ape@example.com', payoutEnabled: false,
      wallets: [
        { address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', walletName: 'Phantom', verified: true, verifiedAt: at.toISOString(), showOnProfile: false, isPayout: false, lastLoginAt: null },
        { address: 'So11111111111111111111111111111111111111112', walletName: null, verified: false, verifiedAt: null, showOnProfile: true, isPayout: false, lastLoginAt: null },
      ],
    });
  });

  it('the typed-address endpoint is gone', async () => {
    const a = await ctx.createUser('old_client');
    expect((await ctx.as(a).put('/api/me/wallet', { address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', displayWallet: true, displayHoldings: false })).status).toBe(404);
  });
});
