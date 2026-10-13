import { Connection, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, type Keypair, type ParsedInstruction } from '@solana/web3.js';
import { MAINNET_GENESIS } from '../world/devnet-chain.ts';
import { CustodyError } from './errors.ts';

/** Solana devnet's genesis hash: rehearsal custody runs here and nowhere else. */
export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export type CustodyNetwork = 'mainnet' | 'devnet' | 'local';
export interface Transfer { from: string; to: string; lamports: number; references: string[]; feeLamports: number }

/** Everything custody asks of Solana; a FakeRpc stands in for it in tests. */
export interface CustodyRpc {
  genesisHash(): Promise<string>;
  balance(address: string): Promise<number>;
  /** Finalized, successful signatures touching `address` (a vault or a Solana Pay reference), newest first. */
  signaturesFor(address: string): Promise<string[]>;
  /** The finalized plain SOL transfer to `to` in this transaction, or null (not finalized, failed, not a transfer to `to`, or several payers). */
  transferIn(signature: string, to: string): Promise<Transfer | null>;
  send(from: Keypair, to: string, lamports: number): Promise<{ signature: string; feeLamports: number }>;
}

export function isAddress(a: string | null | undefined): a is string {
  if (!a) return false;
  try { return new PublicKey(a).toBytes().length === 32; } catch { return false; }
}

/** Before any signature: mainnet-beta for MAINNET=on, devnet for rehearsal, a local validator (neither) for tests. */
export async function assertCustodyNetwork(rpc: CustodyRpc, network: CustodyNetwork): Promise<void> {
  const g = await rpc.genesisHash();
  if (network === 'mainnet' && g !== MAINNET_GENESIS) throw new CustodyError('WRONG_NETWORK', 'MAINNET=on needs MAINNET_RPC_URL on Solana mainnet-beta');
  if (network === 'devnet' && g !== DEVNET_GENESIS) throw new CustodyError('WRONG_NETWORK', 'Rehearsal custody runs on Solana devnet only; MAINNET_RPC_URL points elsewhere');
  if (network === 'local' && (g === MAINNET_GENESIS || g === DEVNET_GENESIS)) throw new CustodyError('WRONG_NETWORK', 'Local custody needs a local validator, not devnet or mainnet');
}

export class Web3CustodyRpc implements CustodyRpc {
  constructor(private conn: Connection) {}
  genesisHash() { return this.conn.getGenesisHash(); }
  balance(address: string) { return this.conn.getBalance(new PublicKey(address), 'finalized'); }
  async signaturesFor(address: string) {
    return (await this.conn.getSignaturesForAddress(new PublicKey(address), { limit: 100 }, 'finalized')).filter((s) => !s.err).map((s) => s.signature);
  }
  async transferIn(signature: string, to: string): Promise<Transfer | null> {
    const tx = await this.conn.getParsedTransaction(signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
    if (!tx?.meta || tx.meta.err) return null;
    const transfers = tx.transaction.message.instructions
      .filter((i): i is ParsedInstruction => 'parsed' in i && i.program === 'system' && (i.parsed as { type?: string }).type === 'transfer')
      .map((i) => (i.parsed as { info: { source: string; destination: string; lamports: number } }).info)
      .filter((x) => x.destination === to);
    const payers = new Set(transfers.map((x) => x.source));
    if (!transfers.length || payers.size !== 1) return null;
    return {
      from: transfers[0]!.source, to, lamports: transfers.reduce((n, x) => n + Number(x.lamports), 0),
      references: tx.transaction.message.accountKeys.map((k) => k.pubkey.toBase58()), feeLamports: tx.meta.fee,
    };
  }
  async send(from: Keypair, to: string, lamports: number) {
    const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: new PublicKey(to), lamports }));
    const signature = await sendAndConfirmTransaction(this.conn, tx, [from], { commitment: 'finalized' });
    const parsed = await this.conn.getParsedTransaction(signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
    return { signature, feeLamports: parsed?.meta?.fee ?? 5000 };
  }
}
