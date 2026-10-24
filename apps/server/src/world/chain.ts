import type { Keypair } from '@solana/web3.js';

export interface LaunchInput { name: string; symbol: string; uri: string; initialBuyLamports: number }
export interface TradeResult { signature: string; lamportsDelta: number; tokenDelta: number; feeLamports: number }
export interface LaunchResult extends TradeResult { mint: string; pool: string }
export interface CurveState { mint: string; pool: string; priceLamports: number; curveProgress: number; graduated: boolean; quoteReserveLamports: number }
export interface WalletBalances { lamports: number; tokens: { mint: string; raw: number; /** Ledger only: a creator's launch buy still vesting (mainnet spec §3). */ lockedRaw?: number }[] }
/** What a chain allows, for the engine to decide within (mainnet spec §3). Devnet and memory chains have none. */
export interface ChainLimits { launchCostLamports: number; rugMinShare: number; maxCreatorSaleShare: number; maxTradeLamports: number; maxSendLamports: number; frozen: boolean }
export interface Chain {
  readonly network: 'devnet' | 'memory' | 'ledger';
  readonly limits?: ChainLimits;
  /** The chain cannot be read right now (devnet's RPC is out): nothing would land, so agents only talk. */
  readonly down?: boolean;
  balances(publicKey: string): Promise<WalletBalances>;
  launch(signer: Keypair, input: LaunchInput): Promise<LaunchResult>;
  buy(signer: Keypair, mint: string, lamportsIn: number, slippageBps: number): Promise<TradeResult>;
  sell(signer: Keypair, mint: string, rawTokensIn: number, slippageBps: number): Promise<TradeResult>;
  sendSol(signer: Keypair, to: string, lamports: number): Promise<{ signature: string; feeLamports: number }>;
  curve(mint: string): Promise<CurveState | null>;
  /** Collects the creator's share of a coin's trading fees into its wallet; null when there is too little to be worth a transaction. */
  claimCreatorFees?(signer: Keypair, mint: string): Promise<TradeResult | null>;
}

export class ChainError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export const RAW_PER_TOKEN = 1_000_000;
export const GRADUATED_MESSAGE = 'This coin graduated: its curve is complete and it can no longer be traded here';
const SOL = 1_000_000_000;
const TX_FEE = 5000;
export const LAUNCH_RENT = 26_500_000; // rent + creation, as measured against the real program on a local validator
const TRADE_FEE_BPS = 100;
// Scaled to a 5 SOL economy (50 wallets × 0.1 SOL) so a few agents can visibly pump or rug a coin; tuned to match the devnet launchpad.
const V_SOL = 1 * SOL, V_TOKENS = 1_073_000_000 * RAW_PER_TOKEN, CURVE_TOKENS = 793_100_000 * RAW_PER_TOKEN, GRADUATE_AT = 2_688_110_852; // the launchpad config's migration quote threshold
/** The curve's constants, shared with the ledger's copy of this curve (ledger/curve.ts) so the two always match. */
export const CURVE = { V_SOL, V_TOKENS, CURVE_TOKENS, GRADUATE_AT, TRADE_FEE_BPS } as const;

interface Pool { mint: string; pool: string; sol: number; sold: number; graduated: boolean; creator?: string; creatorFee?: number }
/** Half of every trade's fee is the creator's (the launchpad's creatorTradingFeePercentage); a claim below this is not worth a transaction. */
export const CREATOR_FEE_SHARE = 0.5, CLAIM_MIN_LAMPORTS = 1_000_000;
interface Account { lamports: number; tokens: Map<string, number> }

/** A pump-style constant-product curve in memory: same interface as DevnetChain, for tests and the local fixture. */
export class MemoryChain implements Chain {
  readonly network = 'memory' as const;
  private accounts = new Map<string, Account>();
  private pools = new Map<string, Pool>();
  private n = 0;

