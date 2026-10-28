/**
 * Counts every request the agents' chain sends to its RPC (2026-10-27): the owner has about a million Helius credits, so the burn
 * must be visible. web3.js hands each HTTP call to this fetch, a JSON-RPC body of one call or a batch; each call is counted by
 * method, and each 429 answer too. Once an hour the counts are logged and start again; /api/health/world shows the last hour.
 * Most standard calls cost one Helius credit, so requests ≈ credits; the split by method lets the dashboard check it.
 */
export interface RpcHour { requests: number; byMethod: Record<string, number>; rateLimited: number; from: string }
export interface RpcMeter {
  fetch: typeof fetch;
  /** The hour so far, and the last full hour. */
  state(): { current: RpcHour; lastHour: RpcHour | null; lastRateLimitedAt: string | null };
  stop(): void;
}

const HOUR = 3_600_000;

export function createRpcMeter(now: () => Date = () => new Date(), log: (m: string) => void = (m) => console.log(m), inner: typeof fetch = fetch, label = 'rpc'): RpcMeter {
  const fresh = (): RpcHour => ({ requests: 0, byMethod: {}, rateLimited: 0, from: now().toISOString() });
  let current = fresh(), lastHour: RpcHour | null = null, lastRateLimitedAt: string | null = null;
  const timer = setInterval(() => {
    lastHour = current;
    current = fresh();
    if (!lastHour.requests && !lastHour.rateLimited) return;
    const top = Object.entries(lastHour.byMethod).sort((a, b) => b[1] - a[1]).map(([m, n]) => `${m} ${n}`).join(', ');
    log(`[${label}] last hour: ${lastHour.requests} requests ≈ ${lastHour.requests} credits (${top}), 429s: ${lastHour.rateLimited}`);
  }, HOUR);
  timer.unref?.();
  const counted: typeof fetch = async (input, init) => {
    try {
      const body = JSON.parse(String(init?.body ?? 'null')) as unknown;
      for (const call of Array.isArray(body) ? body : [body]) {
        const method = typeof (call as { method?: unknown })?.method === 'string' ? (call as { method: string }).method : 'unknown';
        current.requests++;
        current.byMethod[method] = (current.byMethod[method] ?? 0) + 1;
      }
    } catch { current.requests++; current.byMethod.unknown = (current.byMethod.unknown ?? 0) + 1; }
    const res = await inner(input, init);
    if (res.status === 429) { current.rateLimited++; lastRateLimitedAt = now().toISOString(); }
    return res;
  };
  return { fetch: counted, state: () => ({ current, lastHour, lastRateLimitedAt }), stop: () => clearInterval(timer) };
}

/** The agents' chain's meter (one per process, like its connection); started by the first devnet connection. */
let meter: RpcMeter | null = null;
export const rpcMeter = () => (meter ??= createRpcMeter());
export const rpcMeterState = () => meter?.state() ?? null;

/** Real SOL's mainnet RPC (HELIUS_MAINNET_RPC_URL), counted on its own: its hourly line reads [rpc mainnet]. */
let mainnet: RpcMeter | null = null;
export const mainnetMeter = () => (mainnet ??= createRpcMeter(undefined, undefined, undefined, 'rpc mainnet'));
export const mainnetMeterState = () => mainnet?.state() ?? null;
