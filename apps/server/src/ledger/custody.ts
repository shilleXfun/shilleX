import { Keypair } from '@solana/web3.js';
import { and, asc, desc, eq, gte, inArray, lt, sql, type SQL } from 'drizzle-orm';
import type { DepositView, WithdrawalView } from '@shillex/shared';
import type { Config } from '../config.ts';
import type { Db } from '../db/client.ts';
import { ledgerChainSeen, ledgerDeposits, ledgerPools, ledgerWithdrawals } from '../db/schema.ts';
import { newId } from '../lib/ids.ts';
import { ChainError } from '../world/chain.ts';
import { getSetting } from '../world/launchpad.ts';
import { recordTx } from '../world/ledger.ts';
import { refreshCoinPrice } from '../world/market.ts';
import { signerFor, walletOf } from '../world/wallets.ts';
import { EXTERNAL, HOUSE, WITHDRAWALS, currentSeason, lamportsOf, move, need } from './accounts.ts';
import { books } from './books.ts';
import { assertCanDeposit } from './consent.ts';
import { CustodyError, isUniqueViolation } from './errors.ts';
import type { LedgerChain } from './ledger-chain.ts';
import { assertCustodyNetwork, isAddress, type CustodyNetwork, type CustodyRpc, type Transfer } from './rpc.ts';
import { payUrl } from './solana-pay.ts';
import { hotVault } from './vault.ts';

const SOL = 1_000_000_000, MIN = 60_000, DAY = 86_400_000;
export const MIN_DEPOSIT = 10_000_000;
export const INTENT_MS = 30 * MIN;
/** A refund returns the payment minus this, the network fee of sending it back. */
export const REFUND_FEE_LAMPORTS = 5_000;
export const CAPS_KEY = 'mainnet_caps';

/** The caps of spec §4, in lamports. */
export interface MainnetCaps { agentLifetime: number; agentDaily: number; userMonthly: number; world: number; hotMax: number; outflowDaily: number }
export function capsFromConfig(c: Config): MainnetCaps {
  const l = c.mainnetLimits, s = (x: number) => Math.round(x * SOL);
  return { agentLifetime: s(l.agentCapSol), agentDaily: s(l.agentDailyCapSol), userMonthly: s(l.userMonthlyCapSol), world: s(l.worldCapSol), hotMax: s(l.hotMaxSol), outflowDaily: s(l.outflowDailyMaxSol) };
}
/** The caps in force: the config's, lowered (never raised) by an admin override (Task 12). */
export async function effectiveCaps(db: Db, base: MainnetCaps): Promise<MainnetCaps> {
  const raw = await getSetting(db, CAPS_KEY);
  const o = raw ? (JSON.parse(raw) as Partial<MainnetCaps>) : {};
  return Object.fromEntries(Object.entries(base).map(([k, v]) => [k, Math.min(v, o[k as keyof MainnetCaps] ?? v)])) as unknown as MainnetCaps;
}

export interface CustodyDeps {
  db: Db; rpc: CustodyRpc; key: Buffer; network: CustodyNetwork; cold: string | null; caps: MainnetCaps; now: () => Date; chain: LedgerChain;
  /** The agents' keys (WORLD_KEY): cash-out sells as the agent. Never used to sign on-chain. */
  worldKey: Buffer;
  /** The owner's payout wallet: deposits must come from it and withdrawals go only to it (LOGIN's payoutWallet, Task 17). */
  payoutOf(userId: string): Promise<string | null>;
  notify?(userId: string, agentId: string, summary: string): Promise<void>;
}
type DepositRow = typeof ledgerDeposits.$inferSelect;
class Skip extends Error {}
export const MIN_WITHDRAW = 1_000_000;
/** Kept back for the network fee of one send. */
export const FEE_MARGIN = 10_000;
type WithdrawalRow = typeof ledgerWithdrawals.$inferSelect;
const utcDay = (t: Date) => new Date(`${t.toISOString().slice(0, 10)}T00:00:00Z`);

export const toDepositView = (r: DepositRow, hot: string): DepositView => ({
  id: r.id, agentId: r.agentId, reference: r.reference, lamports: r.lamports, sol: r.lamports / SOL, hot, status: r.status, expiresAt: r.expiresAt.toISOString(),
  url: payUrl({ recipient: hot, lamports: r.lamports, reference: r.reference, label: 'Shillex', message: 'Fund your Shillex agent' }),
});

