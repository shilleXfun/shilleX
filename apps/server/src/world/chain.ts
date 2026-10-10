import type { Keypair } from '@solana/web3.js';

export interface LaunchInput { name: string; symbol: string; uri: string; initialBuyLamports: number }
export interface TradeResult { signature: string; lamportsDelta: number; tokenDelta: number; feeLamports: number }
export interface LaunchResult extends TradeResult { mint: string; pool: string }
export interface CurveState { mint: string; pool: string; priceLamports: number; curveProgress: number; graduated: boolean; quoteReserveLamports: number }
export interface WalletBalances { lamports: number; tokens: { mint: string; raw: number }[] }
export interface Chain {
  readonly network: 'devnet' | 'memory';
  balances(publicKey: string): Promise<WalletBalances>;
  launch(signer: Keypair, input: LaunchInput): Promise<LaunchResult>;
  buy(signer: Keypair, mint: string, lamportsIn: number, slippageBps: number): Promise<TradeResult>;
  sell(signer: Keypair, mint: string, rawTokensIn: number, slippageBps: number): Promise<TradeResult>;
  sendSol(signer: Keypair, to: string, lamports: number): Promise<{ signature: string; feeLamports: number }>;
  curve(mint: string): Promise<CurveState | null>;
}

export class ChainError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export const RAW_PER_TOKEN = 1_000_000;
const SOL = 1_000_000_000;
const TX_FEE = 5000;
const LAUNCH_COST = 20_000_000; // rent + creation, close to the devnet spike's measurement
const TRADE_FEE_BPS = 100;
// Scaled to a 5 SOL economy (50 wallets × 0.1 SOL) so a few agents can visibly pump or rug a coin; tuned to match the devnet launchpad.
const V_SOL = 1 * SOL, V_TOKENS = 1_073_000_000 * RAW_PER_TOKEN, CURVE_TOKENS = 793_100_000 * RAW_PER_TOKEN, GRADUATE_AT = 3 * SOL;

interface Pool { mint: string; pool: string; sol: number; sold: number; graduated: boolean }
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
  private spend(a: Account, lamports: number) {
    if (a.lamports < lamports) throw new ChainError('INSUFFICIENT_FUNDS', `Insufficient SOL: has ${a.lamports} lamports, needs ${lamports}`);
    a.lamports -= lamports;
  }
  private pool(mint: string) {
    const p = this.pools.get(mint);
    if (!p) throw new ChainError('UNKNOWN_MINT', `No bonding-curve pool for mint ${mint}`);
    if (p.graduated) throw new ChainError('GRADUATED', 'This coin graduated; its curve is closed');
    return p;
  }
  private price(p: Pool) { return ((V_SOL + p.sol) / (V_TOKENS - p.sold)) * RAW_PER_TOKEN; }

  async balances(publicKey: string): Promise<WalletBalances> {
    const a = this.acct(publicKey);
    return { lamports: a.lamports, tokens: [...a.tokens].filter(([, raw]) => raw > 0).map(([mint, raw]) => ({ mint, raw })) };
  }

  async launch(signer: Keypair, input: LaunchInput): Promise<LaunchResult> {
    const a = this.acct(signer.publicKey.toBase58());
    this.spend(a, LAUNCH_COST + TX_FEE + input.initialBuyLamports);
    a.lamports += input.initialBuyLamports; // the first buy below re-spends it through the curve
    const mint = `M${this.n + 1}${input.symbol}`.padEnd(44, '1').slice(0, 44);
    this.pools.set(mint, { mint, pool: `P${mint.slice(1)}`, sol: 0, sold: 0, graduated: false });
    const signature = this.sig();
    let tokenDelta = 0;
    if (input.initialBuyLamports > 0) tokenDelta = this.swapIn(a, this.pools.get(mint)!, input.initialBuyLamports);
    return { mint, pool: this.pools.get(mint)!.pool, signature, lamportsDelta: -(LAUNCH_COST + TX_FEE + input.initialBuyLamports), tokenDelta, feeLamports: TX_FEE };
  }

  private swapIn(a: Account, p: Pool, lamportsIn: number): number {
    this.spend(a, lamportsIn);
    const net = Math.floor(lamportsIn * (1 - TRADE_FEE_BPS / 10_000));
    const k = (V_SOL + p.sol) * (V_TOKENS - p.sold);
    const out = Math.min(Math.floor(V_TOKENS - p.sold - k / (V_SOL + p.sol + net)), CURVE_TOKENS - p.sold);
    p.sol += net; p.sold += out;
    if (p.sol >= GRADUATE_AT || p.sold >= CURVE_TOKENS) p.graduated = true;
    a.tokens.set(p.mint, (a.tokens.get(p.mint) ?? 0) + out);
    return out;
  }

  async buy(signer: Keypair, mint: string, lamportsIn: number, _slippageBps?: number): Promise<TradeResult> {
    const p = this.pool(mint), a = this.acct(signer.publicKey.toBase58());
    this.spend(a, TX_FEE + lamportsIn); a.lamports += lamportsIn;
    const tokenDelta = this.swapIn(a, p, lamportsIn);
    return { signature: this.sig(), lamportsDelta: -(lamportsIn + TX_FEE), tokenDelta, feeLamports: TX_FEE };
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

  async curve(mint: string): Promise<CurveState | null> {
    const p = this.pools.get(mint);
    if (!p) return null;
    return { mint, pool: p.pool, priceLamports: this.price(p), curveProgress: Math.min(1, p.sol / GRADUATE_AT), graduated: p.graduated, quoteReserveLamports: p.sol };
  }
}
