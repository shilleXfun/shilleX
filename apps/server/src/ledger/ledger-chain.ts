import { Keypair } from '@solana/web3.js';
import { and, eq, gt } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { ledgerAccounts, ledgerHoldings, ledgerPools } from '../db/schema.ts';
import { newId } from '../lib/ids.ts';
import { CURVE, ChainError, GRADUATED_MESSAGE, type Chain, type ChainLimits, type CurveState, type LaunchInput, type LaunchResult, type TradeResult, type WalletBalances } from '../world/chain.ts';
import { getSetting, setSetting } from '../world/launchpad.ts';
import { EXTERNAL, FROZEN_KEY, HOUSE, currentSeason, move, moveTokens, need, ownerOfKey, poolAccount, type JournalKind } from './accounts.ts';
import { priceOf, quoteBuy, quoteSell } from './curve.ts';
import { DEFAULT_RULES, type LedgerRules } from './rules.ts';

type PoolRow = typeof ledgerPools.$inferSelect;
const asDb = (t: unknown) => t as Db;

/**
 * Agent coins on Shillex's own books (mainnet spec §2): MemoryChain's curve, persisted, one database transaction per action
 * with the pool and the accounts row-locked. Nothing here touches a blockchain: real SOL moves only through Custody.
 */
export class LedgerChain implements Chain {
  readonly network = 'ledger' as const;
  private frozenReason: string | null = null;
  constructor(private db: Db, private now: () => Date, readonly rules: LedgerRules = DEFAULT_RULES) {}

  get limits(): ChainLimits {
    const r = this.rules;
    return { launchCostLamports: r.launchFeeLamports, rugMinShare: r.rugMinShare, maxCreatorSaleShare: r.maxCreatorSaleShare, maxTradeLamports: r.maxTradeLamports, maxSendLamports: r.maxSendLamports, frozen: this.frozenReason !== null };
  }
  /** Why the books are frozen, or null. */
  get frozen(): string | null { return this.frozenReason; }
  async loadFrozen() { this.frozenReason = (await getSetting(this.db, FROZEN_KEY)) || null; }
  async freeze(reason: string) { await setSetting(this.db, FROZEN_KEY, reason); this.frozenReason = reason; }
  async unfreeze() { await setSetting(this.db, FROZEN_KEY, ''); this.frozenReason = null; }

  private sig() { return `ldg_${newId()}`; }

  async balances(publicKey: string): Promise<WalletBalances> {
    const [a] = await this.db.select({ l: ledgerAccounts.lamports }).from(ledgerAccounts).where(eq(ledgerAccounts.publicKey, publicKey));
    const held = await this.db.select().from(ledgerHoldings).where(and(eq(ledgerHoldings.account, publicKey), gt(ledgerHoldings.raw, 0)));
    const mine = held.length ? await this.db.select().from(ledgerPools).where(eq(ledgerPools.creatorAccount, publicKey)) : [];
    const now = this.now();
    return {
      lamports: a?.l ?? 0,
      tokens: held.map((h) => {
        const p = mine.find((x) => x.mint === h.mint);
        const lockedRaw = p ? Math.min(h.raw, this.locked(p, now)) : 0;
        return lockedRaw > 0 ? { mint: h.mint, raw: h.raw, lockedRaw } : { mint: h.mint, raw: h.raw };
      }),
    };
  }