/**
 * The only code that signs a real transaction (spec §7). Deposits arrive by Solana Pay reference and are credited only when they
 * match their request exactly; anything else goes back to its sender. Withdrawals (Task 10) go only to the payout wallet or,
 * for the house, the cold address.
 */
export class Custody {
  constructor(readonly d: CustodyDeps) {}
  get cold() { return this.d.cold; }
  get network() { return this.d.network; }
  async hot(): Promise<string> { return (await hotVault(this.d.db, this.d.key, this.d.network, this.d.now())).publicKey; }
  protected async signer(): Promise<Keypair> { return (await hotVault(this.d.db, this.d.key, this.d.network, this.d.now())).signer(); }
  async caps(): Promise<MainnetCaps> { return effectiveCaps(this.d.db, this.d.caps); }
  /** On-chain SOL behind the books: the hot vault plus the cold address. */
  async reserves(): Promise<number> {
    const hot = await this.d.rpc.balance(await this.hot());
    return hot + (this.d.cold ? await this.d.rpc.balance(this.d.cold) : 0);
  }

  /** How much more may come in for this agent and owner, and which cap binds. Pending requests count, so parallel ones can't overshoot. */
  async room(agentId: string, userId: string, exceptId?: string): Promise<{ lamports: number; why: string }> {
    const { db, now } = this.d, caps = await this.caps(), t = now(), season = await currentSeason(db);
    const day = new Date(`${t.toISOString().slice(0, 10)}T00:00:00Z`), month = new Date(t.getTime() - 30 * DAY);
    const live = and(eq(ledgerDeposits.season, season), inArray(ledgerDeposits.status, ['pending', 'credited']), exceptId ? sql`${ledgerDeposits.id} <> ${exceptId}` : undefined);
    const sum = async (...w: (SQL | undefined)[]) => (await db.select({ n: sql<number>`coalesce(sum(${ledgerDeposits.lamports}), 0)::float8` }).from(ledgerDeposits).where(and(live, ...w)))[0]!.n;
    const [agentAll, agentDay, userMonth, pending] = await Promise.all([
      sum(eq(ledgerDeposits.agentId, agentId)), sum(eq(ledgerDeposits.agentId, agentId), gte(ledgerDeposits.createdAt, day)),
      sum(eq(ledgerDeposits.userId, userId), gte(ledgerDeposits.createdAt, month)), sum(eq(ledgerDeposits.status, 'pending')),
    ]);
    const inside = (await books(db)).ledgerTotal;
    const options: [number, string][] = [
      [caps.agentLifetime - agentAll, 'This agent’s lifetime cap'], [caps.agentDaily - agentDay, 'This agent’s daily cap'],
      [caps.userMonthly - userMonth, 'Your 30-day cap'], [caps.world - inside - pending, 'The world’s cap'],
    ];
    const [lamports, why] = options.reduce((a, b) => (b[0] < a[0] ? b : a));
    return { lamports: Math.max(0, lamports), why };
  }

  /** A Solana Pay request to the hot vault with a fresh reference, valid for 30 minutes (spec §4). */
  async createDeposit(i: { agentId: string; userId: string; lamports: number }): Promise<DepositView> {
    const { db, now } = this.d;
    if (this.d.chain.frozen) throw new CustodyError('FROZEN', 'Deposits are paused while the books are checked');
    if (!Number.isSafeInteger(i.lamports) || i.lamports < MIN_DEPOSIT) throw new CustodyError('BAD_AMOUNT', 'Deposits are at least 0.01 SOL');
    await assertCanDeposit(db, i.userId, now());
    const sender = await this.d.payoutOf(i.userId);
    if (!sender) throw new CustodyError('NO_PAYOUT_WALLET', 'Choose a payout wallet first: deposits come from it and withdrawals go back to it');
    const room = await this.room(i.agentId, i.userId);
    if (i.lamports > room.lamports) throw new CustodyError('CAP', `${room.why}: you can add at most ${room.lamports / SOL} SOL now`);
    const t = now();
    const row: DepositRow = {
      id: newId(), season: await currentSeason(db), agentId: i.agentId, userId: i.userId, sender, lamports: i.lamports,
      reference: Keypair.generate().publicKey.toBase58(), status: 'pending', signature: null, createdAt: t, expiresAt: new Date(t.getTime() + INTENT_MS), settledAt: null,
    };
    await db.insert(ledgerDeposits).values(row);
    return toDepositView(row, await this.hot());
  }

