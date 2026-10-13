import type { Keypair } from '@solana/web3.js';
import { DEVNET_GENESIS, type CustodyRpc, type Inbound, type SignatureState, type Transfer } from '../src/ledger/rpc.ts';

type FakeTx = Transfer & { unclear?: boolean };

/**
 * An in-memory chain for custody: balances, payments carrying Solana Pay references, and sends that can be made to fail.
 * `now` stamps block times (pass the test clock). A failing send is signed first, as the real one is, then throws.
 */
export class FakeRpc implements CustodyRpc {
  genesis = DEVNET_GENESIS;
  balances = new Map<string, number>();
  txs = new Map<string, FakeTx>();
  order: string[] = [];
  sent: { from: string; to: string; lamports: number; signature: string }[] = [];
  /** Signatures the RPC lists but can't return yet (an unindexed node). */
  notFound = new Set<string>();
  /** Signatures whose lookup throws. */
  failInbound = new Set<string>();
  failSend: Error | null = null;
  failBalance: Error | null = null;
  private n = 0;
  constructor(private now: () => Date = () => new Date()) {}
  private blockTime() { return Math.floor(this.now().getTime() / 1000); }
  async genesisHash() { return this.genesis; }
  async balance(a: string) { if (this.failBalance) throw this.failBalance; return this.balances.get(a) ?? 0; }
  /** How many of the newest signatures the RPC lists per address (a real RPC pages its history). */
  window = Infinity;
  async signaturesFor(address: string) {
    return this.order.filter((s) => { const t = this.txs.get(s)!; return t.to === address || t.from === address || t.references.includes(address); }).reverse().slice(0, this.window);
  }
  async inbound(signature: string, to: string): Promise<Inbound> {
    if (this.failInbound.has(signature)) throw new Error(`rpc could not read ${signature}`);
    const t = this.txs.get(signature);
    if (!t || this.notFound.has(signature)) return { kind: 'not_found' };
    if (t.to !== to) return { kind: 'not_inbound' };
    if (t.unclear) return { kind: 'unclear', lamports: t.lamports, payer: t.from, feeLamports: t.feeLamports, blockTime: t.blockTime };
    const { unclear: _u, ...transfer } = t;
    return { kind: 'transfer', transfer };
  }
  async signatureStatus(signature: string): Promise<SignatureState> { return this.txs.has(signature) ? 'landed' : 'unknown'; }
  async send(from: Keypair, to: string, lamports: number, onSigned?: (signature: string) => Promise<void>) {
    const f = from.publicKey.toBase58(), signature = `send${++this.n}`;
    await onSigned?.(signature);
    if (this.failSend) throw this.failSend;
    this.balances.set(f, (this.balances.get(f) ?? 0) - lamports - 5000);
    this.balances.set(to, (this.balances.get(to) ?? 0) + lamports);
    this.txs.set(signature, { from: f, to, lamports, references: [], feeLamports: 5000, blockTime: this.blockTime() }); this.order.push(signature);
    this.sent.push({ from: f, to, lamports, signature });
    return { signature, feeLamports: 5000 };
  }
  /** Someone's wallet pays `to`, optionally carrying a Solana Pay reference. `unclear` makes it arrive as more than one plain transfer. */
  pay(from: string, to: string, lamports: number, reference?: string, o: { unclear?: boolean } = {}) {
    const signature = `pay${++this.n}`;
    this.txs.set(signature, { from, to, lamports, references: reference ? [reference] : [], feeLamports: 5000, blockTime: this.blockTime(), unclear: o.unclear }); this.order.push(signature);
    this.balances.set(to, (this.balances.get(to) ?? 0) + lamports);
    return signature;
  }
}
