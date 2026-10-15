import { and, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { agents, chainTxs, ledgerAccounts, ledgerDeposits, ledgerHoldings, ledgerJournal, ledgerPools, ledgerPrices, ledgerReconciliations, ledgerSeasons, ledgerWithdrawals, wallets, worldCoins } from '../db/schema.ts';
import { RAW_PER_TOKEN } from '../world/chain.ts';
import { START_LAMPORTS, recordTx } from '../world/ledger.ts';
import { setSetting } from '../world/launchpad.ts';
import { TREASURY } from '../world/wallets.ts';
import { FROZEN_KEY, HOUSE, PRACTICE_SEASONS, SEASON_KEY, currentSeason, lamportsOf, move } from './accounts.ts';
import { books } from './books.ts';


/**
 * Each agent's devnet net worth from the world's own records (spec §10, the rehearsal's opening balances): its SOL changes
 * plus tokens at the indexer's last price. A devnet 'fund' row is the 0.1 SOL start; a memory world's airdrop left none,
 * so a funded wallet without one starts at START_LAMPORTS.
 */
export async function devnetNetWorth(db: Db): Promise<Map<string, number>> {
  const ws = await db.select({ owner: wallets.ownerId, fundedAt: wallets.fundedAt }).from(wallets).where(ne(wallets.ownerId, TREASURY));
  const sols = await db.select({ a: chainTxs.agentId, n: sql<number>`coalesce(sum(${chainTxs.lamportsDelta}), 0)::float8`, funds: sql<number>`count(*) filter (where ${chainTxs.kind} = 'fund')::int` })
    .from(chainTxs).where(isNotNull(chainTxs.agentId)).groupBy(chainTxs.agentId);
  const bags = await db.select({ a: chainTxs.agentId, mint: chainTxs.mint, raw: sql<number>`sum(${chainTxs.tokenDelta})::float8` }).from(chainTxs)
    .where(and(isNotNull(chainTxs.agentId), isNotNull(chainTxs.mint))).groupBy(chainTxs.agentId, chainTxs.mint).having(sql`sum(${chainTxs.tokenDelta}) > 0`);
  const price = new Map((await db.select({ m: worldCoins.mint, p: worldCoins.priceLamports }).from(worldCoins)).map((r) => [r.m, r.p ?? 0]));
  const out = new Map<string, number>();
  for (const w of ws) {
    const s = sols.find((r) => r.a === w.owner);
    const start = s?.funds ? 0 : w.fundedAt ? START_LAMPORTS : 0;
    const tokens = bags.filter((b) => b.a === w.owner).reduce((n, b) => n + (b.raw / RAW_PER_TOKEN) * (price.get(b.mint!) ?? 0), 0);
    out.set(w.owner, Math.max(0, Math.floor(start + (s?.n ?? 0) + tokens)));
  }
  return out;
}

/**
 * Ends the current season and starts `name` (spec §10). Every coin so far is archived (its page stays), the books start
 * empty, and the agents wait (no funded wallets) until fundOpening pays `opening` from the house. Run it with the agents
 * paused, and restart the server afterwards: a running LedgerChain caches the frozen state. Only a practice season (dev or
 * rehearsal) can end this way: a mainnet season's books hold real SOL, and wiping them would erase what owners are owed.
 */
export async function startSeason(db: Db, name: string, opening: Map<string, number>, now: Date): Promise<{ previous: string; archivedCoins: number; plan: number }> {
  const prev = await currentSeason(db);
  if (name === prev) throw new Error(`Season ${name} is already running`);
  if (!PRACTICE_SEASONS.has(prev)) throw new Error(`Season ${prev} holds real SOL on its books; it cannot be wiped by starting another season`);
  // Belt and braces: a season that ever ran with MAINNET=on holds real SOL, whatever it is called.
  const [real] = await db.select({ id: ledgerReconciliations.id }).from(ledgerReconciliations).where(and(eq(ledgerReconciliations.season, prev), eq(ledgerReconciliations.mode, 'on'))).limit(1);
  if (real) throw new Error(`Season ${prev} ran with MAINNET=on, so it holds real SOL; it cannot be wiped by starting another season`);
  const [d] = await db.select({ n: sql<number>`count(*)::int` }).from(ledgerDeposits).where(eq(ledgerDeposits.status, 'pending'));
  const [w] = await db.select({ n: sql<number>`count(*)::int` }).from(ledgerWithdrawals).where(inArray(ledgerWithdrawals.status, ['queued', 'sending']));
  if (d?.n || w?.n) throw new Error('Settle every pending deposit and withdrawal before a new season');
  const before = await books(db);
  return db.transaction(async (x) => {
    const tx = x as unknown as Db;
    await tx.insert(ledgerSeasons).values({ id: prev, startedAt: now, endedAt: null, summary: {} }).onConflictDoNothing();
    await tx.update(ledgerSeasons).set({ endedAt: now, summary: { ledgerTotal: before.ledgerTotal, ok: before.ok, mismatches: before.mismatches } }).where(eq(ledgerSeasons.id, prev));
    const archived = await tx.update(worldCoins).set({ archivedAt: now }).where(isNull(worldCoins.archivedAt)).returning({ m: worldCoins.mint });
    await tx.delete(ledgerPrices); await tx.delete(ledgerHoldings); await tx.delete(ledgerPools); await tx.delete(ledgerAccounts);
    await setSetting(tx, SEASON_KEY, name);
    await setSetting(tx, FROZEN_KEY, '');
    await tx.insert(ledgerSeasons).values({ id: name, startedAt: now, endedAt: null, summary: { opening: Object.fromEntries(opening) } });
    await tx.update(wallets).set({ fundedAt: null }).where(ne(wallets.ownerId, TREASURY));
    return { previous: prev, archivedCoins: archived.length, plan: [...opening.values()].reduce((a, b) => a + b, 0) };
  });
}

/**
 * The owner's test (MAINNET_OWNER_ONLY): sets every house agent's opening to `perAgent` lamports (those not paid yet), then
 * pays them from the house with fundOpening. The owner picks the amount on /admin after recording the stake.
 */
export async function openSeason(db: Db, perAgent: number, now: Date): Promise<{ funded: number; lamports: number }> {
  const season = await currentSeason(db);
  if (PRACTICE_SEASONS.has(season)) throw new Error(`Season ${season} is a practice season: start Season 1 first`);
  const [s] = await db.select().from(ledgerSeasons).where(eq(ledgerSeasons.id, season));
  const paid = new Set((await db.select({ ref: ledgerJournal.ref }).from(ledgerJournal).where(and(eq(ledgerJournal.season, season), eq(ledgerJournal.kind, 'opening')))).map((r) => r.ref));
  const opening: Record<string, number> = { ...(((s?.summary as { opening?: Record<string, number> } | undefined)?.opening) ?? {}) };
  for (const a of await db.select({ id: agents.userId }).from(agents).where(eq(agents.origin, 'wild'))) {
    if (!paid.has(`opening:${season}:${a.id}`)) opening[a.id] = perAgent;
  }
  await db.update(ledgerSeasons).set({ summary: { ...((s?.summary as object | undefined) ?? {}), opening } }).where(eq(ledgerSeasons.id, season));
  return fundOpening(db, now);
}

/** Pays the season's opening balances from the house, once per agent (its journal ref), then lets the agents run. */
export async function fundOpening(db: Db, now: Date): Promise<{ funded: number; lamports: number }> {
  const season = await currentSeason(db);
  const [s] = await db.select().from(ledgerSeasons).where(eq(ledgerSeasons.id, season));
  const plan = Object.entries(((s?.summary as { opening?: Record<string, number> } | undefined)?.opening) ?? {}).filter(([, l]) => l > 0);
  const refs = new Set((await db.select({ ref: ledgerJournal.ref }).from(ledgerJournal).where(and(eq(ledgerJournal.season, season), eq(ledgerJournal.kind, 'opening')))).map((r) => r.ref));
  // Outside agents (open agents) play with practice SOL only: the house pays them no opening, whatever the plan says.
  const outsiders = new Set((await db.select({ id: agents.userId }).from(agents).where(eq(agents.origin, 'external'))).map((r) => r.id));
  const todo = plan.filter(([agentId]) => !outsiders.has(agentId) && !refs.has(`opening:${season}:${agentId}`));
  const need = todo.reduce((n, [, l]) => n + l, 0), house = await lamportsOf(db, HOUSE);
  if (need > house) throw new Error(`The house holds ${house / 1e9} SOL; the openings need ${need / 1e9} SOL. Record more house stake on /admin first.`);
  for (const [agentId, lamports] of todo) {
    const [wl] = await db.select({ pk: wallets.publicKey }).from(wallets).where(eq(wallets.ownerId, agentId));
    if (!wl) continue;
    const ref = `opening:${season}:${agentId}`;
    await db.transaction(async (x) => {
      const tx = x as unknown as Db;
      await move(tx, { from: HOUSE, to: wl.pk, lamports, kind: 'opening', ref, season, at: now });
      await recordTx(tx, { signature: `ldg_${ref}`, agentId, turnId: null, kind: 'opening', lamportsDelta: lamports, createdAt: now });
    });
  }
  await db.update(wallets).set({ fundedAt: now }).where(and(ne(wallets.ownerId, TREASURY), isNull(wallets.fundedAt)));
  return { funded: todo.length, lamports: need };
}
