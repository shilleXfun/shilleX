/**
 * Every DexScreener read goes through here (2026-10-27: the market refresh's back-to-back chunks drew 429s from Railway's shared
 * IP, and nothing backed off). At most one request a second; the same URL within a minute is answered from memory; a 429 stops
 * reads for 30 s, then 1, 2, 4… minutes up to 15, and is logged once per backoff. Callers keep the rows they already stored.
 * One limiter per fetch function, so the process shares one and a test's mock gets its own.
 */
export const DEX_GAP_MS = 1000, DEX_CACHE_MS = 60_000;
const BACKOFF_MS = 30_000, BACKOFF_MAX_MS = 15 * 60_000, CACHE_MAX = 500;

/** DexScreener is backing off after a 429: nothing was sent. */
export class DexCooling extends Error {}

export interface DexLimiter { get(url: string, timeoutMs?: number): Promise<unknown> }

export function createDexLimiter(fetchImpl: typeof fetch, opts: { now?: () => number; gapMs?: number; log?: (m: string) => void } = {}): DexLimiter {
  const now = opts.now ?? Date.now, gapMs = opts.gapMs ?? DEX_GAP_MS, log = opts.log ?? ((m: string) => console.warn(m));
  const cache = new Map<string, { at: number; body: unknown }>();
  let nextAt = 0, coolUntil = 0, strikes = 0;
  return {
    async get(url, timeoutMs = 10_000) {
      const hit = cache.get(url);
      if (hit && now() - hit.at < DEX_CACHE_MS) return hit.body;
      if (now() < coolUntil) throw new DexCooling(`dexscreener backing off until ${new Date(coolUntil).toISOString()}`);
      const t = now(), at = Math.max(t, nextAt);
      nextAt = at + gapMs;
      if (at > t) await new Promise((r) => setTimeout(r, at - t));
      const res = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 429) {
        const wait = Math.min(BACKOFF_MS * 2 ** strikes, BACKOFF_MAX_MS);
        strikes++;
        coolUntil = now() + wait;
        log(`[dex] DexScreener answered 429; no reads for ${Math.round(wait / 1000)} s`);
        throw new Error('dexscreener http 429');
      }
      if (!res.ok) throw new Error(`dexscreener http ${res.status}`);
      const body = await res.json();
      strikes = 0;
      for (const [k, v] of cache) if (now() - v.at >= DEX_CACHE_MS) cache.delete(k);
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
      cache.set(url, { at: now(), body });
      return body;
    },
  };
}

const limiters = new WeakMap<typeof fetch, DexLimiter>();
export function dexLimiter(fetchImpl: typeof fetch = fetch): DexLimiter {
  let l = limiters.get(fetchImpl);
  if (!l) { l = createDexLimiter(fetchImpl); limiters.set(fetchImpl, l); }
  return l;
}