  airdrop(publicKey: string, lamports: number) { this.acct(publicKey).lamports += lamports; }
  private acct(pk: string) { let a = this.accounts.get(pk); if (!a) { a = { lamports: 0, tokens: new Map() }; this.accounts.set(pk, a); } return a; }
  private sig() { return `mem${++this.n}`.padEnd(64, 'x'); }
  private need(a: Account, lamports: number) {
    if (a.lamports < lamports) throw new ChainError('INSUFFICIENT_FUNDS', `Not enough SOL: the wallet has ${a.lamports / SOL} SOL and this needs ${lamports / SOL} SOL`);
  }
  private spend(a: Account, lamports: number) { this.need(a, lamports); a.lamports -= lamports; }
  private pool(mint: string) {
    const p = this.pools.get(mint);
    if (!p) throw new ChainError('UNKNOWN_MINT', `No bonding-curve pool for mint ${mint}`);
    if (p.graduated) throw new ChainError('GRADUATED', GRADUATED_MESSAGE);
    return p;
  }
  private price(p: Pool) { return ((V_SOL + p.sol) / (V_TOKENS - p.sold)) * RAW_PER_TOKEN; }

  /**
   * Rebuilds the chain from what the database remembers (local and e2e use: an API restart empties this chain, the database keeps the coins and trades).
   * A pool's SOL reserve follows from how many tokens it has sold, on the same constant-product curve the swaps use.
   * `signatures` is how many signatures were already handed out, so new signatures and mints never repeat old ones.
   */
  restore(state: {
    pools: { mint: string; pool: string; sold: number; graduated: boolean }[];
    accounts: { publicKey: string; lamports: number; tokens: { mint: string; raw: number }[] }[];
    signatures: number;
  }) {
    this.pools = new Map(state.pools.map((p) => {
      const sold = Math.min(Math.max(p.sold, 0), CURVE_TOKENS);
      const sol = Math.min(Math.max(Math.round((V_SOL * V_TOKENS) / (V_TOKENS - sold)) - V_SOL, 0), GRADUATE_AT);
      return [p.mint, { mint: p.mint, pool: p.pool, sol, sold, graduated: p.graduated }];
    }));
    this.accounts = new Map(state.accounts.map((a) => [a.publicKey, { lamports: a.lamports, tokens: new Map(a.tokens.map((t) => [t.mint, t.raw])) }]));
    this.n = state.signatures;
  }

  async balances(publicKey: string): Promise<WalletBalances> {
    const a = this.acct(publicKey);
    return { lamports: a.lamports, tokens: [...a.tokens].filter(([, raw]) => raw > 0).map(([mint, raw]) => ({ mint, raw })) };
  }

  async launch(signer: Keypair, input: LaunchInput): Promise<LaunchResult> {
    const a = this.acct(signer.publicKey.toBase58());
    this.need(a, LAUNCH_RENT + TX_FEE + input.initialBuyLamports);
    this.spend(a, LAUNCH_RENT + TX_FEE);
    const mint = `M${this.n + 1}${input.symbol}`.padEnd(44, '1').slice(0, 44);
    this.pools.set(mint, { mint, pool: `P${mint.slice(1)}`, sol: 0, sold: 0, graduated: false, creator: signer.publicKey.toBase58(), creatorFee: 0 });
    const signature = this.sig();
    const first = input.initialBuyLamports > 0 ? this.swapIn(a, this.pools.get(mint)!, input.initialBuyLamports) : { out: 0, spent: 0 };
    return { mint, pool: this.pools.get(mint)!.pool, signature, lamportsDelta: -(LAUNCH_RENT + TX_FEE + first.spent), tokenDelta: first.out, feeLamports: TX_FEE };
  }

