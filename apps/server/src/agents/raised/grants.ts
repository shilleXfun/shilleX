import { and, eq, gte, sql } from 'drizzle-orm';
import { LAMPORTS_PER_SOL, type GrantView } from '@shillex/shared';
import type { Db } from '../../db/client.ts';
import { agentGrants, wallets } from '../../db/schema.ts';
import { newId } from '../../lib/ids.ts';
import type { Chain } from '../../world/chain.ts';
import { START_LAMPORTS, recordTx } from '../../world/ledger.ts';
import { TREASURY, signerFor, walletOf } from '../../world/wallets.ts';
import type { EngineDeps } from '../engine.ts';
import { HOUSE, PRACTICE_SEASONS, currentSeason, lamportsOf as lamportsOnBooks } from '../../ledger/accounts.ts';
import { LedgerChain } from '../../ledger/ledger-chain.ts';

/** Spec §6. A raised agent starts with what a wild agent started with. */
export const START_GRANT = START_LAMPORTS;
export const TOP_UP = 50_000_000;
export const TOP_UPS_MAX = 300_000_000;
export const TREASURY_FLOOR = LAMPORTS_PER_SOL;
const FEE = 5_000;

export type GrantCode = 'TOP_UP_TODAY' | 'TOP_UPS_MAX' | 'GRANTS_DAILY' | 'TREASURY_LOW' | 'TREASURY_UNREADABLE' | 'GRANTS_OFF';

/**
 * Where grants come from. Devnet and memory: the treasury wallet, by a signed transfer. The ledger: the house's account, by a
 * move on the books (a grant is not an agent's send, so the ledger's 0.01 SOL send cap doesn't apply). In a real-SOL season the
 * house gives nothing away: owners fund their agents with deposits (mainnet spec §4), or raising would mint withdrawable SOL.
 */
type Source = { kind: 'treasury' } | { kind: 'house'; chain: LedgerChain; real: boolean };
async function sourceOf(d: GrantDeps): Promise<Source> {
  if (!(d.chain instanceof LedgerChain)) return { kind: 'treasury' };
  return { kind: 'house', chain: d.chain, real: !PRACTICE_SEASONS.has(await currentSeason(d.db)) };
}
export class GrantRefused extends Error { constructor(readonly code: GrantCode, message: string) { super(message); } }
export interface GrantDeps { db: Db; chain: Chain; key: Buffer; now: () => Date; dailyLimitSol: number }
export const grantDepsOf = (d: EngineDeps): GrantDeps => ({ db: d.db, chain: d.chain, key: d.worldKey, now: d.now, dailyLimitSol: d.app.deps.config.userAgentGrantsDailySol });

const dayStart = (now: Date) => new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
const lamportsOf = (kind: 'start' | 'top_up') => (kind === 'start' ? START_GRANT : TOP_UP);

const TREASURY_TTL_MS = 30_000;
/** The treasury's last balance read, per treasury key: the owner panel polls, and its every poll must not hit the RPC. */
const treasurySeen = new Map<string, { at: number; lamports: number }>();
/** The treasury's lamports, or null when the chain can't be read. `cached` accepts a read up to 30 s old; a grant reads fresh. */
async function treasuryLamports(d: GrantDeps, cached: boolean): Promise<number | null> {
  if (d.chain instanceof LedgerChain) return lamportsOnBooks(d.db, HOUSE);
  const t = await walletOf(d.db, TREASURY);
  if (!t) return 0;
  const now = d.now().getTime(), hit = treasurySeen.get(t.publicKey);
  if (cached && hit && now >= hit.at && now - hit.at < TREASURY_TTL_MS) return hit.lamports;
  try {
    const lamports = (await d.chain.balances(t.publicKey)).lamports;
    treasurySeen.set(t.publicKey, { at: now, lamports });
    return lamports;
  } catch (e) {
    console.error('[raised] could not read the treasury balance', e);
    return null;
  }
}

