import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { solWallets } from '../db/schema.ts';

/**
 * The vault for real SOL wallets (2026-10-27, owner: "they should generate the wallets, stored very securely so no one can see or
 * exploit"). Each agent generates its own keypair here. Its secret is sealed with AES-256-GCM under a key derived for that wallet
 * alone (HKDF-SHA256 of SOL_WALLET_KEY, salted with the address), and the sealed blob is bound to its row (owner id and address as
 * associated data), so a blob copied onto another row or another wallet does not open. SOL_WALLET_KEY lives only in the server's
 * environment and must differ from WORLD_KEY. Nothing outside this file ever sees a secret: callers get a signer for one
 * transaction and nothing else; no route, log, prompt or export carries one.
 */
const VERSION = 'v1';

export function parseVaultKey(b64: string | undefined, worldKey: string | undefined): Buffer {
  if (!b64) throw new Error('SOL_WALLET_KEY is not set');
  if (b64 === worldKey) throw new Error('SOL_WALLET_KEY must differ from WORLD_KEY');
  const k = Buffer.from(b64, 'base64');
  if (k.length !== 32) throw new Error('SOL_WALLET_KEY must be 32 bytes of base64');
  return k;
}

const walletKey = (master: Buffer, address: string) => Buffer.from(hkdfSync('sha256', master, Buffer.from(address), Buffer.from('shillex sol wallet'), 32));
const aad = (ownerId: string, address: string) => Buffer.from(`${ownerId}:${address}`);

export function seal(master: Buffer, ownerId: string, kp: Keypair): string {
  const address = kp.publicKey.toBase58();
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', walletKey(master, address), iv);
  c.setAAD(aad(ownerId, address));
  const body = Buffer.concat([c.update(Buffer.from(kp.secretKey)), c.final()]);
  return [VERSION, iv.toString('base64'), c.getAuthTag().toString('base64'), body.toString('base64')].join('.');
}

export function open(master: Buffer, ownerId: string, address: string, blob: string): Keypair {
  const [v, iv, tag, body] = blob.split('.');
  if (v !== VERSION || !iv || !tag || !body) throw new Error('a sealed wallet in an unknown format');
  const d = createDecipheriv('aes-256-gcm', walletKey(master, address), Buffer.from(iv, 'base64'));
  d.setAAD(aad(ownerId, address));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  const kp = Keypair.fromSecretKey(Buffer.concat([d.update(Buffer.from(body, 'base64')), d.final()]));
  if (kp.publicKey.toBase58() !== address) throw new Error('a sealed wallet that does not match its address');
  return kp;
}

export interface SolWalletRow { ownerId: string; publicKey: string; lamports: number; checkedAt: Date | null }

/** The wallet of an agent (or of the escrow), generated on first use. */
export async function walletFor(db: Db, master: Buffer, ownerId: string, now: Date): Promise<SolWalletRow> {
  const read = async () => (await db.select({ ownerId: solWallets.ownerId, publicKey: solWallets.publicKey, lamports: solWallets.lamports, checkedAt: solWallets.checkedAt }).from(solWallets).where(eq(solWallets.ownerId, ownerId)))[0];
  const w = await read();
  if (w) return { ...w, lamports: Number(w.lamports) };
  const kp = Keypair.generate();
  await db.insert(solWallets).values({ ownerId, publicKey: kp.publicKey.toBase58(), secret: seal(master, ownerId, kp), lamports: 0, createdAt: now }).onConflictDoNothing();
  const made = (await read())!;
  return { ...made, lamports: Number(made.lamports) };
}

/** The keypair, for signing one transaction now. Never stored or passed beyond the call that signs. */
export async function signerOf(db: Db, master: Buffer, ownerId: string): Promise<Keypair> {
  const [w] = await db.select({ publicKey: solWallets.publicKey, secret: solWallets.secret }).from(solWallets).where(eq(solWallets.ownerId, ownerId));
  if (!w) throw new Error(`no SOL wallet for ${ownerId}`);
  return open(master, ownerId, w.publicKey, w.secret);
}
