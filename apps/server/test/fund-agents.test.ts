import { describe, it, expect } from 'vitest';
import { Keypair, SystemInstruction, SystemProgram, Transaction } from '@solana/web3.js';
import { FUND_PER_TX, fundingTransactions } from '../src/world/sol-net.ts';

/** The owner funds house agents from its own wallet (2026-10-29): unsigned transfers its wallet signs, 18 to a transaction. */
describe('funding transactions', () => {
  it('pays every agent the same amount from the owner, unsigned, in transactions that fit', () => {
    const owner = Keypair.generate().publicKey.toBase58();
    const agents = Array.from({ length: 20 }, () => Keypair.generate().publicKey.toBase58());
    const txs = fundingTransactions(owner, agents, 20_000_000, Keypair.generate().publicKey.toBase58());
    expect(txs).toHaveLength(2);
    const decoded = txs.map((b) => Transaction.from(Buffer.from(b, 'base64')));
    expect(decoded.map((t) => t.instructions.length)).toEqual([FUND_PER_TX, 20 - FUND_PER_TX]);
    for (const t of decoded) {
      expect(t.feePayer?.toBase58()).toBe(owner);
      expect(t.signatures.every((x) => x.signature === null)).toBe(true);
      expect(Buffer.from(t.serialize({ requireAllSignatures: false })).length).toBeLessThanOrEqual(1232);
    }
    const paid = decoded.flatMap((t) => t.instructions.map((ix) => (expect(ix.programId.equals(SystemProgram.programId)).toBe(true), SystemInstruction.decodeTransfer(ix))));
    expect(paid.map((p) => p.toPubkey.toBase58())).toEqual(agents);
    expect(paid.every((p) => p.fromPubkey.toBase58() === owner && p.lamports === 20_000_000n)).toBe(true);
  });
});
