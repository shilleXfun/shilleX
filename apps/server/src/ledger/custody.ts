import { Keypair } from '@solana/web3.js';
import { and, eq, gte, inArray, lt, sql, type SQL } from 'drizzle-orm';
import type { DepositView } from '@shillex/shared';
import type { Config } from '../config.ts';
import type { Db } from '../db/client.ts';
import { ledgerChainSeen, ledgerDeposits } from '../db/schema.ts';
import { newId } from '../lib/ids.ts';
import { getSetting } from '../world/launchpad.ts';
import { recordTx } from '../world/ledger.ts';
import { walletOf } from '../world/wallets.ts';
import { EXTERNAL, currentSeason, move } from './accounts.ts';
import { books } from './books.ts';
import { assertCanDeposit } from './consent.ts';
import { CustodyError, isUniqueViolation } from './errors.ts';
import type { LedgerChain } from './ledger-chain.ts';
import { assertCustodyNetwork, type CustodyNetwork, type CustodyRpc, type Transfer } from './rpc.ts';
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
}
