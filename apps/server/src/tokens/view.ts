import { inArray } from 'drizzle-orm';
import type { TokenView } from '@shillex/shared';
import type { Db } from '../db/client.ts';
import { tokens, type TokenRow } from '../db/schema.ts';

export const MARKET_TTL_MS = 5 * 60_000;
export const ERROR_RETRY_MS = 60_000;

export function pendingTokenView(mint: string): TokenView {
  return { mint, status: 'pending', source: null, name: null, symbol: null, imageUrl: null, decimals: null, liquidityUsd: null,
    marketCapUsd: null, fdvUsd: null, pairAddress: null, dexId: null, pairCreatedAt: null, promoted: false, fetchedAt: null, error: null };
}

export function tokenRowToView(r: TokenRow): TokenView {
  return {
    mint: r.mint, status: r.status, source: r.source ?? null, name: r.name, symbol: r.symbol,
    imageUrl: r.imageUrl ?? (r.source === 'demo' ? `/media/token/${r.mint}.svg` : null),
    decimals: r.decimals, liquidityUsd: r.liquidityUsd, marketCapUsd: r.marketCapUsd, fdvUsd: r.fdvUsd,
    pairAddress: r.pairAddress, dexId: r.dexId, pairCreatedAt: r.pairCreatedAt?.toISOString() ?? null,
    promoted: r.promoted, fetchedAt: r.fetchedAt?.toISOString() ?? null, error: r.error,
  };
}

export function isStale(r: TokenRow, now: Date): boolean {
  if (r.source === 'demo' || r.status === 'not_a_token') return false;
  const age = now.getTime() - (r.fetchedAt?.getTime() ?? 0);
  if (r.status === 'error') return age > ERROR_RETRY_MS;
  return age > MARKET_TTL_MS;
}

export async function readTokenViews(db: Db, mints: string[], now: Date = new Date()) {
  const uniq = [...new Set(mints)];
  const rows = uniq.length ? await db.select().from(tokens).where(inArray(tokens.mint, uniq)) : [];
  const byMint = new Map(rows.map((r) => [r.mint, r]));
  const views: Record<string, TokenView> = {};
  const missing: string[] = []; const stale: string[] = [];
  for (const m of uniq) {
    const r = byMint.get(m);
    if (!r) { views[m] = pendingTokenView(m); missing.push(m); continue; }
    views[m] = tokenRowToView(r);
    if (isStale(r, now)) stale.push(m);
  }
  return { views, missing, stale };
}
