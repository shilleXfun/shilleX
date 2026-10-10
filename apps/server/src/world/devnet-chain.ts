import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionExpiredBlockheightExceededError, type ParsedTransactionWithMeta } from '@solana/web3.js';
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import BN from 'bn.js';
import { DynamicBondingCurveClient, TokenDecimal, deriveDbcPoolAddress, getCurrentPoint, getPriceFromSqrtPrice } from '@meteora-ag/dynamic-bonding-curve-sdk';
import type { Config } from '../config.ts';
import type { Db } from '../db/client.ts';
import { ChainError, MemoryChain, type Chain, type CurveState, type LaunchInput, type LaunchResult, type TradeResult, type WalletBalances } from './chain.ts';
import { DBC_CONFIG, getSetting } from './launchpad.ts';

/** SOL and token change for `owner` in a confirmed transaction (fees included in the SOL change). */
export function deltasFromTx(tx: ParsedTransactionWithMeta, owner: string, mint: string | null) {
  const meta = tx.meta!;
  const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey.toBase58());
  const i = keys.indexOf(owner);
  const lamportsDelta = i >= 0 ? meta.postBalances[i]! - meta.preBalances[i]! : 0;
  const sum = (bals: typeof meta.postTokenBalances) =>
    (bals ?? []).filter((b) => b.mint === mint && b.owner === owner).reduce((n, b) => n + Number(b.uiTokenAmount.amount), 0);
  return { lamportsDelta, tokenDelta: mint ? sum(meta.postTokenBalances) - sum(meta.preTokenBalances) : 0, feeLamports: meta.fee };
}

const chainError = (e: unknown): ChainError => {
  if (e instanceof ChainError) return e;
  const msg = (e as Error)?.message ?? String(e);
  if (/insufficient (funds|lamports)/i.test(msg)) return new ChainError('INSUFFICIENT_FUNDS', msg);
  if (/slippage|ExceededSlippage|0x1771/i.test(msg)) return new ChainError('SLIPPAGE', msg);
  return new ChainError('TX_FAILED', msg.slice(0, 500));
};

export class DevnetChain implements Chain {
  readonly network = 'devnet' as const;
  private client: DynamicBondingCurveClient;
  constructor(private conn: Connection, private config: PublicKey) { this.client = DynamicBondingCurveClient.create(conn, 'confirmed'); }

  private poolOf(mint: string) {
    let m: PublicKey;
    try { m = new PublicKey(mint); } catch { throw new ChainError('UNKNOWN_MINT', `${mint} is not a mint address`); }
    return deriveDbcPoolAddress(NATIVE_MINT, m, this.config);
  }

  /**
   * Signs and sends once, keeping the signature. A confirmation timeout does not mean the transaction failed, so before
   * the one allowed resend we ask whether the first signature landed; resending blindly could spend twice.
   */
  private async send(tx: Transaction, signers: Keypair[]): Promise<string> {
    for (let attempt = 0; attempt < 2; attempt++) {
      let signature: string;
      try {
        const { blockhash, lastValidBlockHeight } = await this.conn.getLatestBlockhash('confirmed');
        tx.recentBlockhash = blockhash;
        tx.feePayer = signers[0]!.publicKey;
        tx.sign(...signers);
        signature = await this.conn.sendRawTransaction(tx.serialize(), { preflightCommitment: 'confirmed' });
        const r = await this.conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
        if (r.value.err) throw new ChainError('TX_FAILED', `Transaction failed: ${JSON.stringify(r.value.err)}`);
        return signature;
      } catch (e) {
        if (!(e instanceof TransactionExpiredBlockheightExceededError)) throw chainError(e);
        const [status] = (await this.conn.getSignatureStatuses([e.signature], { searchTransactionHistory: true })).value;
        if (status && !status.err) return e.signature;
        if (status?.err) throw new ChainError('TX_FAILED', `Transaction failed: ${JSON.stringify(status.err)}`);
      }
    }
    throw new ChainError('TX_EXPIRED', 'Transaction expired twice without landing; try again');
  }

  private async deltas(signature: string, owner: string, mint: string | null) {
    const tx = await this.conn.getParsedTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    if (!tx?.meta) return { lamportsDelta: 0, tokenDelta: 0, feeLamports: 0 };
    return deltasFromTx(tx, owner, mint);
  }

