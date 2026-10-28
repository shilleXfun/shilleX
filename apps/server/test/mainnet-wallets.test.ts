import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDb } from './helpers.ts';
import { loadConfig } from '../src/config.ts';
import { agents, solWallets, users } from '../src/db/schema.ts';
import { MemoryChain } from '../src/world/chain.ts';
import { TREASURY, createWallet } from '../src/world/wallets.ts';
import { regenerateLinkKey, registerLinked } from '../src/agents/external/link.ts';
import { ownerAgentView } from '../src/agents/external/owner-view.ts';

/**
 * On mainnet an owner funds the agent's real-SOL wallet (the vault), never its world wallet: the address they are shown, the one
 * registering hands back and the one /agent/me reads must be the vault's (2026-10-28; the devnet one would take real SOL to a
 * wallet the agent never trades from).
 */
const KEY = Buffer.alloc(32, 5).toString('base64');
const config = loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 's', SOLANA_NETWORK: 'mainnet', SOLANA_MAINNET_RPC_URL: 'https://mainnet.helius-rpc.com/?api-key=x', SOL_TRADING: 'off', SOL_WALLET_KEY: Buffer.alloc(32, 6).toString('base64'), WORLD_KEY: KEY });

describe('wallets on mainnet', () => {
  it('registers an agent with its vault wallet, and shows its owner that wallet', async () => {
    const { db } = await testDb();
    const now = () => new Date('2026-10-28T16:00:00Z');
    const chain = new MemoryChain();
    chain.airdrop(await createWallet(db, TREASURY, Buffer.from(KEY, 'base64'), now()), 1e9);
    await db.insert(users).values({ id: 'o1', username: 'ownerm', displayName: 'Owner', createdAt: now() });
    const { key } = await regenerateLinkKey(db, 's', 'o1', now());
    const r = await registerLinked({ db, config, now, chain, key: Buffer.from(KEY, 'base64') }, { handle: 'realbot', name: 'Real Bot', link_key: key }, '1.2.3.4');
    const [vault] = await db.select().from(solWallets).where(eq(solWallets.ownerId, r.agentId));
    expect(vault).toBeTruthy();
    expect(r.wallet).toBe(vault!.publicKey);
    expect(r.funding).toBe('none');
    const v = await ownerAgentView({ db, chain, config, now: now() }, r.agentId);
    expect(v.network).toBe('mainnet');
    expect(v.wallet?.address).toBe(vault!.publicKey);
    expect(v.wallet?.sol).toBe(0);
    const [a] = await db.select().from(agents).where(eq(agents.userId, r.agentId));
    expect(a?.ownerId).toBe('o1');
  });
});
