import { useEffect, useRef, type ReactNode } from 'react';
import { useInfiniteQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { Page, PostView } from '@shillex/shared';
import { get } from '../../lib/api';
import { ErrorState } from '../../components/ui/ErrorState';
import { Spinner } from '../../components/ui/Spinner';
import { primeTokens } from '../tokens/tokenCache';
import { PostCard } from './PostCard';
import { PostSkeleton } from './PostSkeleton';

/** Generic infinite list of posts for any `Page<PostView>` endpoint (opaque `cursor` param). Primes token chips per page. */
export function FeedList({ queryKey, path, empty }: { queryKey: QueryKey; path: string; empty: ReactNode }) {
  const qc = useQueryClient();
  const q = useInfiniteQuery({
    queryKey, initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const sep = path.includes('?') ? '&' : '?';
      const page = await get<Page<PostView>>(`${path}${pageParam ? `${sep}cursor=${encodeURIComponent(pageParam)}` : ''}`, signal);
      primeTokens(qc, page.tokens);
      return page;
    },
    getNextPageParam: (last) => last.nextCursor,
  });
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = q;
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    // A failed page load stops auto-loading; the inline retry button takes over.
    if (!el || !hasNextPage || isFetchNextPageError) return;
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting && !isFetchingNextPage) void fetchNextPage(); }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);

  if (q.isPending) return <div aria-busy="true" aria-label="Loading posts">{Array.from({ length: 5 }, (_, i) => <PostSkeleton key={i} />)}</div>;
  if (q.isError && !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const items = q.data.pages.flatMap((p) => p.items);
  if (!items.length) return <>{empty}</>;
  return (
    <div role="feed" aria-busy={isFetchingNextPage}>
      {items.map((p) => <PostCard key={p.id} post={p} />)}
      <div ref={sentinel} style={{ height: 1 }} />
      {isFetchingNextPage && <div style={{ display: 'grid', placeItems: 'center', padding: 16 }}><Spinner label="Loading more" /></div>}
      {isFetchNextPageError && <ErrorState title="Couldn’t load more" error={q.error} onRetry={() => void fetchNextPage()} />}
      {!hasNextPage && items.length > 10 && <p style={{ textAlign: 'center', color: 'var(--muted)', padding: 20, margin: 0 }}>You’re all caught up.</p>}
    </div>
  );
}
