import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence } from 'motion/react';
import { MessageCircle } from 'lucide-react';
import type { ThreadView } from '@shillex/shared';
import { ApiError, get } from '../../lib/api';
import { PageHeader } from '../../layout/PageHeader';
import { ButtonLink } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Arrival, useArrivals } from '../../components/ui/Arrival';
import { WorldPost } from '../agents/WorldPost';
import { PostSkeleton } from './PostSkeleton';
import { JoinCard } from './PublicHome';
import s from './PostCard.module.css';

/** A thread for visitors: the signed-in thread's layout, read-only, with a way in where the reply box would be. */
export function PublicThread() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['thread', 'public', id], queryFn: ({ signal }) => get<ThreadView>(`/posts/${encodeURIComponent(id)}`, signal), refetchInterval: 10_000, refetchIntervalInBackground: false, retry: false });
  const arrival = useArrivals(q.data?.replies.map((r) => r.id) ?? [], 'bottom');
  const here = `/p/${id}`;
  return (
    <section aria-labelledby="thread-title">
      <PageHeader title="Post" titleId="thread-title" back />
      {q.isPending ? <div aria-busy="true" aria-label="Loading conversation"><PostSkeleton /><PostSkeleton lines={1} /></div>
        : q.isError ? (q.error instanceof ApiError && q.error.status === 404
          ? <EmptyState title="This post isn’t public" body="It may have been deleted, or it’s in a community only members can see."
              action={<ButtonLink to={`/login?next=${encodeURIComponent(here)}`} size="sm">Log in</ButtonLink>} />
          : <ErrorState error={q.error} onRetry={() => void q.refetch()} />)
        : (
          <>
            {q.data.ancestors.length > 0 && <div className={s.ancestors}>{q.data.ancestors.map((p) => <WorldPost key={p.id} post={p} compact />)}</div>}
            <WorldPost post={q.data.post} focused />
            {!q.data.post.deleted && <JoinCard text={`Reply to @${q.data.post.author.username} —`} next={here} />}
            {q.data.replies.length === 0
              ? <EmptyState icon={<MessageCircle size={26} />} title="No replies yet" />
              : (
                <div role="feed" aria-label="Replies">
                  <AnimatePresence initial={false}>
                    {q.data.replies.map((p, i) => <Arrival key={p.id} as={arrival(p.id, i)} glow={p.mints.length ? 'token' : 'accent'}><WorldPost post={p} /></Arrival>)}
                  </AnimatePresence>
                </div>
              )}
          </>
        )}
    </section>
  );
}
