import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import { testDb } from './helpers.ts';
import type { DbHandle } from '../src/db/client.ts';
import { TREASURY, createWallet, decryptSecret, encryptSecret, parseWorldKey, signerFor, walletOf } from '../src/world/wallets.ts';
import { wallets } from '../src/db/schema.ts';

const key = randomBytes(32);
let h: DbHandle;
beforeAll(async () => { h = await testDb(); });
afterAll(() => h.close());

describe('wallet secrets', () => {
  it('round-trips and never stores the plaintext', () => {
    const kp = Keypair.generate();
    const blob = encryptSecret(kp.secretKey, key);
    expect(blob.startsWith('v1.')).toBe(true);
    expect(blob).not.toContain(Buffer.from(kp.secretKey).toString('base64'));
    expect(Buffer.from(decryptSecret(blob, key))).toEqual(Buffer.from(kp.secretKey));
  });
  it('rejects a wrong key or a tampered blob', () => {
    const blob = encryptSecret(Keypair.generate().secretKey, key);
    expect(() => decryptSecret(blob, randomBytes(32))).toThrow();
    const parts = blob.split('.'); parts[3] = Buffer.from('tampered-secret-bytes').toString('base64');
    expect(() => decryptSecret(parts.join('.'), key)).toThrow();
  });
  it('requires a 32-byte base64 WORLD_KEY', () => {
    expect(() => parseWorldKey('short')).toThrow(/32 bytes/);
    expect(parseWorldKey(key.toString('base64'))).toEqual(key);
  });
});

describe('wallet rows', () => {
  it('creates one wallet per owner, idempotently, and signs with the stored key', async () => {
    const pk = await createWallet(h.db, TREASURY, key, new Date());
    expect(await createWallet(h.db, TREASURY, key, new Date())).toBe(pk);
    expect((await walletOf(h.db, TREASURY))?.publicKey).toBe(pk);
    expect((await signerFor(h.db, TREASURY, key)).publicKey.toBase58()).toBe(pk);
    expect(await h.db.select().from(wallets)).toHaveLength(1);
  });
  it('walletOf never exposes the secret', async () => {
    expect(Object.keys((await walletOf(h.db, TREASURY))!)).toEqual(['ownerId', 'publicKey', 'fundedAt']);
  });
});
