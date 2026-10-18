import { Connection, PublicKey, SystemProgram, Transaction, type Keypair, type ParsedInstruction } from '@solana/web3.js';
import bs58 from 'bs58';
import { MAINNET_GENESIS } from '../world/devnet-chain.ts';
import { CustodyError } from './errors.ts';

/** Solana devnet's genesis hash: rehearsal custody runs here and nowhere else. */
export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export type CustodyNetwork = 'mainnet' | 'devnet' | 'local';
export interface Transfer {
  from: string; to: string; lamports: number; references: string[]; feeLamports: number;
  /** Unix seconds of the block, when the RPC knows it: lateness is judged by this, not by when the poller ran. */
  blockTime: number | null;
}
/**
 * What one transaction did for `to`. `not_found`: the RPC can't return it yet (try again later, never mark it handled).
 * `unclear`: SOL arrived, but not as one plain transfer from one payer (several payers, an inner instruction): an admin decides.
 */
export type Inbound =
  | { kind: 'transfer'; transfer: Transfer }
  | { kind: 'not_found' }
  | { kind: 'not_inbound' }
  | { kind: 'unclear'; lamports: number; payer: string | null; feeLamports: number; blockTime: number | null };
export type SignatureState = 'landed' | 'failed' | 'unknown';

/** Everything custody asks of Solana; a FakeRpc stands in for it in tests. */
export interface CustodyRpc {
  genesisHash(): Promise<string>;
  balance(address: string): Promise<number>;
  /** Finalized, successful signatures touching `address` (a vault or a Solana Pay reference), newest first. */
  signaturesFor(address: string): Promise<string[]>;
  inbound(signature: string, to: string): Promise<Inbound>;
  /** 'landed' once finalized, 'failed' if it errored on-chain, 'unknown' when the cluster has no record (yet). */
  signatureStatus(signature: string): Promise<SignatureState>;
  /**
   * Signs a transfer, hands its signature to `onSigned` (custody stores it) and only then broadcasts it, so every send that
   * might have landed has a signature to check it by.
   */
  send(from: Keypair, to: string, lamports: number, onSigned?: (signature: string) => Promise<void>): Promise<{ signature: string; feeLamports: number }>;
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

/** Pages of signature history read per poll: the newest 5,000, so a burst of dust can't push a real payment out of view. */
const PAGE = 1000, PAGES = 5;

export class Web3CustodyRpc implements CustodyRpc {
  private genesis: Promise<string> | null = null;
  constructor(private conn: Connection) {}
  /** Asked once per connection (a network's genesis never changes); a failed ask is asked again next time. */
  genesisHash() {
    this.genesis ??= this.conn.getGenesisHash().catch((e) => { this.genesis = null; throw e; });
    return this.genesis;
  }
  balance(address: string) { return this.conn.getBalance(new PublicKey(address), 'finalized'); }
  async signaturesFor(address: string) {
    const out: string[] = [];
    let before: string | undefined;
    for (let i = 0; i < PAGES; i++) {
      const page = await this.conn.getSignaturesForAddress(new PublicKey(address), { limit: PAGE, before }, 'finalized');
      out.push(...page.filter((s) => !s.err).map((s) => s.signature));
      if (page.length < PAGE) break;
      before = page.at(-1)!.signature;
    }
    return out;
  }
  async inbound(signature: string, to: string): Promise<Inbound> {
    const tx = await this.conn.getParsedTransaction(signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
    if (!tx) return { kind: 'not_found' };
    if (!tx.meta || tx.meta.err) return { kind: 'not_inbound' };
    const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey.toBase58());
    const i = keys.indexOf(to);
    const arrived = i >= 0 ? (tx.meta.postBalances[i] ?? 0) - (tx.meta.preBalances[i] ?? 0) : 0;
    if (arrived <= 0) return { kind: 'not_inbound' };
    const blockTime = tx.blockTime ?? null;
    const transfers = tx.transaction.message.instructions
      .filter((x): x is ParsedInstruction => 'parsed' in x && x.program === 'system' && (x.parsed as { type?: string }).type === 'transfer')
      .map((x) => (x.parsed as { info: { source: string; destination: string; lamports: number } }).info)
      .filter((x) => x.destination === to);
    const payers = new Set(transfers.map((x) => x.source)), sum = transfers.reduce((n, x) => n + Number(x.lamports), 0);
    if (transfers.length && payers.size === 1 && sum === arrived) {
      return { kind: 'transfer', transfer: { from: transfers[0]!.source, to, lamports: sum, references: keys, feeLamports: tx.meta.fee, blockTime } };
    }
    return { kind: 'unclear', lamports: arrived, payer: keys[0] ?? null, feeLamports: tx.meta.fee, blockTime };
  }
  async signatureStatus(signature: string): Promise<SignatureState> {
    const s = (await this.conn.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
    if (!s) return 'unknown';
    if (s.err) return 'failed';
    return s.confirmationStatus === 'finalized' ? 'landed' : 'unknown';
  }
  async send(from: Keypair, to: string, lamports: number, onSigned?: (signature: string) => Promise<void>) {
    const { blockhash, lastValidBlockHeight } = await this.conn.getLatestBlockhash('finalized');
    const tx = new Transaction({ feePayer: from.publicKey, blockhash, lastValidBlockHeight })
      .add(SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: new PublicKey(to), lamports }));
    tx.sign(from);
    const signature = bs58.encode(tx.signature!);
    await onSigned?.(signature);
    await this.conn.sendRawTransaction(tx.serialize(), { preflightCommitment: 'finalized' });
    const r = await this.conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'finalized');
    if (r.value.err) throw new Error(`the transfer failed on-chain: ${JSON.stringify(r.value.err)}`);
    const parsed = await this.conn.getParsedTransaction(signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
    return { signature, feeLamports: parsed?.meta?.fee ?? 5000 };
  }
}
