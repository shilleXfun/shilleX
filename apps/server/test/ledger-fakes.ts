import type { Keypair } from '@solana/web3.js';
import { DEVNET_GENESIS, type CustodyRpc, type Transfer } from '../src/ledger/rpc.ts';

/** An in-memory chain for custody: balances, payments carrying Solana Pay references, and sends that can be made to fail. */
export class FakeRpc implements CustodyRpc {
  genesis = DEVNET_GENESIS;
  balances = new Map<string, number>();
  txs = new Map<string, Transfer>();
  order: string[] = [];
  sent: { from: string; to: string; lamports: number; signature: string }[] = [];
  failSend: Error | null = null;
  failBalance: Error | null = null;
  private n = 0;
  async genesisHash() { return this.genesis; }
  async balance(a: string) { if (this.failBalance) throw this.failBalance; return this.balances.get(a) ?? 0; }
  async signaturesFor(address: string) {
    return this.order.filter((s) => { const t = this.txs.get(s)!; return t.to === address || t.from === address || t.references.includes(address); }).reverse();
  }
  async transferIn(signature: string, to: string) { const t = this.txs.get(signature); return t && t.to === to ? t : null; }
  async send(from: Keypair, to: string, lamports: number) {
    if (this.failSend) throw this.failSend;
    const f = from.publicKey.toBase58(), signature = `send${++this.n}`;
    this.balances.set(f, (this.balances.get(f) ?? 0) - lamports - 5000);
    this.balances.set(to, (this.balances.get(to) ?? 0) + lamports);
    this.txs.set(signature, { from: f, to, lamports, references: [], feeLamports: 5000 }); this.order.push(signature);
    this.sent.push({ from: f, to, lamports, signature });
    return { signature, feeLamports: 5000 };
  }
  /** Someone's wallet pays `to`, optionally carrying a Solana Pay reference. Returns the signature. */
  pay(from: string, to: string, lamports: number, reference?: string) {
    const signature = `pay${++this.n}`;
    this.txs.set(signature, { from, to, lamports, references: reference ? [reference] : [], feeLamports: 5000 }); this.order.push(signature);
    this.balances.set(to, (this.balances.get(to) ?? 0) + lamports);
    return signature;
  }
}
