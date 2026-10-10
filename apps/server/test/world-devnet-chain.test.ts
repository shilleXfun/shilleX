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
