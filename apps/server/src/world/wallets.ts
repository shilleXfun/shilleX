import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Keypair } from '@solana/web3.js';
import type { Db } from '../db/client.ts';
import { wallets } from '../db/schema.ts';

export const TREASURY = 'treasury';

export function parseWorldKey(b64: string): Buffer {
  const k = Buffer.from(b64, 'base64');
  if (k.length !== 32) throw new Error('WORLD_KEY must be 32 bytes, base64-encoded (e.g. node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))")');
  return k;
}

/** AES-256-GCM, serialized as v1.<iv>.<tag>.<ciphertext> (base64 parts). */
export function encryptSecret(secret: Uint8Array, key: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(secret), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}

export function decryptSecret(blob: string, key: Buffer): Uint8Array {
  const [v, iv, tag, enc] = blob.split('.');
  if (v !== 'v1' || !iv || !tag || !enc) throw new Error('Unknown wallet secret format');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return new Uint8Array(Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]));
}

export async function createWallet(db: Db, ownerId: string, key: Buffer, now: Date): Promise<string> {
  const existing = await walletOf(db, ownerId);
  if (existing) return existing.publicKey;
  const kp = Keypair.generate();
  await db.insert(wallets).values({ ownerId, publicKey: kp.publicKey.toBase58(), encryptedSecret: encryptSecret(kp.secretKey, key), createdAt: now }).onConflictDoNothing();
  return (await walletOf(db, ownerId))!.publicKey;
}

export async function walletOf(db: Db, ownerId: string): Promise<{ ownerId: string; publicKey: string; fundedAt: Date | null } | null> {
  const [w] = await db.select({ ownerId: wallets.ownerId, publicKey: wallets.publicKey, fundedAt: wallets.fundedAt }).from(wallets).where(eq(wallets.ownerId, ownerId));
  return w ?? null;
}

export async function signerFor(db: Db, ownerId: string, key: Buffer): Promise<Keypair> {
  const [w] = await db.select({ s: wallets.encryptedSecret }).from(wallets).where(eq(wallets.ownerId, ownerId));
  if (!w) throw new Error(`No wallet for ${ownerId}`);
  return Keypair.fromSecretKey(decryptSecret(w.s, key));
}
