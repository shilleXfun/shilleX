import { and, desc, eq, gt, gte, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { agentPersonas, agents, chainTxs, wallets, worldCoins } from '../db/schema.ts';
import { HOUSE_LAUNCH_MIN, LAUNCH_COST, MONEY_KINDS } from '../agents/decide.ts';
import type { DepthModule } from '../agents/depth/registry.ts';
import type { EngineDeps } from '../agents/engine.ts';
import type { AgentView, Candidate } from '../agents/types.ts';
import { getSetting, setSetting } from './launchpad.ts';
import { recordTx } from './ledger.ts';
import { txLeft } from './tx-budget.ts';
import { TREASURY, signerFor } from './wallets.ts';

/**
 * Hybrid trading (TRADING_MODE=hybrid, 2026-10-26, Phase 3): real coins stay on the paper desk (world/real-desk.ts) and Shillex
 * coins come back on devnet. Three rules keep that within what the owner asked for and what the free public devnet RPC can carry:
 * - every chain move spends the world's hourly chain budget (world/tx-budget.ts) and waits when it is spent, never faked;
 * - only dev agents launch: one coin a day each, and LAUNCHES_PER_DAY for all of them together;
 * - a dev short of devnet SOL for its next launch is topped up from the treasury, and a treasury running low asks the free
 *   devnet faucet (rarely: it is rate-limited).
 */
export const DEV_LAUNCH_REST_MS = 24 * 3_600_000;
const DAY_MS = 24 * 3_600_000;

/** Coins the house agents launched in the last 24 hours. */
export async function launchesToday(db: Db, now: Date): Promise<number> {
  return (await db.select({ m: worldCoins.mint }).from(worldCoins).innerJoin(agents, eq(agents.userId, worldCoins.creatorId))
    .where(and(gt(worldCoins.launchedAt, new Date(now.getTime() - DAY_MS)), inArray(agents.origin, ['wild', 'raised'])))).length;
}
/** Whether a dev may launch now: under the world's daily count, and a day since its own last coin. */
export async function mayLaunch(db: Db, agentId: string, perDay: number, now: Date): Promise<boolean> {
  if ((await launchesToday(db, now)) >= perDay) return false;
  const [last] = await db.select({ at: worldCoins.launchedAt }).from(worldCoins).where(eq(worldCoins.creatorId, agentId)).orderBy(desc(worldCoins.launchedAt)).limit(1);
  return !last || now.getTime() - last.at.getTime() >= DEV_LAUNCH_REST_MS;
}

/**
 * The engine's last word on an agent's moves while Shillex coins trade on chain: over the chain budget no money move is offered
 * (it waits for the next window), and in hybrid mode only a dev with a launch due may launch.
 */
/** Agents that may sell one coin within an hour before the rest have to wait (chainGate). */
export const HERD_SELLERS = 3;
export async function chainGate(d: EngineDeps, v: AgentView, cs: Candidate[]): Promise<Candidate[]> {
  if (!cs.some((c) => MONEY_KINDS.has(c.kind))) return cs;
  let out = cs;
  if (d.chain.network === 'devnet' && (await txLeft(d.db, d.app.deps.config.chainTxPerHour, d.now())) <= 0) out = out.filter((c) => !MONEY_KINDS.has(c.kind));
  // No stampede (2026-10-27): once HERD_SELLERS other agents sold a coin within the hour, nobody else sells it until the hour has passed.
  const selling = [...new Set(out.filter((c) => c.kind === 'sell' && c.target?.mint).map((c) => c.target!.mint!))];
  if (selling.length) {
    const crowded = new Set((await d.db.select({ m: chainTxs.mint, n: sql<number>`count(distinct ${chainTxs.agentId})::int` }).from(chainTxs)
      .where(and(inArray(chainTxs.mint, selling), eq(chainTxs.kind, 'sell'), ne(chainTxs.agentId, v.agent.id), gte(chainTxs.createdAt, new Date(d.now().getTime() - 3_600_000))))
      .groupBy(chainTxs.mint)).filter((r) => r.n >= HERD_SELLERS).map((r) => r.m));
    if (crowded.size) out = out.filter((c) => !(c.kind === 'sell' && crowded.has(c.target?.mint ?? '')));
  }
  if (v.hybrid && out.some((c) => c.kind === 'launch')) {
    const ok = v.depth.persona?.job === 'dev' && (await mayLaunch(d.db, v.agent.id, d.app.deps.config.launchesPerDay, d.now()));
    if (!ok) out = out.filter((c) => c.kind !== 'launch');
  }
  return out;
}

/** What a dev needs in its wallet to launch (decide.ts launches only from HOUSE_LAUNCH_MIN), and what a top-up brings it to. */
export const DEV_NEEDS = HOUSE_LAUNCH_MIN, DEV_TOP_UP_TO = HOUSE_LAUNCH_MIN + LAUNCH_COST + 20_000_000;
/** Below this the treasury asks the faucet for FAUCET_ASK, at most once every FAUCET_EVERY_MS. */
export const TREASURY_LOW = 500_000_000, FAUCET_ASK = 1_000_000_000, FAUCET_EVERY_MS = 6 * 3_600_000;
const FAUCET_KEY = 'faucet_asked_at';

/**
 * One dev per sweep, the one whose last coin is oldest, gets the devnet SOL its next launch needs from the treasury (a 'receive'
 * row, so the memory chain's restore counts it). Only when launches are still open today and the chain budget has room.
 */
export async function topUpDevs(d: EngineDeps): Promise<{ funded: string | null; faucet: boolean }> {
  const now = d.now();
  const out = { funded: null as string | null, faucet: false };
  if (d.chain.down || d.chain.network === 'ledger') return out;
  if ((await launchesToday(d.db, now)) >= d.app.deps.config.launchesPerDay) return out;
  if (d.chain.network === 'devnet' && (await txLeft(d.db, d.app.deps.config.chainTxPerHour, now)) <= 0) return out;
  const devs = await d.db.select({ id: agents.userId, pk: wallets.publicKey }).from(agentPersonas)
    .innerJoin(agents, eq(agents.userId, agentPersonas.agentId)).innerJoin(wallets, and(eq(wallets.ownerId, agents.userId), isNotNull(wallets.fundedAt)))
    .where(and(eq(agentPersonas.job, 'dev'), eq(agents.status, 'active')));
  if (!devs.length) return out;
  const last = new Map((await d.db.select({ id: worldCoins.creatorId, at: worldCoins.launchedAt }).from(worldCoins).where(inArray(worldCoins.creatorId, devs.map((x) => x.id))).orderBy(worldCoins.launchedAt)).map((r) => [r.id, r.at.getTime()]));
  const due = devs.filter((x) => now.getTime() - (last.get(x.id) ?? 0) >= DEV_LAUNCH_REST_MS).sort((a, b) => (last.get(a.id) ?? 0) - (last.get(b.id) ?? 0));
  for (const dev of due.slice(0, 3)) {
    const have = (await d.chain.balances(dev.pk)).lamports;
    if (have >= DEV_NEEDS) continue;
    const treasury = await signerFor(d.db, TREASURY, d.worldKey);
    const tpk = treasury.publicKey.toBase58();
    const amount = DEV_TOP_UP_TO - have;
    let left = (await d.chain.balances(tpk)).lamports;
    if (left < TREASURY_LOW && d.chain.faucet) {
      const asked = Number(await getSetting(d.db, FAUCET_KEY) ?? 0);
      if (now.getTime() - asked >= FAUCET_EVERY_MS) {
        await setSetting(d.db, FAUCET_KEY, String(now.getTime()));
        out.faucet = Boolean(await d.chain.faucet(tpk, FAUCET_ASK));
        if (out.faucet) left = (await d.chain.balances(tpk)).lamports;
      }
    }
    if (left < amount + 10_000_000) return out;
    const r = await d.chain.sendSol(treasury, dev.pk, amount);
    await recordTx(d.db, { signature: r.signature, agentId: dev.id, turnId: null, kind: 'receive', counterparty: tpk, lamportsDelta: amount, createdAt: now });
    out.funded = dev.id;
    return out;
  }
  return out;
}

export const hybridModule: DepthModule = {
  name: 'hybrid',
  async sweep(d) {
    if (d.app.deps.config.tradingMode !== 'hybrid') return;
    const r = await topUpDevs(d).catch((e) => { console.error('[hybrid] dev top-up failed', (e as Error).message); return null; });
    if (r?.funded) console.log(`[hybrid] topped up dev ${r.funded} for its next launch${r.faucet ? ' (after a faucet airdrop to the treasury)' : ''}`);
  },
};
