import { useEffect, useRef, type ReactNode } from 'react';
import { useInfiniteQuery, type QueryKey } from '@tanstack/react-query';
import { AnimatePresence } from 'motion/react';
import type { Page, PostView } from '@shillex/shared';
import { get } from '../../lib/api';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Arrival, useArrivals } from '../../components/ui/Arrival';
import { WorldPost } from '../agents/WorldPost';
import { PostSkeleton } from './PostSkeleton';
import { Home } from '../home/Home';
import s from './PostCard.module.css';
import { useTitle } from '../../lib/useTitle';

/** A visitor at the top of the feed is polled; one who has paged on is not (every loaded page would refetch). Home's new posts arrive through LivePostsPill. */
export const publicFeedInterval = (q: { state: { data?: { pages: unknown[] } } }) => ((q.state.data?.pages.length ?? 0) > 1 ? false : 10_000);

/**
 * A read-only page of public posts (`GET /api/feed/public`, optionally `?author=`): FeedList's loading, paging and arrival
 * motion, with cards that need no account. Its first page is polled every 10 s (see `publicFeedInterval`).
 */
export function PublicFeed({ queryKey, path, empty, renderItem }: { queryKey: QueryKey; path: string; empty: ReactNode; renderItem?: (p: PostView) => ReactNode }) {
  const q = useInfiniteQuery({
    queryKey, initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => get<Page<PostView>>(`${path}${pageParam ? `${path.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(pageParam)}` : ''}`, signal),
    getNextPageParam: (last) => last.nextCursor, refetchInterval: publicFeedInterval, refetchIntervalInBackground: false,
  });
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = q;
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
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
      <AnimatePresence initial={false}>
        {items.map((p, i) => <Arrival key={p.id} as={arrival(p.id, i)} glow={p.mints.length ? 'token' : 'accent'}>{renderItem ? renderItem(p) : <WorldPost post={p} />}</Arrival>)}
      </AnimatePresence>
      <div ref={sentinel} style={{ height: 1 }} />
      {isFetchingNextPage && <div aria-label="Loading more" role="status"><PostSkeleton /><PostSkeleton lines={1} /></div>}
      {isFetchNextPageError && <ErrorState title="Couldn’t load more" error={q.error} onRetry={() => void fetchNextPage()} />}
      {!hasNextPage && items.length > 10 && <p className={s.endNote}>You’re all caught up.</p>}
    </div>
  );
}

/** Home for a visitor: the same page, read-only, with a way in where the composer would be. */
export function PublicHome() {
  useTitle('Feed');
  return <Home authed={false} />;
}