  async balances(publicKey: string): Promise<WalletBalances> {
    const owner = new PublicKey(publicKey);
    const [lamports, accts] = await Promise.all([this.conn.getBalance(owner), this.conn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID })]);
    const tokens = accts.value.map((a) => ({ mint: a.account.data.parsed.info.mint as string, raw: Number(a.account.data.parsed.info.tokenAmount.amount) })).filter((t) => t.raw > 0);
    return { lamports, tokens };
  }

  async launch(signer: Keypair, input: LaunchInput): Promise<LaunchResult> {
    const mint = Keypair.generate();
    const tx = await this.client.creator.createPoolWithFirstBuy({
      createPoolParam: { name: input.name, symbol: input.symbol, uri: input.uri, payer: signer.publicKey, poolCreator: signer.publicKey, config: this.config, baseMint: mint.publicKey },
      firstBuyParam: input.initialBuyLamports > 0
        ? { buyer: signer.publicKey, buyAmount: new BN(input.initialBuyLamports), minimumAmountOut: new BN(0), referralTokenAccount: null }
        : undefined,
    });
    const signature = await this.send(tx, [signer, mint]);
    const m = mint.publicKey.toBase58();
    return { mint: m, pool: this.poolOf(m).toBase58(), signature, ...(await this.deltas(signature, signer.publicKey.toBase58(), m)) };
  }

  private async swap(signer: Keypair, mint: string, amountIn: number, slippageBps: number, swapBaseForQuote: boolean): Promise<TradeResult> {
    const pool = this.poolOf(mint);
    const virtualPool = await this.client.state.getPool(pool);
    if (!virtualPool) throw new ChainError('UNKNOWN_MINT', `No bonding-curve pool for mint ${mint}`);
    if (Number(virtualPool.poolState.isMigrated) !== 0) throw new ChainError('GRADUATED', 'This coin graduated; its curve is closed');
    const config = (await this.client.state.getPoolConfig(virtualPool.poolState.config))!;
    const currentPoint = await getCurrentPoint(this.conn, config.activationType);
    const quote = this.client.pool.swapQuote({ virtualPool, config, swapBaseForQuote, amountIn: new BN(amountIn), slippageBps, hasReferral: false, eligibleForFirstSwapWithMinFee: false, currentPoint });
    const tx = await this.client.pool.swap({ owner: signer.publicKey, pool, amountIn: new BN(amountIn), minimumAmountOut: quote.minimumAmountOut, swapBaseForQuote, referralTokenAccount: null });
    const signature = await this.send(tx, [signer]);
    return { signature, ...(await this.deltas(signature, signer.publicKey.toBase58(), mint)) };
  }

  buy(signer: Keypair, mint: string, lamportsIn: number, slippageBps: number) { return this.swap(signer, mint, lamportsIn, slippageBps, false); }
  sell(signer: Keypair, mint: string, rawTokensIn: number, slippageBps: number) { return this.swap(signer, mint, rawTokensIn, slippageBps, true); }

  async sendSol(signer: Keypair, to: string, lamports: number) {
    let dest: PublicKey;
    try { dest = new PublicKey(to); } catch { throw new ChainError('BAD_ADDRESS', `${to} is not a Solana address`); }
    const signature = await this.send(new Transaction().add(SystemProgram.transfer({ fromPubkey: signer.publicKey, toPubkey: dest, lamports })), [signer]);
    return { signature, feeLamports: (await this.deltas(signature, signer.publicKey.toBase58(), null)).feeLamports };
  }

  async curve(mint: string): Promise<CurveState | null> {
    const pool = this.poolOf(mint);
    const vp = await this.client.state.getPool(pool);
    if (!vp) return null;
    const priceSol = Number(getPriceFromSqrtPrice(vp.poolState.sqrtPrice, TokenDecimal.SIX, 9).toString());
    return {
      mint, pool: pool.toBase58(), priceLamports: priceSol * 1e9,
      curveProgress: await this.client.state.getPoolQuoteTokenCurveProgress(pool),
      graduated: Number(vp.poolState.isMigrated) !== 0, quoteReserveLamports: Number(vp.poolState.quoteReserve.toString()),
    };
  }
}

export async function makeChain(config: Config, db: Db): Promise<Chain> {
  if (config.worldChain === 'memory') return new MemoryChain();
  const address = await getSetting(db, DBC_CONFIG);
  if (!address) throw new Error('No launchpad config yet: run `npm run world:launchpad` once (needs a funded treasury)');
  return new DevnetChain(new Connection(config.solanaRpcUrl, 'confirmed'), new PublicKey(address));
}