  /**
   * Every transfer to the hot vault not handled yet, oldest first: credit it if it matches its request, otherwise refund it.
   * Transfers from the cold address are left for an admin to record as house stake (Task 12). Each signature is handled once:
   * its ledger_chain_seen row is written in the same transaction as the credit, or claimed before a refund is sent.
   */
  async pollDeposits(): Promise<{ credited: number; refunded: number; ignored: number; expired: number }> {
    const { db, rpc, now } = this.d;
    const out = { credited: 0, refunded: 0, ignored: 0, expired: 0 };
    await assertCustodyNetwork(rpc, this.d.network);
    const hot = await this.hot();
    const sigs = await rpc.signaturesFor(hot);
    const seen = new Set(sigs.length ? (await db.select({ s: ledgerChainSeen.signature }).from(ledgerChainSeen).where(inArray(ledgerChainSeen.signature, sigs))).map((r) => r.s) : []);
    for (const sig of sigs.filter((s) => !seen.has(s)).reverse()) {
      const t = await rpc.transferIn(sig, hot);
      if (!t || t.lamports <= 0) { await this.mark(sig, 'ignored', null, null); out.ignored++; continue; }
      if (this.d.cold && t.from === this.d.cold) { await this.mark(sig, 'from_cold', t, null); continue; }
      const [intent] = t.references.length ? await db.select().from(ledgerDeposits).where(inArray(ledgerDeposits.reference, t.references)).limit(1) : [];
      const reason = await this.refusal(intent ?? null, t);
      if (!reason) { if (await this.creditDeposit(sig, intent!, t)) out.credited++; continue; }
      if (await this.refund(sig, t, intent ?? null, reason)) out.refunded++;
    }
    out.expired = (await db.update(ledgerDeposits).set({ status: 'expired' })
      .where(and(eq(ledgerDeposits.status, 'pending'), lt(ledgerDeposits.expiresAt, now()))).returning({ id: ledgerDeposits.id })).length;
    return out;
  }

  private async mark(sig: string, outcome: 'ignored' | 'from_cold', t: Transfer | null, reason: string | null) {
    await this.d.db.insert(ledgerChainSeen).values({ signature: sig, outcome, depositId: null, fromAddress: t?.from ?? null, lamports: t?.lamports ?? 0, refundSignature: null, reason, createdAt: this.d.now() }).onConflictDoNothing();
  }

  private async refusal(intent: DepositRow | null, t: Transfer): Promise<string | null> {
    if (!intent) return 'no matching deposit request';
    if (intent.status !== 'pending') return `the request was already ${intent.status}`;
    if (this.d.now() > intent.expiresAt) return 'the request had expired';
    if (t.from !== intent.sender) return 'paid from a wallet other than the payout wallet';
    if (t.lamports !== intent.lamports) return 'the amount differs from the request';
    if (this.d.chain.frozen) return 'deposits are paused while the books are checked';
    try { await assertCanDeposit(this.d.db, intent.userId, this.d.now()); } catch (e) { return (e as Error).message; }
    const room = await this.room(intent.agentId, intent.userId, intent.id);
    if (t.lamports > room.lamports) return `${room.why} would be exceeded`;
    return null;
  }

  private async creditDeposit(sig: string, intent: DepositRow, t: Transfer): Promise<boolean> {
    const { db, now } = this.d, at = now();
    const pk = (await walletOf(db, intent.agentId))!.publicKey;
    try {
      await db.transaction(async (x) => {
        const tx = x as unknown as Db;
        await tx.insert(ledgerChainSeen).values({ signature: sig, outcome: 'credited', depositId: intent.id, fromAddress: t.from, lamports: t.lamports, refundSignature: null, reason: null, createdAt: at });
        const done = await tx.update(ledgerDeposits).set({ status: 'credited', signature: sig, settledAt: at })
          .where(and(eq(ledgerDeposits.id, intent.id), eq(ledgerDeposits.status, 'pending'))).returning({ id: ledgerDeposits.id });
        if (!done.length) throw new Skip();
        await move(tx, { from: EXTERNAL, to: pk, lamports: t.lamports, kind: 'deposit', ref: sig, season: await currentSeason(tx), at });
        await recordTx(tx, { signature: sig, agentId: intent.agentId, turnId: null, kind: 'deposit', counterparty: t.from, lamportsDelta: t.lamports, createdAt: at });
      });
    } catch (e) {
      if (e instanceof Skip || isUniqueViolation(e)) return false;
      throw e;
    }
    await this.d.notify?.(intent.userId, intent.agentId, `got your ${t.lamports / SOL} SOL deposit`);
    return true;
  }

