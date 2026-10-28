import { describe, it, expect } from 'vitest';
import { testDb } from './helpers.ts';
import { agents, chainTxs, solTrades, solWallets, users } from '../src/db/schema.ts';
import { MemoryChain } from '../src/world/chain.ts';
import { Indexer } from '../src/world/indexer.ts';
import { createWallet } from '../src/world/wallets.ts';

/**
 * Mainnet money (owner, 2026-10-28: "delete all the fake money in agents, keep their trades"): an agent's balance and P&L are its
 * real-SOL wallet's; its devnet coins, trades and balance stay as history, marked devnet.
 */
describe('agent money on mainnet', () => {
  it('shows the vault wallet and real P&L, and marks the old trades as devnet', async () => {
    const { db } = await testDb();
    const chain = new MemoryChain();
    const now = new Date('2026-10-28T18:00:00Z');
    await db.insert(users).values({ id: 'a1', username: 'kestrel', displayName: 'Kestrel', kind: 'agent', createdAt: now });
    await db.insert(agents).values({ userId: 'a1', origin: 'wild', status: 'active', createdAt: now });
    chain.airdrop(await createWallet(db, 'a1', Buffer.alloc(32, 2), now), 3_000_000_000);
    await db.insert(chainTxs).values({ id: 'tx1', signature: 'sig1', agentId: 'a1', kind: 'buy', mint: 'devmint', lamportsDelta: -100_000_000, tokenDelta: 5_000_000, createdAt: new Date('2026-10-20T10:00:00Z') });
    await db.insert(solWallets).values({ ownerId: 'a1', publicKey: 'VaultAddr1111111111111111111111111111111111', secret: 'x', lamports: 250_000_000, createdAt: now });
    await db.insert(solTrades).values({ id: 't1', agentId: 'a1', kind: 'sell', mint: 'realmint', symbol: 'MEME', sol: 0.15, pnlSol: 0.05, by: 'agent', ok: true, at: now });

    const real = new Indexer(db, chain, () => now, { mainnet: true });
    const card = (await real.leaderboard()).find((c) => c.user.username === 'kestrel')!;
    expect(card.money).toBe('real');
    expect(card.solBalance).toBe(0.25);
    expect(card.publicKey).toBe('VaultAddr1111111111111111111111111111111111');
    expect(card.pnlSol).toBeCloseTo(0.05);
    const trades = await real.trades({ agentId: 'a1' });
    expect(trades[0]).toMatchObject({ kind: 'buy', devnet: true });

    const dev = new Indexer(db, chain, () => now);
    const devCard = (await dev.leaderboard()).find((c) => c.user.username === 'kestrel')!;
    expect(devCard.solBalance).toBe(3);
    expect(devCard.money ?? 'devnet').toBe('devnet');
    expect((await dev.trades({ agentId: 'a1' }))[0]!.devnet).toBeUndefined();
  });
});
