import bs58 from 'bs58';
import { and, eq, sql } from 'drizzle-orm';
import { Keypair } from '@solana/web3.js';
import type { Config } from '../../config.ts';
import type { Db } from '../../db/client.ts';
import { agentGrants, agents, users, wallets } from '../../db/schema.ts';
import { newId } from '../../lib/ids.ts';
import { HOUSE, PRACTICE_SEASONS, currentSeason, lamportsOf as lamportsOnBooks } from '../../ledger/accounts.ts';
import { LedgerChain } from '../../ledger/ledger-chain.ts';
import type { Chain } from '../../world/chain.ts';
import { recordTx } from '../../world/ledger.ts';
import { TREASURY, signerFor, walletOf } from '../../world/wallets.ts';

/**
 * An outside agent's start grant (2026-10-28 brief §4): EXTERNAL_START_LAMPORTS (0.05 devnet SOL) sent once from the devnet
 * treasury by a plain transfer, never an airdrop. The treasury is DEVNET_TREASURY_SECRET when set, else its database wallet.
 * Only START_GRANT_FLOOR stays back in the treasury (the old 1 SOL floor silently stopped every grant once launches had
 * drained it). A grant that can't go now is logged as owed and retried after 1, 5 and 10 minutes, then by the 10-minute sweep.
 * On mainnet the grant is 0: owners fund their agents.
 */
export interface GrantDeps { db: Db; config: Config; now: () => Date; chain: Chain; key: Buffer; log?: (m: string) => void }
export type GrantResult = 'sent' | 'owed' | 'none';
export const START_GRANT_FLOOR = 50_000_000;
const FEE = 5_000;
export const RETRY_AFTER_MS = [60_000, 300_000, 600_000];

/** The treasury's signer: the env key when given (base58 or a JSON byte array), else the database's treasury wallet. */
export async function treasurySigner(d: Pick<GrantDeps, 'db' | 'config' | 'key'>): Promise<Keypair | null> {
  const s = d.config.devnetTreasurySecret;
  if (s) return Keypair.fromSecretKey(s.startsWith('[') ? Uint8Array.from(JSON.parse(s) as number[]) : bs58.decode(s));
  return (await walletOf(d.db, TREASURY)) ? signerFor(d.db, TREASURY, d.key) : null;
}

const inFlight = new Set<string>();

export async function sendStartGrant(d: GrantDeps, agentId: string): Promise<GrantResult> {
  const log = d.log ?? ((m: string) => console.warn(m));
  const lamports = d.config.external.startLamports;
  const [done] = await d.db.select({ id: agentGrants.id }).from(agentGrants).where(and(eq(agentGrants.agentId, agentId), eq(agentGrants.kind, 'start')));
  if (done) return 'sent';
  if (lamports <= 0) { await d.db.update(wallets).set({ fundedAt: d.now() }).where(eq(wallets.ownerId, agentId)); return 'none'; }
  if (inFlight.has(agentId)) return 'owed';
  inFlight.add(agentId);
  const [u] = await d.db.select({ username: users.username }).from(users).where(eq(users.id, agentId));
  const owed = (why: string): GrantResult => { log(`[fund] start grant for @${u?.username ?? agentId} owed: ${why}`); return 'owed'; };
  try {
    if (d.chain instanceof LedgerChain) return (await ledgerStartGrant(d, d.chain, agentId, lamports)) ? 'sent' : owed('the house books are short');
    const to = await walletOf(d.db, agentId);
    if (!to) return owed('the agent has no wallet yet');
    const treasury = await treasurySigner(d);
    if (!treasury) return owed('there is no treasury wallet (DEVNET_TREASURY_SECRET or npm run world:treasury)');
    const have = (await d.chain.balances(treasury.publicKey.toBase58())).lamports;
    if (have - lamports - FEE < START_GRANT_FLOOR) return owed(`the treasury ${treasury.publicKey.toBase58()} holds ${have / 1e9} SOL`);
    const r = await d.chain.sendSol(treasury, to.publicKey, lamports);
    const now = d.now();
    await recordTx(d.db, { signature: r.signature, agentId, turnId: null, kind: 'fund', counterparty: treasury.publicKey.toBase58(), lamportsDelta: lamports, createdAt: now });
    await d.db.insert(agentGrants).values({ id: newId(), agentId, lamports, kind: 'start', signature: r.signature, createdAt: now });
    await d.db.update(wallets).set({ fundedAt: now }).where(eq(wallets.ownerId, agentId));
    console.log(`[fund] start grant for @${u?.username ?? agentId}: ${lamports / 1e9} SOL (${r.signature})`);
    return 'sent';
  } catch (e) {
    return owed(`the transfer failed: ${((e as Error)?.message ?? String(e)).slice(0, 200)}`);
  } finally { inFlight.delete(agentId); }
}

/** Tries an owed grant again after 1, 5 and 10 minutes (the 10-minute sweep keeps trying after that). */
export function retrySoon(d: GrantDeps, agentId: string, delays: number[] = RETRY_AFTER_MS) {
  const [first, ...rest] = delays;
  if (first === undefined) return;
  const t = setTimeout(() => {
    void sendStartGrant(d, agentId).then((r) => { if (r === 'owed') retrySoon(d, agentId, rest); }).catch(() => undefined);
  }, first);
  t.unref?.();
}

/**
 * The start grant in a ledger world, where there is no treasury wallet (mainnet spec). Outside agents play with practice SOL
 * only: in a practice season (dev, rehearsal) the grant is a move from the house's practice books; in a real-SOL season the
 * house gives an outside agent nothing, so the grant is recorded as zero and the sweep stops asking.
 */
async function ledgerStartGrant(d: GrantDeps, chain: LedgerChain, agentId: string, lamports: number): Promise<boolean> {
  const to = await walletOf(d.db, agentId);
  if (!to) return false;
  const real = !PRACTICE_SEASONS.has(await currentSeason(d.db));
  const amount = real ? 0 : lamports, signature = `ldg_grant_${newId()}`, now = d.now();
  if (amount > 0) {
    if ((await lamportsOnBooks(d.db, HOUSE)) < amount) return false;
    await chain.transfer(HOUSE, to.publicKey, amount, 'grant', signature);
    await recordTx(d.db, { signature, agentId, turnId: null, kind: 'fund', counterparty: HOUSE, lamportsDelta: amount, createdAt: now });
  }
  await d.db.insert(agentGrants).values({ id: newId(), agentId, lamports: amount, kind: 'start', signature, createdAt: now });
  // A real-season outside agent holds nothing on the books: no funded wallet, so no START-based P&L basis either.
  if (amount > 0) await d.db.update(wallets).set({ fundedAt: now }).where(eq(wallets.ownerId, agentId));
  return true;
}

/** Active outside agents still owed their start grant: the 10-minute sweep sends them. */
export async function retryStartGrants(d: GrantDeps): Promise<number> {
  const owed = await d.db.select({ id: agents.userId }).from(agents)
    .where(and(eq(agents.origin, 'external'), eq(agents.status, 'active'),
      sql`exists (select 1 from ${wallets} where ${wallets.ownerId} = ${agents.userId})`,
      sql`not exists (select 1 from ${agentGrants} where ${agentGrants.agentId} = ${agents.userId} and ${agentGrants.kind} = 'start')`));
  let sent = 0;
  for (const a of owed) if ((await sendStartGrant(d, a.id)) === 'sent') sent++;
  return sent;
}
