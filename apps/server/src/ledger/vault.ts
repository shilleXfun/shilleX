import { Keypair } from '@solana/web3.js';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { ledgerVault } from '../db/schema.ts';
import { decryptSecret, encryptSecret } from '../world/wallets.ts';
import type { CustodyNetwork } from './rpc.ts';

export function parseMainnetKey(b64: string | undefined): Buffer {
  const k = Buffer.from(b64 ?? '', 'base64');
  if (k.length !== 32) throw new Error('MAINNET_KEY must be 32 bytes, base64-encoded, and different from WORLD_KEY');
  return k;
}

/** The hot vault for a custody network: the only signing key custody holds (spec §4). Created on first use, encrypted with MAINNET_KEY. */
export async function hotVault(db: Db, key: Buffer, network: CustodyNetwork, now: Date): Promise<{ publicKey: string; signer(): Keypair }> {
  const id = `hot:${network}`;
  let [row] = await db.select().from(ledgerVault).where(eq(ledgerVault.id, id));
  if (!row) {
    const kp = Keypair.generate();
    await db.insert(ledgerVault).values({ id, publicKey: kp.publicKey.toBase58(), encryptedSecret: encryptSecret(kp.secretKey, key), createdAt: now }).onConflictDoNothing();
    [row] = await db.select().from(ledgerVault).where(eq(ledgerVault.id, id));
  }
  const r = row!;
  return { publicKey: r.publicKey, signer: () => Keypair.fromSecretKey(decryptSecret(r.encryptedSecret, key)) };
}
