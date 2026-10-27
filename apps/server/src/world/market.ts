import { desc, eq, inArray } from 'drizzle-orm';
import { COIN_DECIMALS, LAMPORTS_PER_SOL, type ChainTxKind } from '@shillex/shared';
import type { Db } from '../db/client.ts';
import { chainTxs, users, worldCoins } from '../db/schema.ts';
import { RAW_PER_TOKEN, type Chain } from './chain.ts';
import { walletOf } from './wallets.ts';

const SUPPLY_TOKENS = 1_000_000_000;
const sol = (lamports: number) => lamports / LAMPORTS_PER_SOL;
const tokens = (raw: number) => raw / 10 ** COIN_DECIMALS;

/** Net raw token balance per agent for a mint, from the world's own transaction ledger. */
export async function holdersOf(db: Db, mint: string): Promise<Map<string, number>> {
  const rows = await db.select({ agentId: chainTxs.agentId, d: chainTxs.tokenDelta }).from(chainTxs).where(eq(chainTxs.mint, mint));
  const m = new Map<string, number>();
  for (const r of rows) if (r.agentId) m.set(r.agentId, (m.get(r.agentId) ?? 0) + r.d);
  for (const [k, v] of m) if (v <= 0) m.delete(k);
  return m;
}

export async function refreshCoinPrice(db: Db, chain: Chain, mint: string, now: Date): Promise<number | null> {
  return (await refreshCoinPrices(db, chain, [mint], now)).get(mint) ?? null;
}

/**
 * Reads many curves at once (chain.curves: one RPC request per 100 coins on devnet) and stores each price, progress and
 * graduation on world_coins, the cache every reader uses. Returns each refreshed coin's price; throws what the chain threw.
 */
export async function refreshCoinPrices(db: Db, chain: Chain, mints: string[], now: Date): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!mints.length) return out;
  const curves = chain.curves ? await chain.curves(mints) : new Map(await Promise.all(mints.map(async (m) => [m, await chain.curve(m)] as const)));
  const graduated = new Map((await db.select({ mint: worldCoins.mint, at: worldCoins.graduatedAt }).from(worldCoins).where(inArray(worldCoins.mint, mints))).map((r) => [r.mint, r.at]));
  for (const [mint, c] of curves) {
    if (!c) continue;
    await db.update(worldCoins).set({ priceLamports: c.priceLamports, curveProgress: c.curveProgress, refreshedAt: now, graduatedAt: c.graduated ? (graduated.get(mint) ?? now) : null }).where(eq(worldCoins.mint, mint));
    out.set(mint, c.priceLamports);
  }
  return out;
}

const usernames = async (db: Db, ids: string[]) =>
  ids.length ? new Map((await db.select({ id: users.id, u: users.username }).from(users).where(inArray(users.id, [...new Set(ids)]))).map((r) => [r.id, r.u])) : new Map<string, string>();

/** A coin as agents read it, from the cache only (world_coins, kept fresh by the indexer and every trade): no RPC request. */
export async function coinFacts(db: Db, _chain: Chain, mint: string) {
  const [coin] = await db.select().from(worldCoins).where(eq(worldCoins.mint, mint));
  if (!coin) return null;
  const holders = await holdersOf(db, mint);
  const trades = await db.select().from(chainTxs).where(eq(chainTxs.mint, mint)).orderBy(desc(chainTxs.id)).limit(20);
  const names = await usernames(db, [coin.creatorId, ...holders.keys(), ...trades.map((t) => t.agentId!).filter(Boolean)]);
  const priceSol = coin.priceLamports !== null ? sol(coin.priceLamports) : null;
  return {
    mint, pool: coin.pool, name: coin.name, symbol: coin.symbol, description: coin.description, emoji: coin.emoji,
    creatorId: coin.creatorId, creator: names.get(coin.creatorId) ?? '?', launchedAt: coin.launchedAt.toISOString(),
    priceSol, marketCapSol: priceSol === null ? null : priceSol * SUPPLY_TOKENS,
    curveProgress: coin.curveProgress, graduated: Boolean(coin.graduatedAt),
    holders: [...holders].sort((a, b) => b[1] - a[1]).map(([id, raw]) => ({ username: names.get(id) ?? '?', tokens: tokens(raw) })),
    recentTrades: trades.map((t) => ({ username: t.agentId ? (names.get(t.agentId) ?? null) : null, kind: t.kind as ChainTxKind, sol: sol(t.lamportsDelta), tokens: tokens(t.tokenDelta), at: t.createdAt.toISOString() })),
  };
}
export type CoinFacts = NonNullable<Awaited<ReturnType<typeof coinFacts>>>;

export async function walletFacts(db: Db, chain: Chain, userId: string) {
  const w = await walletOf(db, userId);
  const [u] = await db.select({ username: users.username }).from(users).where(eq(users.id, userId));
  if (!w || !u) return null;
  const bal = await chain.balances(w.publicKey);
  const coins = bal.tokens.length ? await db.select().from(worldCoins).where(inArray(worldCoins.mint, bal.tokens.map((t) => t.mint))) : [];
  const positions = bal.tokens.flatMap((t) => {
    const c = coins.find((x) => x.mint === t.mint);
    if (!c) return [];
    return [{ mint: t.mint, symbol: c.symbol, tokens: t.raw / RAW_PER_TOKEN, valueSol: c.priceLamports ? sol(c.priceLamports) * (t.raw / RAW_PER_TOKEN) : 0 }];
  });
  return { username: u.username, publicKey: w.publicKey, sol: sol(bal.lamports), positions };
}
export type WalletFacts = NonNullable<Awaited<ReturnType<typeof walletFacts>>>;
