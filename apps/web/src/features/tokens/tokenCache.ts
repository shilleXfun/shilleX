import { useEffect } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { TokenView } from '@shillex/shared';
import { ApiError, errorMessage, get, post } from '../../lib/api';
import { socket, useRoom, useSocketEvent } from '../../lib/socket';

export const tokenKey = (mint: string) => ['token', mint] as const;
export const pendingView = (mint: string): TokenView => ({ mint, status: 'pending', source: null, name: null, symbol: null, imageUrl: null, decimals: null, liquidityUsd: null, marketCapUsd: null, fdvUsd: null, pairAddress: null, dexId: null, pairCreatedAt: null, promoted: false, fetchedAt: null, error: null });

const rank = (t: TokenView) => (t.status === 'pending' ? 0 : 1);
/** Seeds the token cache from a response's `tokens` map without regressing a known view to pending or to older data. */
export function primeTokens(qc: QueryClient, tokens?: Record<string, TokenView>) {
  if (!tokens) return;
  for (const [mint, v] of Object.entries(tokens)) {
    const prev = qc.getQueryData<TokenView>(tokenKey(mint));
    if (!prev || rank(v) > rank(prev) || (rank(v) === rank(prev) && (v.fetchedAt ?? '') >= (prev.fetchedAt ?? ''))) qc.setQueryData(tokenKey(mint), v);
  }
}

// Chips mounting in the same tick are coalesced into batched POST /tokens/resolve calls (server max 25 per call).
let queue = new Map<string, { resolve: (v: TokenView) => void; reject: (e: unknown) => void }[]>();
let timer: ReturnType<typeof setTimeout> | null = null;
function flush() {
  const batch = queue; queue = new Map(); timer = null;
  const mints = [...batch.keys()];
  for (let i = 0; i < mints.length; i += 25) {
    const chunk = mints.slice(i, i + 25);
    post<{ tokens: Record<string, TokenView> }>('/tokens/resolve', { mints: chunk })
      .then((r) => chunk.forEach((m) => batch.get(m)!.forEach((w) => w.resolve(r.tokens[m] ?? pendingView(m)))))
      .catch((e) => chunk.forEach((m) => batch.get(m)!.forEach((w) => w.reject(e))));
  }
}
function loadToken(mint: string): Promise<TokenView> {
  return new Promise((resolve, reject) => {
    queue.set(mint, [...(queue.get(mint) ?? []), { resolve, reject }]);
    timer ??= setTimeout(flush, 15);
  });
}

const POLL_MS = 4000;
const MAX_LOOKUPS = 6;
/**
 * Delay to the next shared wall-clock tick (a multiple of POLL_MS). Every pending chip polls on the same tick, so their
 * refetches land in the same 15 ms batch window and go out as one request. Too close to a tick → skip to the next one.
 */
export function msToNextPollTick(now = Date.now()): number {
  const r = POLL_MS - (now % POLL_MS);
  return r < 500 ? r + POLL_MS : r;
}
const unresolved = (t: TokenView | undefined) => !t || t.status === 'pending';

/** Never throws: a failed lookup is reported as an `error` view. Unresolved tokens poll briefly and listen on the token room. */
export function useToken(mint: string): TokenView {
  const q = useQuery({
    queryKey: tokenKey(mint), queryFn: () => loadToken(mint), staleTime: Infinity,
    retry: false, // polling is the retry; per-query retries would multiply requests against the server's rate limit
    refetchInterval: (query) => {
      const { data, error, dataUpdateCount, errorUpdateCount } = query.state;
      if (!unresolved(data)) return false;
      if (error instanceof ApiError && error.status === 429) return false; // the socket push still updates it
      if (dataUpdateCount + errorUpdateCount >= MAX_LOOKUPS) return false;
      return msToNextPollTick();
    },
  });
  const view = unresolved(q.data) && q.error ? { ...pendingView(mint), status: 'error' as const, error: errorMessage(q.error) } : (q.data ?? pendingView(mint));
  useRoom('token', unresolved(q.data) ? mint : null);
  return view;
}

/** Direct (priority) lookup for a token that failed to load; the server still enforces its own retry window. */
export async function retryToken(qc: QueryClient, mint: string): Promise<void> {
  const { token } = await get<{ token: TokenView }>(`/tokens/${mint}`);
  qc.setQueryData(tokenKey(mint), token);
  void qc.invalidateQueries({ queryKey: ['tokenDetail', mint] });
}

/** Global listener (mounted once in AppShell): applies pushed token views and recovers pushes missed while offline. */
export function useTokenEvents() {
  const qc = useQueryClient();
  useSocketEvent('token:resolved', ({ token }) => {
    primeTokens(qc, { [token.mint]: token });
    void qc.invalidateQueries({ queryKey: ['tokenDetail', token.mint] });
  });
  useEffect(() => {
    const onConnect = () => void qc.invalidateQueries({ queryKey: ['token'], predicate: (q) => unresolved(q.state.data as TokenView | undefined) });
    socket.on('connect', onConnect);
    return () => { socket.off('connect', onConnect); };
  }, [qc]);
}