  async launch(signer: Keypair, input: LaunchInput): Promise<LaunchResult> {
    this.checkOpen();
    this.checkBuySize(input.initialBuyLamports);
    const pk = signer.publicKey.toBase58(), ref = this.sig(), at = this.now(), fee = this.rules.launchFeeLamports;
    const mint = Keypair.generate().publicKey.toBase58(), pool = Keypair.generate().publicKey.toBase58();
    return this.db.transaction(async (t) => {
      const tx = asDb(t), season = await currentSeason(tx);
      const creatorId = await ownerOfKey(tx, pk);
      await need(tx, pk, fee + input.initialBuyLamports);
      await move(tx, { from: pk, to: HOUSE, lamports: fee, kind: 'launch_fee', ref, season, at, mint });
      await tx.insert(ledgerPools).values({ mint, pool, creatorId, creatorAccount: pk, sol: 0, sold: 0, vestedRaw: 0, graduated: false, launchedAt: at });
      if (input.initialBuyLamports <= 0) {
        await this.settle(tx, mint, at);
        return { mint, pool, signature: ref, lamportsDelta: -fee, tokenDelta: 0, feeLamports: 0 };
      }
      const first = await this.swapIn(tx, pk, mint, input.initialBuyLamports, ref, season, at);
      await tx.update(ledgerPools).set({ vestedRaw: first.out }).where(eq(ledgerPools.mint, mint));
      return { mint, pool, signature: ref, lamportsDelta: -fee + first.delta, tokenDelta: first.out, feeLamports: 0 };
    });
  }

  async buy(signer: Keypair, mint: string, lamportsIn: number, _slippageBps?: number): Promise<TradeResult> {
    this.checkOpen();
    this.checkBuySize(lamportsIn);
    const pk = signer.publicKey.toBase58(), ref = this.sig(), at = this.now();
    return this.db.transaction(async (t) => {
      const tx = asDb(t), season = await currentSeason(tx);
      await ownerOfKey(tx, pk);
      const r = await this.swapIn(tx, pk, mint, lamportsIn, ref, season, at);
      return { signature: ref, lamportsDelta: r.delta, tokenDelta: r.out, feeLamports: 0 };
    });
  }

  async sell(signer: Keypair, mint: string, rawTokensIn: number, _slippageBps?: number): Promise<TradeResult> {
    this.checkOpen();
    if (!(rawTokensIn > 0)) throw new ChainError('INSUFFICIENT_TOKENS', 'Sell a positive number of tokens');
    const pk = signer.publicKey.toBase58(), ref = this.sig(), at = this.now();
    return this.db.transaction(async (t) => {
      const tx = asDb(t), season = await currentSeason(tx);
      await ownerOfKey(tx, pk);
      const p = await this.lockPool(tx, mint, at);
      const [h] = await tx.select({ raw: ledgerHoldings.raw }).from(ledgerHoldings).where(and(eq(ledgerHoldings.account, pk), eq(ledgerHoldings.mint, mint))).for('update');
      const held = h?.raw ?? 0;
      if (held < rawTokensIn) throw new ChainError('INSUFFICIENT_TOKENS', `Holds ${held} raw units, tried to sell ${rawTokensIn}`);
      this.checkSell(p, pk, held, rawTokensIn, at);
      const q = quoteSell(p, rawTokensIn);
      const house = Math.min(q.fee, Math.floor((q.gross * this.rules.houseFeeBps) / 10_000)), creator = q.fee - house;
      await moveTokens(tx, { from: pk, to: poolAccount(mint), mint, raw: rawTokensIn, kind: 'sell', ref, season, at });
      await move(tx, { from: poolAccount(mint), to: pk, lamports: q.out, kind: 'sell', ref, season, at, mint });
      await move(tx, { from: poolAccount(mint), to: HOUSE, lamports: house, kind: 'trade_fee', ref, season, at, mint });
      await move(tx, { from: poolAccount(mint), to: p.creatorAccount, lamports: creator, kind: 'trade_fee', ref, season, at, mint });
      await this.settle(tx, mint, at);
      return { signature: ref, lamportsDelta: q.out + (p.creatorAccount === pk ? creator : 0), tokenDelta: -rawTokensIn, feeLamports: 0 };
    });
  }

  async sendSol(signer: Keypair, to: string, lamports: number) {
    this.checkOpen();
    const pk = signer.publicKey.toBase58(), ref = this.sig(), at = this.now();
    return this.db.transaction(async (t) => {
      const tx = asDb(t), season = await currentSeason(tx);
      await ownerOfKey(tx, pk);
      await this.checkSend(tx, pk, to, lamports, at);
      await move(tx, { from: pk, to, lamports, kind: 'send', ref, season, at });
      return { signature: ref, feeLamports: 0 };
    });
  }

