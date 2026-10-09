import { eq } from 'drizzle-orm';
import { COPY, isValidSolanaAddress, type TokenView } from '@shillex/shared';
import type { Db } from '../db/client.ts';
import type { EventBus, TokenResolverPort } from '../deps.ts';
import { tokens, type TokenRow } from '../db/schema.ts';
import { fetchMintAccount } from './rpc.ts';
import { fetchDexBest } from './dexscreener.ts';
import { isStale, pendingTokenView, readTokenViews, tokenRowToView, ERROR_RETRY_MS } from './view.ts';

export interface ResolverOptions { db: Db; bus: EventBus; rpcUrl: string; live: boolean; fetchImpl?: typeof fetch; now?: () => Date; concurrency?: number }

export class TokenResolver implements TokenResolverPort {
  private inflight = new Map<string, Promise<TokenView>>();
  private failedRefresh = new Map<string, number>(); // mint -> time of last failed refresh of a good row
  private waiting: Array<() => void> = [];
  private active = 0;
  private fetchImpl: typeof fetch;
  private now: () => Date;
  constructor(private o: ResolverOptions) {
    this.fetchImpl = o.fetchImpl ?? fetch;
    this.now = o.now ?? (() => new Date());
  }

  async getViews(mints: string[]): Promise<Record<string, TokenView>> {
    const { views, missing, stale } = await readTokenViews(this.o.db, mints, this.now());
    this.enqueue([...missing, ...stale]);
    return views;
  }

  enqueue(mints: string[]): void {
    for (const m of new Set(mints)) {
      if (!isValidSolanaAddress(m) || this.inflight.has(m)) continue;
      void this.resolve(m).catch(() => undefined);
    }
  }

  resolve(mint: string): Promise<TokenView> {
    const existing = this.inflight.get(mint);
    if (existing) return existing;
    const p = this.schedule(() => this.doResolve(mint)).finally(() => this.inflight.delete(mint));
    this.inflight.set(mint, p);
    return p;
  }

  /** Resolves when no lookups are running or queued (tests and graceful shutdown). */
  async idle(): Promise<void> {
    while (this.inflight.size) await Promise.allSettled([...this.inflight.values()]);
  }

  private async schedule<T>(fn: () => Promise<T>): Promise<T> {
    const limit = this.o.concurrency ?? 4;
    if (this.active >= limit) await new Promise<void>((r) => this.waiting.push(r));
    this.active++;
    try { return await fn(); } finally { this.active--; this.waiting.shift()?.(); }
  }

  private async doResolve(mint: string): Promise<TokenView> {
    const { db } = this.o;
    const now = this.now();
    const [row] = await db.select().from(tokens).where(eq(tokens.mint, mint)).limit(1);
    if (row && !isStale(row, now)) return tokenRowToView(row);
    if (row && (row.status === 'resolved' || row.status === 'unindexed')) {
      const failedAt = this.failedRefresh.get(mint);
      if (failedAt && now.getTime() - failedAt < ERROR_RETRY_MS) return tokenRowToView(row);
    }
    if (!this.o.live) return row ? tokenRowToView(row) : { ...pendingTokenView(mint), status: 'error', error: COPY.liveLookupDisabled };

    try {
      if (row && (row.status === 'resolved' || row.status === 'unindexed')) {
        const dex = await fetchDexBest(mint, this.fetchImpl);
        const next: Partial<TokenRow> = dex ? this.fromDex(dex, row) : { fetchedAt: now };
        return this.save(mint, { ...row, ...next, status: dex ? 'resolved' : row.status, fetchedAt: now, error: null }, row);
      }
      const acct = await fetchMintAccount(this.o.rpcUrl, mint, this.fetchImpl);
      if (acct.kind === 'not_mint') return this.save(mint, { mint, source: 'live', status: 'not_a_token', fetchedAt: now, metaFetchedAt: now, error: null }, row);
      const dex = await fetchDexBest(mint, this.fetchImpl);
      const base: Partial<TokenRow> = { mint, source: 'live', decimals: acct.decimals, name: acct.name, symbol: acct.symbol, fetchedAt: now, metaFetchedAt: now, error: null };
      return this.save(mint, dex ? { ...base, ...this.fromDex(dex, base), status: 'resolved' } : { ...base, status: 'unindexed' }, row);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'lookup failed';
      if (row && (row.status === 'resolved' || row.status === 'unindexed')) {
        this.failedRefresh.set(mint, now.getTime());
        return tokenRowToView(row);
      }
      return this.save(mint, { mint, source: 'live', status: 'error', error: message.slice(0, 200), fetchedAt: now }, row);
    }
  }

  private fromDex(dex: NonNullable<Awaited<ReturnType<typeof fetchDexBest>>>, prev: Partial<TokenRow>): Partial<TokenRow> {
    return {
      name: prev.name ?? dex.name, symbol: prev.symbol ?? dex.symbol, imageUrl: dex.imageUrl ?? prev.imageUrl ?? null,
      liquidityUsd: dex.liquidityUsd, marketCapUsd: dex.marketCapUsd, fdvUsd: dex.fdvUsd,
      pairAddress: dex.pairAddress, dexId: dex.dexId, pairCreatedAt: dex.pairCreatedAt,
    };
  }

  private async save(mint: string, values: Partial<TokenRow>, prev: TokenRow | undefined): Promise<TokenView> {
    const { db } = this.o;
    const full = { mint, status: values.status!, ...values } as typeof tokens.$inferInsert;
    const { mint: _m, ...set } = full;
    const [saved] = await db.insert(tokens).values(full).onConflictDoUpdate({ target: tokens.mint, set }).returning();
    const view = tokenRowToView(saved!);
    this.failedRefresh.delete(mint);
    if (!prev || prev.status !== saved!.status || prev.fetchedAt?.getTime() !== saved!.fetchedAt?.getTime()) {
      this.o.bus.toRoom(`token:${mint}`, 'token:resolved', { token: view });
    }
    return view;
  }
}
