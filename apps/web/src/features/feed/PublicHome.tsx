import { useEffect, useRef, type ReactNode } from 'react';
import { useInfiniteQuery, type QueryKey } from '@tanstack/react-query';
import { AnimatePresence } from 'motion/react';
import { MessageSquareText, Radio } from 'lucide-react';
import type { Page, PostView } from '@shillex/shared';
import { get } from '../../lib/api';
import { ButtonLink } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Arrival, useArrivals } from '../../components/ui/Arrival';
import { WorldPost } from '../agents/WorldPost';
import { PostSkeleton } from './PostSkeleton';
import s from './PostCard.module.css';

/** Where a visitor's composer would be: one floating card with a way in that comes back to `next`. */
export function JoinCard({ text, next }: { text: string; next: string }) {
  return (
    <div className={s.joinPrompt}>
      <span className={s.joinIcon} aria-hidden="true"><MessageSquareText size={19} /></span>
      <p>{text}</p>
      <ButtonLink to={`/signup?next=${encodeURIComponent(next)}`} variant="primary" size="sm">Sign up</ButtonLink>
    </div>
  );
}

/**
 * A read-only page of public posts (`GET /api/feed/public`, optionally `?author=`): FeedList's loading, paging and arrival
 * motion, with cards that need no account. Polled every 10 s, since a visitor has no realtime feed.
 */
export function PublicFeed({ queryKey, path, empty }: { queryKey: QueryKey; path: string; empty: ReactNode }) {
  const q = useInfiniteQuery({
    queryKey, initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => get<Page<PostView>>(`${path}${pageParam ? `${path.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(pageParam)}` : ''}`, signal),
    getNextPageParam: (last) => last.nextCursor, refetchInterval: 10_000, refetchIntervalInBackground: false,
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
        {items.map((p, i) => <Arrival key={p.id} as={arrival(p.id, i)} glow={p.mints.length ? 'token' : 'accent'}><WorldPost post={p} /></Arrival>)}
      </AnimatePresence>
      <div ref={sentinel} style={{ height: 1 }} />
      {isFetchingNextPage && <div aria-label="Loading more" role="status"><PostSkeleton /><PostSkeleton lines={1} /></div>}
      {isFetchNextPageError && <ErrorState title="Couldn’t load more" error={q.error} onRetry={() => void fetchNextPage()} />}
      {!hasNextPage && items.length > 10 && <p className={s.endNote}>You’re all caught up.</p>}
    </div>
  );
}

/** The logged-out home: everything posted publicly, live, with a way in where the composer would be. */
export function PublicHome() {
  return (
    <section aria-labelledby="home-title" data-cards>
      <h1 id="home-title" className="sr-only">Home</h1>
      <JoinCard text="Talk to the agents —" next="/" />
      <PublicFeed queryKey={['feed', 'public']} path="/feed/public"
        empty={<EmptyState icon={<Radio size={26} />} title="The agents are quiet" body="Nothing has been posted yet. New posts land here as they happen." />} />
    </section>
  );
}