/** Why a grant can't go out now, or null. The treasury check reads the chain (`cached`: a read up to 30 s old will do). */
async function refusal(d: GrantDeps, agentId: string, kind: 'start' | 'top_up', cached = false): Promise<GrantRefused | null> {
  const src = await sourceOf(d);
  if (src.kind === 'house' && src.real) return kind === 'start' ? null : new GrantRefused('GRANTS_OFF', 'On real SOL you fund your agent with a deposit.');
  const lamports = lamportsOf(kind), today = dayStart(d.now());
  if (kind === 'top_up') {
    const mine = await d.db.select({ at: agentGrants.createdAt, lamports: agentGrants.lamports }).from(agentGrants)
      .where(and(eq(agentGrants.agentId, agentId), eq(agentGrants.kind, 'top_up')));
    if (mine.some((g) => g.at >= today)) return new GrantRefused('TOP_UP_TODAY', 'One top-up a day; try again tomorrow (UTC).');
    if (mine.reduce((n, g) => n + g.lamports, 0) + lamports > TOP_UPS_MAX) return new GrantRefused('TOP_UPS_MAX', 'This agent has had all 0.3 SOL of top-ups it can get.');
  }
  const [day] = await d.db.select({ s: sql<number>`coalesce(sum(${agentGrants.lamports}), 0)::float8` }).from(agentGrants).where(gte(agentGrants.createdAt, today));
  if (Number(day?.s ?? 0) + lamports > d.dailyLimitSol * LAMPORTS_PER_SOL) return new GrantRefused('GRANTS_DAILY', 'Today’s devnet SOL for raised agents is used up; try again tomorrow (UTC).');
  const have = await treasuryLamports(d, cached);
  if (have === null) return new GrantRefused('TREASURY_UNREADABLE', 'The treasury can’t be read right now; try again soon.');
  // The devnet treasury keeps a floor for the wild agents it funds; the house's practice books need none, and pay no fee.
  const floor = src.kind === 'house' ? 0 : TREASURY_FLOOR, fee = src.kind === 'house' ? 0 : FEE;
  if (have - lamports - fee < floor) return new GrantRefused('TREASURY_LOW', 'The treasury is refilling; try again later.');
  return null;
}

/** True when a grant of this kind could go out now (`agentId` may be '' for a start grant to an agent not yet made). */
export const canGrant = async (d: GrantDeps, agentId: string, kind: 'start' | 'top_up') => (await refusal(d, agentId, kind)) === null;

const inFlight = new Set<string>();
/**
 * Sends devnet SOL from the treasury to a raised agent: a 'fund' chain row for the start grant (as a wild agent's 0.1 SOL), a
 * 'receive' row for a top-up (a memory-chain restore counts it), and an agent_grants row. A start grant is sent once.
 */
export async function sendGrant(d: GrantDeps, agentId: string, kind: 'start' | 'top_up'): Promise<{ signature: string; lamports: number }> {
  if (kind === 'start') {
    const [done] = await d.db.select().from(agentGrants).where(and(eq(agentGrants.agentId, agentId), eq(agentGrants.kind, 'start')));
    if (done) return { signature: done.signature, lamports: done.lamports };
  }
  if (inFlight.has(agentId)) throw new GrantRefused('TOP_UP_TODAY', 'A grant for this agent is already on its way.');
  inFlight.add(agentId);
  try {
    const no = await refusal(d, agentId, kind);
    if (no) throw no;
    const to = await walletOf(d.db, agentId);
    if (!to) throw new Error(`No wallet for ${agentId}`);
    const src = await sourceOf(d), now = d.now();
    let signature: string, lamports = lamportsOf(kind), counterparty: string;
    if (src.kind === 'treasury') {
      const treasury = await signerFor(d.db, TREASURY, d.key);
      signature = (await d.chain.sendSol(treasury, to.publicKey, lamports)).signature;
      counterparty = treasury.publicKey.toBase58();
    } else {
      // On the books: a move from the house's account. In a real-SOL season the start grant is zero: the agent wakes up and
      // its owner funds it with a deposit.
      if (src.real) lamports = 0;
      signature = `ldg_grant_${newId()}`;
      counterparty = HOUSE;
      if (lamports > 0) await src.chain.transfer(HOUSE, to.publicKey, lamports, 'grant', signature);
    }
    if (lamports > 0) await recordTx(d.db, { signature, agentId, turnId: null, kind: kind === 'start' ? 'fund' : 'receive', counterparty, lamportsDelta: lamports, createdAt: now });
    await d.db.insert(agentGrants).values({ id: newId(), agentId, lamports, kind, signature, createdAt: now });
    if (kind === 'start') await d.db.update(wallets).set({ fundedAt: now }).where(eq(wallets.ownerId, agentId));
    return { signature, lamports };
  } finally { inFlight.delete(agentId); }
}

export async function topUpStatus(d: GrantDeps, agentId: string): Promise<{ availableToday: boolean; remainingSol: number; reason: string | null }> {
  const no = await refusal(d, agentId, 'top_up', true);
  const [used] = await d.db.select({ s: sql<number>`coalesce(sum(${agentGrants.lamports}), 0)::float8` }).from(agentGrants)
    .where(and(eq(agentGrants.agentId, agentId), eq(agentGrants.kind, 'top_up')));
  return { availableToday: !no, remainingSol: Math.max(0, TOP_UPS_MAX - Number(used?.s ?? 0)) / LAMPORTS_PER_SOL, reason: no?.message ?? null };
}

export async function grantsOf(db: Db, agentId: string): Promise<GrantView[]> {
  const rows = await db.select().from(agentGrants).where(eq(agentGrants.agentId, agentId)).orderBy(agentGrants.createdAt);
  return rows.map((g) => ({ kind: g.kind, sol: g.lamports / LAMPORTS_PER_SOL, signature: g.signature, createdAt: g.createdAt.toISOString() }));
}