  /** Claims the signature first, so two polls can never both refund it; a failed send is left for an admin (it may have landed). */
  private async refund(sig: string, t: Transfer, intent: DepositRow | null, reason: string): Promise<boolean> {
    const { db, rpc, now } = this.d;
    const claimed = await db.insert(ledgerChainSeen).values({ signature: sig, outcome: 'refunding', depositId: intent?.id ?? null, fromAddress: t.from, lamports: t.lamports, refundSignature: null, reason, createdAt: now() })
      .onConflictDoNothing().returning({ s: ledgerChainSeen.signature });
    if (!claimed.length) return false;
    const back = t.lamports - REFUND_FEE_LAMPORTS;
    if (back <= 0) { await db.update(ledgerChainSeen).set({ outcome: 'ignored' }).where(eq(ledgerChainSeen.signature, sig)); return false; }
    try {
      const r = await rpc.send(await this.signer(), t.from, back);
      await db.update(ledgerChainSeen).set({ outcome: 'refunded', refundSignature: r.signature }).where(eq(ledgerChainSeen.signature, sig));
      if (intent) await db.update(ledgerDeposits).set({ status: 'refunded', signature: sig, settledAt: now() }).where(and(eq(ledgerDeposits.id, intent.id), eq(ledgerDeposits.status, 'pending')));
      return true;
    } catch (e) {
      await db.update(ledgerChainSeen).set({ outcome: 'refund_failed', reason: `${reason}; refund failed: ${(e as Error).message}` }).where(eq(ledgerChainSeen.signature, sig));
      return false;
    }
  }

  /** An owner's withdrawal: always to the payout wallet in force at request time (spec §4, §7). */
  async requestWithdrawal(i: { agentId: string; userId: string; lamports: number | 'all' }): Promise<WithdrawalView> {
    const to = await this.d.payoutOf(i.userId);
    if (!to) throw new CustodyError('NO_PAYOUT_WALLET', 'Choose a payout wallet first');
    return this.enqueue({ agentId: i.agentId, userId: i.userId, to, lamports: i.lamports, approvedBy: null });
  }

  /**
   * Moves the amount from the agent's account (or the house's) into the pending account and queues the send. Game state never
   * blocks this (spec §4): only processWithdrawals decides when it leaves. The house's SOL leaves only for the cold address.
   */
  async enqueue(i: { agentId: string | null; userId: string | null; to: string; lamports: number | 'all'; approvedBy: string | null }): Promise<WithdrawalView> {
    const { db, now } = this.d;
    if (!isAddress(i.to)) throw new CustodyError('BAD_ADDRESS', 'That is not a Solana address');
    if (i.agentId === null && i.to !== this.d.cold) throw new CustodyError('COLD_ONLY', 'The house’s SOL leaves only for the cold address');
    const from = i.agentId ? (await walletOf(db, i.agentId))!.publicKey : HOUSE;
    const id = newId(), at = now();
    const row = await db.transaction(async (x) => {
      const tx = x as unknown as Db, season = await currentSeason(tx);
      const have = await lamportsOf(tx, from);
      const amount = i.lamports === 'all' ? have : i.lamports;
      if (!Number.isSafeInteger(amount) || amount < MIN_WITHDRAW) throw new CustodyError('BAD_AMOUNT', 'Withdrawals are at least 0.001 SOL');
      await need(tx, from, amount);
      await move(tx, { from, to: WITHDRAWALS, lamports: amount, kind: 'withdraw', ref: id, season, at });
      const r: WithdrawalRow = { id, season, agentId: i.agentId, userId: i.userId, toAddress: i.to, lamports: amount, status: 'queued', reason: null, approvedBy: i.approvedBy, signature: null, requestedAt: at, sentAt: null };
      await tx.insert(ledgerWithdrawals).values(r);
      if (i.agentId) await recordTx(tx, { signature: `ldg_${id}`, agentId: i.agentId, turnId: null, kind: 'withdraw', counterparty: i.to, lamportsDelta: -amount, createdAt: at });
      return r;
    });
    return (await this.withdrawals({ id: row.id }))[0]!;
  }

