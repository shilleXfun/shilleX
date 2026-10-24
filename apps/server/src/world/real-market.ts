import { desc, gte, inArray } from 'drizzle-orm';
import { isValidSolanaAddress } from '@shillex/shared';
import type { Db } from '../db/client.ts';
import { realMarket, realPositions, type RealMarketRow } from '../db/schema.ts';

/**
 * Real Solana coins for the desk's paper book (2026-10-24 upgrade: "make them trade outside their coins"). DexScreener's free
 * API, no key: the boosted tokens (what is trending) plus a fixed list of established coins, priced from their deepest pair.
 * Nothing here trades: it only reads prices.
 */
export const REAL_REFRESH_MS = 3 * 60_000;
/** Established Solana coins the desk always watches, beside whatever is trending. */
export const MAJORS = [
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // BONK
  'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', // WIF
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', // JUP
  '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', // POPCAT
  '6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN', // TRUMP
  '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump', // FARTCOIN
  '2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv', // PENGU
  '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', // RAY
];
const API = 'https://api.dexscreener.com';
const num = (v: unknown, d = 0) => { const n = typeof v === 'string' ? Number(v) : v; return typeof n === 'number' && Number.isFinite(n) ? n : d; };
/** A logo only from DexScreener's own CDN, asked for at 128 px. */
const logoOf = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  try { const u = new URL(v); if (u.protocol !== 'https:' || !/(^|\.)dexscreener\.com$/.test(u.hostname)) return null; u.searchParams.set('width', '128'); u.searchParams.set('height', '128'); return u.toString(); } catch { return null; }
};
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/[\u0000-\u001f]/g, '').slice(0, max) : '');

async function getJson(url: string, fetchImpl: typeof fetch): Promise<unknown> {
  const res = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`dexscreener http ${res.status}`);
  return res.json();
}

/** Solana token addresses DexScreener is boosting now (top and latest), deduplicated. */
export async function trendingAddresses(fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const lists = await Promise.allSettled([getJson(`${API}/token-boosts/top/v1`, fetchImpl), getJson(`${API}/token-boosts/latest/v1`, fetchImpl)]);
  const out = new Set<string>();
  for (const l of lists) if (l.status === 'fulfilled' && Array.isArray(l.value)) {
    for (const t of l.value as { chainId?: unknown; tokenAddress?: unknown }[]) if (t.chainId === 'solana' && typeof t.tokenAddress === 'string' && isValidSolanaAddress(t.tokenAddress)) out.add(t.tokenAddress);
  }
  return [...out];
}

/** Each address's deepest Solana pair, as a row for real_market. Up to 30 addresses per request. */
export async function pairsFor(addresses: string[], source: (a: string) => string, now: Date, fetchImpl: typeof fetch = fetch): Promise<RealMarketRow[]> {
  const rows: RealMarketRow[] = [];
  for (let i = 0; i < addresses.length; i += 30) {
    const chunk = addresses.slice(i, i + 30);
    let data: unknown;
    try { data = await getJson(`${API}/tokens/v1/solana/${chunk.join(',')}`, fetchImpl); } catch (e) { console.warn('[real] dexscreener read failed', (e as Error).message); continue; }
    if (!Array.isArray(data)) continue;
    const best = new Map<string, any>();
    for (const p of data as any[]) {
      const a = p?.baseToken?.address;
      if (p?.chainId !== 'solana' || !chunk.includes(a) || typeof p?.pairAddress !== 'string') continue;
      if (num(p.liquidity?.usd) > num(best.get(a)?.liquidity?.usd, -1)) best.set(a, p);
    }
    for (const [a, p] of best) {
      const price = num(p.priceUsd);
      const symbol = str(p.baseToken?.symbol, 16).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      if (!(price > 0) || !symbol) continue;
      rows.push({
        address: a, symbol, name: str(p.baseToken?.name, 48) || symbol, pairAddress: p.pairAddress, dexId: str(p.dexId, 24), url: str(p.url, 200),
        priceUsd: price, liquidityUsd: num(p.liquidity?.usd), fdvUsd: p.fdv == null ? null : num(p.fdv),
        volumeH1: num(p.volume?.h1), volumeH24: num(p.volume?.h24), changeM5: num(p.priceChange?.m5) / 100, changeH1: num(p.priceChange?.h1) / 100, changeH24: num(p.priceChange?.h24) / 100,
        buysH1: Math.round(num(p.txns?.h1?.buys)), sellsH1: Math.round(num(p.txns?.h1?.sells)),
        pairCreatedAt: num(p.pairCreatedAt) ? new Date(num(p.pairCreatedAt)) : null, source: source(a), refreshedAt: now, imageUrl: logoOf(p.info?.imageUrl),
      });
    }
  }
  return rows;
}

/** Reads the trending list and the majors and stores their prices; returns how many coins it priced. */
export async function refreshRealMarket(db: Db, now: Date, fetchImpl: typeof fetch = fetch): Promise<number> {
  const trending = await trendingAddresses(fetchImpl).catch(() => [] as string[]);
  // Coins agents still hold stay priced even after they leave the trending list.
  const held = (await db.selectDistinct({ a: realPositions.address }).from(realPositions)).map((r) => r.a);
  const all = [...new Set([...MAJORS, ...trending, ...held])].slice(0, 120);
  const major = new Set(MAJORS), hot = new Set(trending);
  const rows = await pairsFor(all, (a) => (major.has(a) ? 'major' : hot.has(a) ? 'trending' : 'held'), now, fetchImpl);
  // A trending coin wearing an established coin's ticker is a copycat: it never makes the list.
  const majorSymbols = new Set(rows.filter((r) => major.has(r.address)).map((r) => r.symbol));
  const listed = rows.filter((r) => major.has(r.address) || !majorSymbols.has(r.symbol));
  for (const r of listed) { const { address: _, ...rest } = r; await db.insert(realMarket).values(r).onConflictDoUpdate({ target: realMarket.address, set: rest }); }
  return listed.length;
}

/** The coins priced in the last 15 minutes, most liquid first. */
export async function realMarketNow(db: Db, now: Date): Promise<RealMarketRow[]> {
  return db.select().from(realMarket).where(gte(realMarket.refreshedAt, new Date(now.getTime() - 15 * 60_000))).orderBy(desc(realMarket.liquidityUsd));
}

export async function realPrices(db: Db, addresses: string[]): Promise<Map<string, RealMarketRow>> {
  if (!addresses.length) return new Map();
  return new Map((await db.select().from(realMarket).where(inArray(realMarket.address, addresses))).map((r) => [r.address, r]));
}
