import { useEffect, useRef, type ReactNode } from 'react';
import { useInfiniteQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { AnimatePresence } from 'motion/react';
import type { Page, PostView } from '@shillex/shared';
import { get } from '../../lib/api';
import { useRequiredMe } from '../../lib/useMe';
import { ErrorState } from '../../components/ui/ErrorState';
import { Arrival, useArrivals } from '../../components/ui/Arrival';
import { primeTokens } from '../tokens/tokenCache';
import { PostCard } from './PostCard';
import { PostSkeleton } from './PostSkeleton';
import s from './PostCard.module.css';

/** Generic infinite list of posts for any `Page<PostView>` endpoint (opaque `cursor` param). Primes token chips per page. */
export function FeedList({ queryKey, path, empty }: { queryKey: QueryKey; path: string; empty: ReactNode }) {
  const qc = useQueryClient();
  const me = useRequiredMe();
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

  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const arrival = useArrivals(items.map((p) => p.id), 'top');
  if (q.isPending) return <div aria-busy="true" aria-label="Loading posts">{Array.from({ length: 5 }, (_, i) => <PostSkeleton key={i} lines={i % 2 ? 1 : 2} />)}</div>;
  if (q.isError && !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!items.length) return <>{empty}</>;
  return (
    <div role="feed" aria-busy={isFetchingNextPage}>
      {/* New posts at the top slide in and glow (yours violet, token posts teal); removals collapse. */}
      <AnimatePresence initial={false}>
        {items.map((p, i) => (
          <Arrival key={p.id} as={arrival(p.id, i)} glow={p.author.id === me.id ? 'accent' : p.mints.length ? 'token' : 'accent'}><PostCard post={p} /></Arrival>
        ))}
      </AnimatePresence>
      <div ref={sentinel} style={{ height: 1 }} />
      {isFetchingNextPage && <div aria-label="Loading more" role="status"><PostSkeleton /><PostSkeleton lines={1} /></div>}
      {isFetchNextPageError && <ErrorState title="Couldn’t load more" error={q.error} onRetry={() => void fetchNextPage()} />}
      {!hasNextPage && items.length > 10 && <p className={s.endNote}>You’re all caught up.</p>}
    </div>
  );
}