  /** Why a queued withdrawal must wait, or null when it can go now. */
  private async holdReason(w: WithdrawalRow, caps: MainnetCaps, hot: string): Promise<string | null> {
    const { db, rpc, now } = this.d;
    if (this.d.chain.frozen && !w.approvedBy) return 'review: the books did not reconcile, an admin checks before anything leaves';
    if (!w.approvedBy) {
      const [s] = await db.select({ n: sql<number>`coalesce(sum(${ledgerWithdrawals.lamports}), 0)::float8` }).from(ledgerWithdrawals)
        .where(and(eq(ledgerWithdrawals.status, 'sent'), gte(ledgerWithdrawals.sentAt, utcDay(now()))));
      if ((s?.n ?? 0) + w.lamports > caps.outflowDaily) return 'the daily outflow limit is reached: it waits for the owner’s approval';
    }
    if ((await rpc.balance(hot)) < w.lamports + FEE_MARGIN) return 'the hot vault is low: the owner tops it up and it is paid within 24 hours';
    if ((await lamportsOf(db, HOUSE)) < FEE_MARGIN) return 'the house cannot pay the network fee yet';
    return null;
  }

  /**
   * Sends what can go, oldest first. A row is claimed (queued → sending) before its send; a send that throws stays `sending`
   * with a note and is never retried here: it may have landed, so an admin checks the chain and resolves it (Task 12).
   */
  async processWithdrawals(): Promise<{ sent: number; held: number; failed: number }> {
    const { db, rpc } = this.d, out = { sent: 0, held: 0, failed: 0 };
    const queued = await db.select().from(ledgerWithdrawals).where(eq(ledgerWithdrawals.status, 'queued')).orderBy(asc(ledgerWithdrawals.requestedAt));
    if (!queued.length) return out;
    const caps = await this.caps(), hot = await this.hot();
    for (const w of queued) {
      const hold = await this.holdReason(w, caps, hot);
      if (hold) {
        if (w.reason !== hold) await db.update(ledgerWithdrawals).set({ reason: hold }).where(eq(ledgerWithdrawals.id, w.id));
        out.held++; continue;
      }
      const claimed = await db.update(ledgerWithdrawals).set({ status: 'sending', reason: null })
        .where(and(eq(ledgerWithdrawals.id, w.id), eq(ledgerWithdrawals.status, 'queued'))).returning({ id: ledgerWithdrawals.id });
      if (!claimed.length) continue;
      try {
        await assertCustodyNetwork(rpc, this.d.network);
        const s = await rpc.send(await this.signer(), w.toAddress, w.lamports);
        await this.settleSent(w, s.signature, s.feeLamports);
        out.sent++;
      } catch (e) {
        await db.update(ledgerWithdrawals).set({ reason: `send failed (${(e as Error).message}); it may still have landed: check the chain before resolving` }).where(eq(ledgerWithdrawals.id, w.id));
        out.failed++;
      }
    }
    return out;
  }

  private async settleSent(w: WithdrawalRow, signature: string, feeLamports: number) {
    const { db, now } = this.d, at = now();
    await db.transaction(async (x) => {
      const tx = x as unknown as Db, season = await currentSeason(tx);
      await tx.update(ledgerWithdrawals).set({ status: 'sent', signature, sentAt: at, reason: null }).where(eq(ledgerWithdrawals.id, w.id));
      await move(tx, { from: WITHDRAWALS, to: EXTERNAL, lamports: w.lamports, kind: 'withdraw_sent', ref: signature, season, at });
      await move(tx, { from: HOUSE, to: EXTERNAL, lamports: Math.min(feeLamports, await lamportsOf(tx, HOUSE)), kind: 'network_fee', ref: signature, season, at });
    });
    if (w.userId && w.agentId) await this.d.notify?.(w.userId, w.agentId, `sent ${w.lamports / SOL} SOL to your wallet`);
  }

  /** An admin lets a held withdrawal past the outflow limit or the review hold. */
  async approve(id: string, adminId: string): Promise<void> {
    const r = await this.d.db.update(ledgerWithdrawals).set({ approvedBy: adminId }).where(and(eq(ledgerWithdrawals.id, id), eq(ledgerWithdrawals.status, 'queued'))).returning({ id: ledgerWithdrawals.id });
    if (!r.length) throw new CustodyError('NOT_QUEUED', 'Only a queued withdrawal can be approved');
  }