  async curve(mint: string): Promise<CurveState | null> {
    const [p] = await this.db.select().from(ledgerPools).where(eq(ledgerPools.mint, mint));
    if (!p) return null;
    return { mint, pool: p.pool, priceLamports: priceOf(p), curveProgress: Math.min(1, p.sol / CURVE.GRADUATE_AT), graduated: p.graduated, quoteReserveLamports: p.sol };
  }

  /** SOL entering the books from outside: a deposit, the house stake. `ref` is the on-chain signature or another unique id. */
  async credit(to: string, lamports: number, kind: JournalKind, ref: string): Promise<void> {
    await this.transfer(EXTERNAL, to, lamports, kind, ref);
  }

  /** SOL between two accounts on the books: opening balances from the house, withdrawals into the pending account. */
  async transfer(from: string, to: string, lamports: number, kind: JournalKind, ref: string): Promise<void> {
    const at = this.now();
    await this.db.transaction(async (t) => { const tx = asDb(t); await move(tx, { from, to, lamports, kind, ref, season: await currentSeason(tx), at }); });
  }

  /** A buy inside an open transaction: SOL into the pool (fee split creator/house), tokens out. Returns the signer's SOL change. */
  private async swapIn(tx: Db, pk: string, mint: string, lamportsIn: number, ref: string, season: string, at: Date): Promise<{ out: number; delta: number }> {
    const p = await this.lockPool(tx, mint, at);
    const q = quoteBuy(p, lamportsIn);
    if (q.out <= 0) throw new ChainError('CURVE_FULL', 'The curve cannot fill this trade; try a smaller amount');
    await need(tx, pk, q.spent);
    const house = Math.min(q.fee, Math.floor((q.spent * this.rules.houseFeeBps) / 10_000)), creator = q.fee - house;
    await move(tx, { from: pk, to: poolAccount(mint), lamports: q.net, kind: 'buy', ref, season, at, mint });
    await move(tx, { from: pk, to: HOUSE, lamports: house, kind: 'trade_fee', ref, season, at, mint });
    await move(tx, { from: pk, to: p.creatorAccount, lamports: creator, kind: 'trade_fee', ref, season, at, mint });
    await moveTokens(tx, { from: poolAccount(mint), to: pk, mint, raw: q.out, kind: 'buy', ref, season, at });
    await this.settle(tx, mint, at);
    return { out: q.out, delta: -q.spent + (p.creatorAccount === pk ? creator : 0) };
  }

  private async lockPool(tx: Db, mint: string, at: Date): Promise<PoolRow> {
    const [p] = await tx.select().from(ledgerPools).where(eq(ledgerPools.mint, mint)).for('update');
    if (!p) throw new ChainError('UNKNOWN_MINT', `No bonding-curve pool for mint ${mint}`);
    if (p.graduated) throw new ChainError('GRADUATED', GRADUATED_MESSAGE);
    this.checkPaused(p, at);
    return p;
  }

  /** After a trade: graduation (curve complete, trading ends; never a public pool), then the price hook. */
  private async settle(tx: Db, mint: string, at: Date) {
    const [p] = await tx.select().from(ledgerPools).where(eq(ledgerPools.mint, mint));
    if (p!.sol >= CURVE.GRADUATE_AT || p!.sold >= CURVE.CURVE_TOKENS) await tx.update(ledgerPools).set({ graduated: true }).where(eq(ledgerPools.mint, mint));
    await this.afterTrade(tx, p!, at);
  }

  // ── Safety hooks: Task 5 fills these with the spec's rules. ──
  private checkOpen() {}
  private checkBuySize(_lamports: number) {}
  private checkSell(_p: PoolRow, _pk: string, _held: number, _raw: number, _at: Date) {}
  private checkPaused(_p: PoolRow, _at: Date) {}
  private async afterTrade(_tx: Db, _p: PoolRow, _at: Date) {}
  private locked(_p: PoolRow, _now: Date): number { return 0; }
  private async checkSend(tx: Db, _from: string, to: string, _lamports: number, _at: Date) { await ownerOfKey(tx, to); }
}
