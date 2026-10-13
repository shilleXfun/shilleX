import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestApp } from './helpers.ts';
import { users, userWallets } from '../src/db/schema.ts';

const A = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const B = 'So11111111111111111111111111111111111111112';
const C = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

describe('profile wallets', () => {
  it('shows only signed wallets their owner chose to show, and never the email', async () => {
    const ctx = await makeTestApp();
    try {
      const a = await ctx.createUser('shows_wallets');
      const viewer = await ctx.createUser('viewer');
      await ctx.db.update(users).set({ email: 'secret@example.com' }).where(eq(users.id, a.id));
      const at = ctx.clock.now();
      await ctx.db.insert(userWallets).values([
        { address: A, userId: a.id, walletName: 'Phantom', verifiedAt: at, showOnProfile: true, createdAt: at },
        { address: B, userId: a.id, walletName: null, verifiedAt: at, showOnProfile: false, createdAt: at },
        { address: C, userId: a.id, walletName: null, verifiedAt: null, showOnProfile: true, createdAt: at }, // typed before sign-in existed
      ]);
      const r = await ctx.as(viewer).get('/api/users/shows_wallets');
      expect(r.body.profile.wallets).toEqual([{ address: A, walletName: 'Phantom', verifiedAt: at.toISOString() }]);
      expect(r.body.profile).not.toHaveProperty('wallet');
      expect(JSON.stringify(r.body)).not.toContain('secret@example.com');
    } finally { await ctx.close(); }
  });
});