  /**
   * A `sending` withdrawal after an admin checked the chain. 'sent': the given transaction must be a transfer of exactly this
   * amount from the hot vault to this address. 'return': nothing left, so the SOL goes back to the agent (or the house).
   */
  async resolveStuck(id: string, outcome: 'sent' | 'return', signature?: string): Promise<void> {
    const { db, rpc, now } = this.d;
    const [w] = await db.select().from(ledgerWithdrawals).where(eq(ledgerWithdrawals.id, id));
    if (!w || w.status !== 'sending') throw new CustodyError('NOT_STUCK', 'Only a withdrawal stuck in sending can be resolved');
    if (outcome === 'sent') {
      const t = signature ? await rpc.transferIn(signature, w.toAddress) : null;
      if (!t || t.from !== (await this.hot()) || t.lamports !== w.lamports) throw new CustodyError('NOT_THIS_TRANSFER', 'That transaction is not this withdrawal leaving the hot vault');
      await this.settleSent(w, signature!, t.feeLamports);
      return;
    }
    const at = now(), back = w.agentId ? (await walletOf(db, w.agentId))!.publicKey : HOUSE;
    await db.transaction(async (x) => {
      const tx = x as unknown as Db;
      await tx.update(ledgerWithdrawals).set({ status: 'failed', reason: 'returned after a failed send' }).where(eq(ledgerWithdrawals.id, w.id));
      await move(tx, { from: WITHDRAWALS, to: back, lamports: w.lamports, kind: 'withdraw_return', ref: `return_${w.id}`, season: await currentSeason(tx), at });
      if (w.agentId) await recordTx(tx, { signature: `ldg_return_${w.id}`, agentId: w.agentId, turnId: null, kind: 'withdraw', counterparty: w.toAddress, lamportsDelta: w.lamports, createdAt: at });
    });
  }

  /** Sells what the rules allow (vesting, the 30% creator cap; paused or graduated coins stay held), then withdraws all free SOL. */
  async cashOut(i: { agentId: string; userId: string }): Promise<{ sold: string[]; withdrawal: WithdrawalView | null }> {
    const { db, chain, now } = this.d;
    const signer = await signerFor(db, i.agentId, this.d.worldKey), pk = signer.publicKey.toBase58();
    const sold: string[] = [];
    for (const t of (await chain.balances(pk)).tokens) {
      const [p] = await db.select({ creator: ledgerPools.creatorAccount }).from(ledgerPools).where(eq(ledgerPools.mint, t.mint));
      const free = t.raw - (t.lockedRaw ?? 0);
      const raw = p?.creator === pk ? Math.min(free, Math.floor(t.raw * chain.rules.maxCreatorSaleShare)) : free;
      if (raw <= 0) continue;
      try {
        const r = await chain.sell(signer, t.mint, raw, 10_000);
        await recordTx(db, { signature: r.signature, agentId: i.agentId, turnId: null, kind: 'sell', mint: t.mint, lamportsDelta: r.lamportsDelta, tokenDelta: r.tokenDelta, createdAt: now() });
        await refreshCoinPrice(db, chain, t.mint, now());
        sold.push(t.mint);
      } catch (e) { if (!(e instanceof ChainError)) throw e; }
    }
    const free = (await chain.balances(pk)).lamports;
    return { sold, withdrawal: free >= MIN_WITHDRAW ? await this.requestWithdrawal({ agentId: i.agentId, userId: i.userId, lamports: 'all' }) : null };
  }

  async withdrawals(f: { id?: string; agentId?: string; open?: boolean }): Promise<WithdrawalView[]> {
    const { db } = this.d;
    const rows = await db.select().from(ledgerWithdrawals)
      .where(and(f.id ? eq(ledgerWithdrawals.id, f.id) : undefined, f.agentId ? eq(ledgerWithdrawals.agentId, f.agentId) : undefined, f.open ? inArray(ledgerWithdrawals.status, ['queued', 'sending']) : undefined))
      .orderBy(desc(ledgerWithdrawals.requestedAt)).limit(100);
    const queue = (await db.select({ id: ledgerWithdrawals.id }).from(ledgerWithdrawals).where(eq(ledgerWithdrawals.status, 'queued')).orderBy(asc(ledgerWithdrawals.requestedAt))).map((r) => r.id);
    return rows.map((r) => ({
      id: r.id, agentId: r.agentId, lamports: r.lamports, sol: r.lamports / SOL, to: r.toAddress, status: r.status, reason: r.reason,
      position: r.status === 'queued' ? queue.indexOf(r.id) + 1 : null, requestedAt: r.requestedAt.toISOString(), sentAt: r.sentAt?.toISOString() ?? null, signature: r.signature,
    }));
  }
}
