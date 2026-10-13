import { describe, it, expect, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import { testDb } from './helpers.ts';
import { FakeRpc } from './ledger-fakes.ts';
import { DEVNET_GENESIS, assertCustodyNetwork, isAddress } from '../src/ledger/rpc.ts';
import { hotVault, parseMainnetKey } from '../src/ledger/vault.ts';
import { payUrl, solString } from '../src/ledger/solana-pay.ts';
import { MAINNET_GENESIS } from '../src/world/devnet-chain.ts';
import { decryptSecret } from '../src/world/wallets.ts';
import { ledgerVault } from '../src/db/schema.ts';

let close: (() => Promise<void>) | null = null;
afterEach(async () => { await close?.(); close = null; });

describe('custody network check', () => {
  it('accepts only mainnet-beta for mainnet, devnet for rehearsal, and neither for local', async () => {
    const rpc = new FakeRpc();
    rpc.genesis = MAINNET_GENESIS;
    await expect(assertCustodyNetwork(rpc, 'mainnet')).resolves.toBeUndefined();
    await expect(assertCustodyNetwork(rpc, 'devnet')).rejects.toMatchObject({ code: 'WRONG_NETWORK' });
    await expect(assertCustodyNetwork(rpc, 'local')).rejects.toMatchObject({ code: 'WRONG_NETWORK' });
    rpc.genesis = DEVNET_GENESIS;
    await expect(assertCustodyNetwork(rpc, 'devnet')).resolves.toBeUndefined();
    await expect(assertCustodyNetwork(rpc, 'mainnet')).rejects.toMatchObject({ code: 'WRONG_NETWORK' });
    rpc.genesis = 'LocalValidatorGenesis1111111111111111111111';
    await expect(assertCustodyNetwork(rpc, 'local')).resolves.toBeUndefined();
  });
  it('knows a Solana address', () => {
    expect(isAddress(Keypair.generate().publicKey.toBase58())).toBe(true);
    expect(isAddress('nope')).toBe(false);
    expect(isAddress(undefined)).toBe(false);
  });
});

describe('hot vault', () => {
  it('is created once per network, encrypted with MAINNET_KEY', async () => {
    const h = await testDb(); close = () => h.close();
    const key = randomBytes(32), now = new Date();
    const a = await hotVault(h.db, key, 'devnet', now), b = await hotVault(h.db, key, 'devnet', now), m = await hotVault(h.db, key, 'mainnet', now);
    expect(a.publicKey).toBe(b.publicKey);
    expect(m.publicKey).not.toBe(a.publicKey);
    expect(a.signer().publicKey.toBase58()).toBe(a.publicKey);
    const [row] = await h.db.select().from(ledgerVault);
    expect(() => decryptSecret(row!.encryptedSecret, randomBytes(32))).toThrow();
  });
  it('wants exactly 32 bytes of base64', () => {
    expect(() => parseMainnetKey(undefined)).toThrow(/MAINNET_KEY/);
    expect(() => parseMainnetKey(Buffer.alloc(16).toString('base64'))).toThrow(/MAINNET_KEY/);
    expect(parseMainnetKey(Buffer.alloc(32, 1).toString('base64')).length).toBe(32);
  });
});

describe('Solana Pay', () => {
  it('builds a transfer request with the amount in SOL and the reference', () => {
    expect(solString(100_000_000)).toBe('0.1');
    expect(solString(1)).toBe('0.000000001');
    expect(payUrl({ recipient: 'Hot1', lamports: 123_000_000, reference: 'Ref1', label: 'Shillex', message: 'Fund @moth' }))
      .toBe('solana:Hot1?amount=0.123&reference=Ref1&label=Shillex&message=Fund%20%40moth');
  });
});
