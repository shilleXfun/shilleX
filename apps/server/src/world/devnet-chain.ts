import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, TransactionExpiredBlockheightExceededError, type ParsedTransactionWithMeta } from '@solana/web3.js';
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import BN from 'bn.js';
import { DynamicBondingCurveClient, SwapMode, TokenDecimal, deriveDbcPoolAddress, getCurrentPoint, getPriceFromSqrtPrice } from '@meteora-ag/dynamic-bonding-curve-sdk';
import type { Config } from '../config.ts';
import type { Db } from '../db/client.ts';
import { CLAIM_MIN_LAMPORTS, ChainError, GRADUATED_MESSAGE, MemoryChain, type Chain, type CurveState, type LaunchInput, type LaunchResult, type TradeResult, type WalletBalances } from './chain.ts';
import { DBC_CONFIG, getSetting } from './launchpad.ts';
import { LedgerChain } from '../ledger/ledger-chain.ts';
import { rulesFromConfig } from '../ledger/rules.ts';

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

const sol = (lamports: string) => Number(lamports) / LAMPORTS_PER_SOL;

/** Turns RPC and program failures into short messages an agent can act on; simulation log dumps never reach the agent. */
export const toChainError = (e: unknown): ChainError => {
  if (e instanceof ChainError) return e;
  const msg = (e as Error)?.message ?? String(e);
  const lamports = /insufficient lamports (\d+), need (\d+)/.exec(msg);
  if (lamports) return new ChainError('INSUFFICIENT_FUNDS', `Not enough SOL: the wallet has ${sol(lamports[1]!)} SOL and this needs ${sol(lamports[2]!)} SOL plus fees`);
  if (/no record of a prior credit/i.test(msg)) return new ChainError('INSUFFICIENT_FUNDS', 'Not enough SOL to pay the transaction fee');
  if (/insufficient funds for rent/i.test(msg)) return new ChainError('INSUFFICIENT_FUNDS', 'Not enough SOL: this would leave the wallet below the rent minimum');
  if (/Program log: Error: insufficient funds/i.test(msg)) return new ChainError('INSUFFICIENT_TOKENS', 'Not enough tokens: the wallet holds fewer than this sale needs');
  // The program's error names, and since SDK 2.0 the program's own messages for the same errors.
  if (/PoolIsCompleted|Pool is completed/i.test(msg)) return new ChainError('GRADUATED', GRADUATED_MESSAGE);
  if (/ExceededSlippage|slippage/i.test(msg)) return new ChainError('SLIPPAGE', 'The price moved past your slippage limit; nothing was traded');
  if (/Insufficient Liquidity|InsufficientLiquidity|Liquidity in bonding curve is insufficient|Required input amount exceeds the provided amount in/i.test(msg)) return new ChainError('CURVE_FULL', 'The curve cannot fill this trade; try a smaller amount');
  const anchor = /Error Message: (.+?)["\n]/.exec(msg)?.[1];
  const first = msg.replace(/^Simulation failed\.\s*/, '').split(/\n|\. ?Logs:/)[0]!.replace(/^Message: /, '').trim();
  return new ChainError('TX_FAILED', `Transaction failed: ${(anchor ?? first).slice(0, 300)}`);
};

/** Solana mainnet-beta's genesis hash. The agents' chain is devnet or a local validator, never this one. */
export const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';

/** A wallet read is kept this long: balances move through this chain's own transactions, and those expire the read at once. */
const BALANCE_TTL_MS = 15 * 60_000;
/** While the RPC is out it is asked again at most this often, so turns do not each wait out its retries. */
const RETRY_MS = 60_000;
/**
 * Fresh wallet reads start at most this often (each is two RPC requests). The free public devnet RPC allows about ten requests a
 * second per IP; a boot that read all 100 wallets at once drew a storm of 429s (2026-10-25). Paced, a cold start warms in ~40 s.
 */
export const READ_GAP_MS = 400;
/** Reads waiting beyond this many are not queued: the caller gets the stale value or an RPC_BUSY error at once. */
const READ_QUEUE_MAX = 150;

export class DevnetChain implements Chain {
  readonly network = 'devnet' as const;
  private client: DynamicBondingCurveClient;
  private networkChecked = false;
  private reads = new Map<string, { at: number; b: WalletBalances }>();
  private failedAt = 0;
  private nextReadAt = 0;
  private queued = 0;
  /** Waits for this read's slot in the pace (READ_GAP_MS apart); false when too many are already waiting. */
  private async slot(): Promise<boolean> {
    if (this.queued >= READ_QUEUE_MAX) return false;
    const t = Date.now(), at = Math.max(t, this.nextReadAt);
    this.nextReadAt = at + READ_GAP_MS;
    this.queued++;
    try { if (at > t) await new Promise((r) => setTimeout(r, at - t)); } finally { this.queued--; }
    return true;
  }
  /** From a failed wallet read until one succeeds (an RPC out of credits): trades could not land, so the engine keeps agents to talk. */
  get down() { return this.failedAt > 0; }
  /** The next read asks the RPC again; the old value stays as the stand-in if it cannot answer. */
  private expire(publicKey: string) { const r = this.reads.get(publicKey); if (r) r.at = 0; }
  /**
   * Fails with WRONG_NETWORK if the RPC serves mainnet-beta (a mainnet URL pasted into DEVNET_RPC_URL). Asked once; an RPC
   * that could not answer is asked again before the next transaction, so nothing is ever signed for an unchecked network.
   */
  async assertNotMainnet(timeoutMs = 10_000) {
    if (this.networkChecked) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A hanging RPC must not stall boot: a timeout counts as "could not answer", like a network error.
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`no genesis hash within ${timeoutMs} ms`)), timeoutMs); });
    const genesis = await Promise.race([this.conn.getGenesisHash(), timeout]).finally(() => clearTimeout(timer));
    if (genesis === MAINNET_GENESIS) throw new ChainError('WRONG_NETWORK', 'DEVNET_RPC_URL points at Solana mainnet-beta; the agents only use devnet or a local validator');
    this.networkChecked = true;
  }
  /** `config` is null until the launchpad exists (a fresh deploy with an unfunded treasury); coin actions then fail with NO_LAUNCHPAD. */
  constructor(readonly conn: Connection, private config: PublicKey | null) { this.client = new DynamicBondingCurveClient(conn, 'confirmed'); }
  get hasLaunchpad() { return this.config !== null; }
  setLaunchpad(address: string) { this.config = new PublicKey(address); }
  private launchpad(): PublicKey {
    if (!this.config) throw new ChainError('NO_LAUNCHPAD', 'Coins are not open yet: the launchpad has not been set up');
    return this.config;
  }

  private poolOf(mint: string) {
    let m: PublicKey;
    try { m = new PublicKey(mint); } catch { throw new ChainError('UNKNOWN_MINT', `${mint} is not a mint address`); }
    return deriveDbcPoolAddress(NATIVE_MINT, m, this.launchpad());
  }

  /**
   * Signs and sends once, keeping the signature. A confirmation timeout does not mean the transaction failed, so before
   * the one allowed resend we ask whether the first signature landed; resending blindly could spend twice.
   */
  private async send(tx: Transaction, signers: Keypair[]): Promise<string> {
    try { await this.assertNotMainnet(); } catch (e) { throw toChainError(e); }
    // Landed or not, the signers' wallets are read fresh next time: a transaction or its fee may have moved them.
    try { return await this.sendOnce(tx, signers); }
    finally { for (const s of signers) this.expire(s.publicKey.toBase58()); }
  }

  private async sendOnce(tx: Transaction, signers: Keypair[]): Promise<string> {
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
        if (!(e instanceof TransactionExpiredBlockheightExceededError)) throw toChainError(e);
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

  /** Kept per wallet (BALANCE_TTL_MS); when the RPC cannot answer, the last read stands in, and with none the read fails. */
  async balances(publicKey: string): Promise<WalletBalances> {
    const owner = new PublicKey(publicKey);
    const hit = this.reads.get(publicKey), t = Date.now();
    if (hit && t - hit.at < BALANCE_TTL_MS) return hit.b;
    if (this.down && t - this.failedAt < RETRY_MS) {
      if (hit) return hit.b;
      throw new ChainError('RPC_DOWN', 'The Solana RPC is not answering; trades wait until it does');
    }
    if (!(await this.slot())) {
      if (hit) return hit.b;
      throw new ChainError('RPC_BUSY', 'Too many wallet reads are waiting for the RPC; try again shortly');
    }
    // Another caller may have read this wallet while this one waited.
    const fresh = this.reads.get(publicKey);
    if (fresh && Date.now() - fresh.at < BALANCE_TTL_MS) return fresh.b;
    try {
      const [lamports, accts] = await Promise.all([this.conn.getBalance(owner), this.conn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID })]);
      const tokens = accts.value.map((a) => ({ mint: a.account.data.parsed.info.mint as string, raw: Number(a.account.data.parsed.info.tokenAmount.amount) })).filter((x) => x.raw > 0);
      const b = { lamports, tokens };
      this.reads.set(publicKey, { at: Date.now(), b });
      this.failedAt = 0;
      return b;
    } catch (e) {
      this.failedAt = Date.now();
      if (hit) return hit.b;
      throw e;
    }
  }

  async launch(signer: Keypair, input: LaunchInput): Promise<LaunchResult> {
    const mint = Keypair.generate();
    const tx = await this.client.creator.createPoolWithFirstBuy({
      createPoolParam: { name: input.name, symbol: input.symbol, uri: input.uri, payer: signer.publicKey, poolCreator: signer.publicKey, config: this.launchpad(), baseMint: mint.publicKey },
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
    const config = (await this.client.state.getPoolConfig(virtualPool.poolState.config))!;
    // A curve that reached its threshold refuses swaps until it migrates, so it counts as graduated already.
    if (Number(virtualPool.poolState.isMigrated) !== 0 || virtualPool.poolState.quoteReserve.gte(config.migrationQuoteThreshold)) throw new ChainError('GRADUATED', GRADUATED_MESSAGE);
    const currentPoint = await getCurrentPoint(this.conn, config.activationType);
    // Buys fill partially: the buy that completes a curve takes what is left and gets the rest back, instead of failing.
    const swapMode = swapBaseForQuote ? SwapMode.ExactIn : SwapMode.PartialFill;
    let minimumAmountOut: BN;
    try {
      minimumAmountOut = this.client.pool.swapQuote2({ virtualPool, config, swapBaseForQuote, swapMode, amountIn: new BN(amountIn), slippageBps, hasReferral: false, eligibleForFirstSwapWithMinFee: false, currentPoint }).minimumAmountOut!;
    } catch (e) { throw toChainError(e); }
    const tx = await this.client.pool.swap2({ owner: signer.publicKey, pool, swapBaseForQuote, swapMode, amountIn: new BN(amountIn), minimumAmountOut, referralTokenAccount: null });
    const signature = await this.send(tx, [signer]);
    return { signature, ...(await this.deltas(signature, signer.publicKey.toBase58(), mint)) };
  }

  buy(signer: Keypair, mint: string, lamportsIn: number, slippageBps: number) { return this.swap(signer, mint, lamportsIn, slippageBps, false); }
  sell(signer: Keypair, mint: string, rawTokensIn: number, slippageBps: number) { return this.swap(signer, mint, rawTokensIn, slippageBps, true); }

  /** The creator's unclaimed half of the pool's SOL trading fees (the launchpad collects fees in the quote token), paid to its wallet. */
  async claimCreatorFees(signer: Keypair, mint: string): Promise<TradeResult | null> {
    const pool = this.poolOf(mint);
    let due: BN;
    try { due = (await this.client.state.getPoolFeeMetrics(pool)).current.creatorQuoteFee; } catch (e) { throw toChainError(e); }
    if (due.ltn(CLAIM_MIN_LAMPORTS)) return null;
    const tx = await this.client.creator.claimCreatorTradingFee({ creator: signer.publicKey, payer: signer.publicKey, pool, maxBaseAmount: new BN(0), maxQuoteAmount: due });
    const signature = await this.send(tx, [signer]);
    return { signature, ...(await this.deltas(signature, signer.publicKey.toBase58(), null)) };
  }

  async sendSol(signer: Keypair, to: string, lamports: number) {
    let dest: PublicKey;
    try { dest = new PublicKey(to); } catch { throw new ChainError('BAD_ADDRESS', `${to} is not a Solana address`); }
    const signature = await this.send(new Transaction().add(SystemProgram.transfer({ fromPubkey: signer.publicKey, toPubkey: dest, lamports })), [signer]);
    this.expire(dest.toBase58());
    return { signature, feeLamports: (await this.deltas(signature, signer.publicKey.toBase58(), null)).feeLamports };
  }

  async curve(mint: string): Promise<CurveState | null> {
    const pool = this.poolOf(mint);
    const vp = await this.client.state.getPool(pool);
    if (!vp) return null;
    const priceSol = Number(getPriceFromSqrtPrice(vp.poolState.sqrtPrice, TokenDecimal.SIX, 9).toString());
    const curveProgress = await this.client.state.getPoolQuoteTokenCurveProgress(pool);
    return {
      mint, pool: pool.toBase58(), priceLamports: priceSol * 1e9, curveProgress,
      graduated: Number(vp.poolState.isMigrated) !== 0 || curveProgress >= 1, quoteReserveLamports: Number(vp.poolState.quoteReserve.toString()),
    };
  }
}

/**
 * The agents' chain. A devnet chain refuses to start against mainnet-beta's genesis. If the RPC cannot be reached at boot
 * the world still starts (agents wait out an RPC outage as before), and the check runs again before the first transaction.
 */
/** web3.js's own retry on a 429 waits and re-sends in a loop; off, so a rate-limited read falls back to the cached value at once. */
const defaultConnect = (url: string) => new Connection(url, { commitment: 'confirmed', disableRetryOnRateLimit: true });
export async function makeChain(config: Config, db: Db, connect = defaultConnect, now: () => Date = () => new Date()): Promise<Chain> {
  if (config.worldChain === 'memory') return new MemoryChain();
  // Shillex's own books (mainnet spec Â§2): no RPC at all, and so nothing to check the network of.
  if (config.worldChain === 'ledger') return new LedgerChain(db, now, rulesFromConfig(config));
  const address = await getSetting(db, DBC_CONFIG);
  const chain = new DevnetChain(connect(config.devnetRpcUrl), address ? new PublicKey(address) : null);
  try { await chain.assertNotMainnet(); }
  catch (e) {
    if (e instanceof ChainError) throw e; // mainnet: refuse to start
    console.warn(`[world] could not read the RPC's genesis hash (${(e as Error).message}); it is checked again before the first transaction`);
  }
  return chain;
}