  /** Partial fill, like the real program: a buy past the threshold takes only what completes the curve. */
  private swapIn(a: Account, p: Pool, lamportsIn: number): { out: number; spent: number } {
    const keep = 1 - TRADE_FEE_BPS / 10_000;
    const spent = Math.min(lamportsIn, Math.ceil((GRADUATE_AT - p.sol) / keep));
    this.spend(a, spent);
    const net = Math.min(Math.floor(spent * keep), GRADUATE_AT - p.sol);
    const k = (V_SOL + p.sol) * (V_TOKENS - p.sold);
    const out = Math.min(Math.floor(V_TOKENS - p.sold - k / (V_SOL + p.sol + net)), CURVE_TOKENS - p.sold);
    p.sol += net; p.sold += out;
    p.creatorFee = (p.creatorFee ?? 0) + Math.floor((spent - Math.floor(spent * keep)) * CREATOR_FEE_SHARE);
    if (p.sol >= GRADUATE_AT || p.sold >= CURVE_TOKENS) p.graduated = true;
    a.tokens.set(p.mint, (a.tokens.get(p.mint) ?? 0) + out);
    return { out, spent };
  }

  async buy(signer: Keypair, mint: string, lamportsIn: number, _slippageBps?: number): Promise<TradeResult> {
    const p = this.pool(mint), a = this.acct(signer.publicKey.toBase58());
    this.need(a, TX_FEE + lamportsIn);
    this.spend(a, TX_FEE);
    const { out, spent } = this.swapIn(a, p, lamportsIn);
    return { signature: this.sig(), lamportsDelta: -(spent + TX_FEE), tokenDelta: out, feeLamports: TX_FEE };
  }

  async sell(signer: Keypair, mint: string, rawTokensIn: number, _slippageBps?: number): Promise<TradeResult> {
    const p = this.pool(mint), a = this.acct(signer.publicKey.toBase58());
    const held = a.tokens.get(mint) ?? 0;
    if (held < rawTokensIn || rawTokensIn <= 0) throw new ChainError('INSUFFICIENT_TOKENS', `Holds ${held} raw units, tried to sell ${rawTokensIn}`);
    this.spend(a, TX_FEE);
    const k = (V_SOL + p.sol) * (V_TOKENS - p.sold);
    const gross = Math.floor(V_SOL + p.sol - k / (V_TOKENS - p.sold + rawTokensIn));
    const out = Math.floor(gross * (1 - TRADE_FEE_BPS / 10_000));
    p.sol -= gross; p.sold -= rawTokensIn;
    p.creatorFee = (p.creatorFee ?? 0) + Math.floor((gross - out) * CREATOR_FEE_SHARE);
    a.tokens.set(mint, held - rawTokensIn);
    a.lamports += out;
    return { signature: this.sig(), lamportsDelta: out - TX_FEE, tokenDelta: -rawTokensIn, feeLamports: TX_FEE };
  }

  async sendSol(signer: Keypair, to: string, lamports: number) {
    const a = this.acct(signer.publicKey.toBase58());
    this.spend(a, lamports + TX_FEE);
    this.acct(to).lamports += lamports;
    return { signature: this.sig(), feeLamports: TX_FEE };
  }

  async claimCreatorFees(signer: Keypair, mint: string): Promise<TradeResult | null> {
    const p = this.pools.get(mint), pk = signer.publicKey.toBase58();
    if (!p) throw new ChainError('UNKNOWN_MINT', `No bonding-curve pool for mint ${mint}`);
    if (p.creator !== pk) throw new ChainError('NOT_CREATOR', "Only the coin's creator can claim its fees");
    const due = p.creatorFee ?? 0;
    if (due < CLAIM_MIN_LAMPORTS) return null;
    const a = this.acct(pk);
    this.spend(a, TX_FEE);
    a.lamports += due;
    p.creatorFee = 0;
    return { signature: this.sig(), lamportsDelta: due - TX_FEE, tokenDelta: 0, feeLamports: TX_FEE };
  }

  async curve(mint: string): Promise<CurveState | null> {
    const p = this.pools.get(mint);
    if (!p) return null;
    return { mint, pool: p.pool, priceLamports: this.price(p), curveProgress: Math.min(1, p.sol / GRADUATE_AT), graduated: p.graduated, quoteReserveLamports: p.sol };
  }
}
