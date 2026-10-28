import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDb } from './helpers.ts';
import { loadConfig } from '../src/config.ts';
import { agentGrants, users } from '../src/db/schema.ts';
import { MemoryChain } from '../src/world/chain.ts';
import { TREASURY, createWallet } from '../src/world/wallets.ts';
import { sendStartGrant } from '../src/agents/external/grant.ts';

/**
 * The 0 SOL bug (2026-10-28 brief §4): an outside agent showed 0 SOL instead of 0.05 because the start grant kept a whole SOL
 * in the treasury and gave up in silence once launches drained it. Now only 0.05 SOL stays back, and a grant that can't go is
 * logged as owed and paid once the treasury can.
 */
const KEY = Buffer.alloc(32, 7);
const config = loadConfig({ NODE_ENV: 'test' });

async function world(treasuryLamports: number) {
  const { db } = await testDb();
  const chain = new MemoryChain();
  const now = () => new Date('2026-10-28T12:00:00Z');
  const lines: string[] = [];
  chain.airdrop(await createWallet(db, TREASURY, KEY, now()), treasuryLamports);
  await db.insert(users).values({ id: 'a1', username: 'tinker', displayName: 'Tinker', kind: 'agent', createdAt: now() });
  const agentPk = await createWallet(db, 'a1', KEY, now());
  return { db, chain, agentPk, lines, d: { db, config, now, chain, key: KEY, log: (m: string) => lines.push(m) } };
}

describe('the start grant', () => {
  it('pays 0.05 SOL from a treasury holding half a SOL (the old 1 SOL floor refused it)', async () => {
    const w = await world(500_000_000);
    expect(await sendStartGrant(w.d, 'a1')).toBe('sent');
    expect((await w.chain.balances(w.agentPk)).lamports).toBe(50_000_000);
  });

  it('logs an owed grant when the treasury is short, then pays it exactly once', async () => {
    const w = await world(60_000_000);
    expect(await sendStartGrant(w.d, 'a1')).toBe('owed');
    expect(w.lines.join('\n')).toMatch(/\[fund\] start grant for @tinker owed: /);
    expect((await w.chain.balances(w.agentPk)).lamports).toBe(0);
    const [t] = await w.db.select().from(users).where(eq(users.id, 'a1'));
    expect(t).toBeTruthy();
    w.chain.airdrop((await (await import('../src/world/wallets.ts')).walletOf(w.db, TREASURY))!.publicKey, 500_000_000);
    expect(await sendStartGrant(w.d, 'a1')).toBe('sent');
    expect(await sendStartGrant(w.d, 'a1')).toBe('sent');
    expect((await w.chain.balances(w.agentPk)).lamports).toBe(50_000_000);
    expect(await w.db.select().from(agentGrants).where(eq(agentGrants.agentId, 'a1'))).toHaveLength(1);
  });
});
