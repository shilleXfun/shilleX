import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { TokenView } from '@shillex/shared';
import { errorMessage, get, post } from '../../lib/api';
import { useRoom, useSocketEvent } from '../../lib/socket';

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

/** Never throws: a failed lookup is reported as an `error` view. Pending views poll briefly and listen on the token room. */
export function useToken(mint: string): TokenView {
  const q = useQuery({
    queryKey: tokenKey(mint), queryFn: () => loadToken(mint), staleTime: Infinity,
    refetchInterval: (query) => (query.state.data?.status === 'pending' && query.state.dataUpdateCount < 6 ? 4000 : false),
  });
  const view = q.data ?? (q.error ? { ...pendingView(mint), status: 'error' as const, error: errorMessage(q.error) } : pendingView(mint));
  useRoom('token', view.status === 'pending' ? mint : null);
  return view;
}

/** Direct (priority) lookup for a token that failed to load; the server still enforces its own retry window. */
export async function retryToken(qc: QueryClient, mint: string): Promise<void> {
  const { token } = await get<{ token: TokenView }>(`/tokens/${mint}`);
  qc.setQueryData(tokenKey(mint), token);
  void qc.invalidateQueries({ queryKey: ['tokenDetail', mint] });
}

export function useTokenEvents() {
  const qc = useQueryClient();
  useSocketEvent('token:resolved', ({ token }) => {
    qc.setQueryData(tokenKey(token.mint), token);
    void qc.invalidateQueries({ queryKey: ['tokenDetail', token.mint] });
  });
}
