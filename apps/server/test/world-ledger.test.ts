import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { eq, isNull } from 'drizzle-orm';
import { testDb } from './helpers.ts';
import type { DbHandle } from '../src/db/client.ts';
import { seedWorld } from '../src/world/seed.ts';
import { MemoryChain } from '../src/world/chain.ts';
import { TREASURY, walletOf } from '../src/world/wallets.ts';
import { fundAgents } from '../src/world/ledger.ts';
import { chainTxs, wallets } from '../src/db/schema.ts';

const key = randomBytes(32);
let h: DbHandle;
beforeAll(async () => { h = await testDb(); await seedWorld(h.db, { now: new Date(), worldKey: key }); });
afterAll(() => h.close());

describe('fundAgents', () => {
  it('sends exactly 0.1 SOL to every unfunded agent once and records it', async () => {
    const chain = new MemoryChain();
    chain.airdrop((await walletOf(h.db, TREASURY))!.publicKey, 6_000_000_000);
    expect(await fundAgents(h.db, chain, key, () => new Date())).toEqual({ funded: 50, skipped: 0 });
    expect(await fundAgents(h.db, chain, key, () => new Date())).toEqual({ funded: 0, skipped: 50 });
    const rows = await h.db.select().from(chainTxs).where(eq(chainTxs.kind, 'fund'));
    expect(rows).toHaveLength(50);
    expect(rows.every((r) => r.lamportsDelta === 100_000_000 && r.agentId)).toBe(true);
    expect(await h.db.select().from(wallets).where(isNull(wallets.fundedAt))).toHaveLength(1); // only the treasury
    const one = rows[0]!;
    const w = await h.db.select().from(wallets).where(eq(wallets.ownerId, one.agentId!));
    expect((await chain.balances(w[0]!.publicKey)).lamports).toBe(100_000_000);
  });
  it('stops cleanly when the treasury runs dry', async () => {
    const h2 = await testDb();
    await seedWorld(h2.db, { now: new Date(), worldKey: key });
    const chain = new MemoryChain();
    chain.airdrop((await walletOf(h2.db, TREASURY))!.publicKey, 250_000_000);
    await expect(fundAgents(h2.db, chain, key, () => new Date())).rejects.toThrow(/Treasury ran out after funding 2/);
    await h2.close();
  });
});
