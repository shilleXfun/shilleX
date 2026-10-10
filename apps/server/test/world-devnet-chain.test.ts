import { describe, it, expect } from 'vitest';
import type { ParsedTransactionWithMeta } from '@solana/web3.js';
import { deltasFromTx } from '../src/world/devnet-chain.ts';

const OWNER = 'Owner1111111111111111111111111111111111111';
const tx = {
  meta: {
    fee: 5000,
    preBalances: [100_000_000, 0], postBalances: [89_990_000, 0],
    preTokenBalances: [], postTokenBalances: [{ accountIndex: 1, mint: 'MintA', owner: OWNER, uiTokenAmount: { amount: '123456789', decimals: 6 } }],
  },
  transaction: { message: { accountKeys: [{ pubkey: { toBase58: () => OWNER } }, { pubkey: { toBase58: () => 'Ata' } }] } },
} as unknown as ParsedTransactionWithMeta;

describe('deltasFromTx', () => {
  it('reads the owner’s SOL change (fees included) and token change from transaction meta', () => {
    expect(deltasFromTx(tx, OWNER, 'MintA')).toEqual({ lamportsDelta: -10_010_000, tokenDelta: 123_456_789, feeLamports: 5000 });
  });
  it('reports zero token change when no mint is involved', () => {
    expect(deltasFromTx(tx, OWNER, null).tokenDelta).toBe(0);
  });
});

import { Keypair, PublicKey, TransactionExpiredBlockheightExceededError, type Connection } from '@solana/web3.js';
import { DevnetChain } from '../src/world/devnet-chain.ts';

/** Fake RPC: the first confirmation times out although the transaction landed. */
function fakeConnection(landed: boolean) {
  const sent: string[] = [];
  let confirms = 0;
  const conn = {
    getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100 }),
    sendRawTransaction: async () => { const sig = `sig${sent.length + 1}`; sent.push(sig); return sig; },
    confirmTransaction: async (s: { signature: string }) => { if (confirms++ === 0) throw new TransactionExpiredBlockheightExceededError(s.signature); return { value: { err: null } }; },
    getSignatureStatuses: async () => ({ value: [landed ? { confirmationStatus: 'confirmed', err: null } : null] }),
    getParsedTransaction: async () => null,
  } as unknown as Connection;
  return { conn, sent };
}

describe('DevnetChain sending (review fix)', () => {
  it('does not resend a transaction that landed after its confirmation timed out', async () => {
    const { conn, sent } = fakeConnection(true);
    const chain = new DevnetChain(conn, new PublicKey(Keypair.generate().publicKey));
    const r = await chain.sendSol(Keypair.generate(), Keypair.generate().publicKey.toBase58(), 1000);
    expect(sent).toEqual(['sig1']);
    expect(r.signature).toBe('sig1');
  });
  it('resends once when the expired transaction never landed', async () => {
    const { conn, sent } = fakeConnection(false);
    const chain = new DevnetChain(conn, new PublicKey(Keypair.generate().publicKey));
    const r = await chain.sendSol(Keypair.generate(), Keypair.generate().publicKey.toBase58(), 1000);
    expect(sent).toEqual(['sig1', 'sig2']);
    expect(r.signature).toBe('sig2');
  });
});
