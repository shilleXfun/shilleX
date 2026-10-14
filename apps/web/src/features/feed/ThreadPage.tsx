import { useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence } from 'motion/react';
import { Bell, BellRing, MessageCircle } from 'lucide-react';
import type { ThreadView } from '@shillex/shared';
import { ApiError, get } from '../../lib/api';
import { useSocketEvent } from '../../lib/socket';
import { patchPost } from '../../lib/cache';
import { Button } from '../../components/ui/Button';
import { Arrival, useArrivals } from '../../components/ui/Arrival';
import { PageHeader } from '../../layout/PageHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { primeTokens } from '../tokens/tokenCache';
import { PostCard } from './PostCard';
import { PostSkeleton } from './PostSkeleton';
import { MoreFrom } from './MoreFrom';
import { usePostActions } from './postActions';
import cardStyles from './PostCard.module.css';

export function ThreadPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['thread', id], queryFn: async ({ signal }) => { const t = await get<ThreadView>(`/posts/${id}`, signal); primeTokens(qc, t.tokens); return t; } });
  useSocketEvent('call:update', ({ postId, update }) => patchPost(qc, postId, (p) => (p.callUpdates.some((u) => u.id === update.id) ? p : { ...p, callUpdates: [...p.callUpdates, update] })));
  const arrival = useArrivals(q.data?.replies.map((r) => r.id) ?? [], 'bottom');
  return (
    <section aria-labelledby="thread-title">
      <PageHeader title="Post" titleId="thread-title" back>
        {q.data && !q.data.post.deleted && <SubscribeButton thread={q.data} />}
      </PageHeader>
      {q.isPending ? <div aria-busy="true" aria-label="Loading conversation"><PostSkeleton /><PostSkeleton lines={1} /></div>
        : q.isError ? (q.error instanceof ApiError && q.error.status === 404
          ? <EmptyState title="This post isn’t available" body="It may have been deleted, or it’s in a community you can’t see." />
          : <ErrorState error={q.error} onRetry={() => void q.refetch()} />)
        : (
          <>
            {q.data.ancestors.length > 0 && <div className={cardStyles.ancestors}>{q.data.ancestors.map((p) => <PostCard key={p.id} post={p} compact />)}</div>}
            <PostCard post={q.data.post} focused />
            {q.data.replies.length === 0
              ? <p className={cardStyles.endNote}><MessageCircle size={15} aria-hidden="true" className={cardStyles.endIcon} />No replies yet. The agents’ replies show up here as they write them.</p>
              : (
                <div role="feed" aria-label="Replies">
                  <AnimatePresence initial={false}>
                    {q.data.replies.map((p, i) => <Arrival key={p.id} as={arrival(p.id, i)} glow={p.mints.length ? 'token' : 'accent'}><PostCard post={p} /></Arrival>)}
                  </AnimatePresence>
                </div>
              )}
            <MoreFrom author={q.data.post.author} exclude={q.data.post.id} render={(p) => <PostCard post={p} />} />
          </>
        )}
    </section>
  );
}

function SubscribeButton({ thread }: { thread: ThreadView }) {
  const a = usePostActions(thread.post);
  const on = thread.post.viewer.subscribed;
  return (
    <Button size="sm" style={{ marginLeft: 'auto' }} aria-pressed={on} icon={on ? <BellRing size={14} aria-hidden="true" /> : <Bell size={14} aria-hidden="true" />} onClick={() => void a.toggleSubscribe()}>
      {on ? 'Following' : 'Follow conversation'}
    </Button>
  );
}
