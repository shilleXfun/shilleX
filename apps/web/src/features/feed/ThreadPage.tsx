import { useLocation, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bell, BellRing } from 'lucide-react';
import type { ThreadView } from '@shillex/shared';
import { ApiError, get } from '../../lib/api';
import { useSocketEvent } from '../../lib/socket';
import { patchPost } from '../../lib/cache';
import { Button, IconButton } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { primeTokens } from '../tokens/tokenCache';
import { PostCard } from './PostCard';
import { PostSkeleton } from './PostSkeleton';
import { Composer } from './Composer';
import { usePostActions } from './postActions';
import { pageHeader } from './HomePage';

const REPLY_BOX = 'thread-reply';

export function ThreadPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['thread', id], queryFn: async ({ signal }) => { const t = await get<ThreadView>(`/posts/${id}`, signal); primeTokens(qc, t.tokens); return t; } });
  useSocketEvent('call:update', ({ postId, update }) => patchPost(qc, postId, (p) => (p.callUpdates.some((u) => u.id === update.id) ? p : { ...p, callUpdates: [...p.callUpdates, update] })));
  const focusReply = () => document.querySelector<HTMLTextAreaElement>(`#${REPLY_BOX} textarea`)?.focus();
  return (
    <section aria-labelledby="thread-title">
      <div style={{ ...pageHeader, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--line)' }}>
        {/* The first entry of a session (e.g. an opened link) has no in-app history to go back to. */}
        <IconButton label="Back" onClick={() => (location.key !== 'default' ? nav(-1) : nav('/'))}><ArrowLeft size={18} /></IconButton>
        <h1 id="thread-title" style={{ margin: 0, fontSize: 'var(--fs-xl)' }}>Conversation</h1>
        {q.data && !q.data.post.deleted && <SubscribeButton thread={q.data} />}
      </div>
      {q.isPending ? <div aria-busy="true" aria-label="Loading conversation"><PostSkeleton /><PostSkeleton /></div>
        : q.isError ? (q.error instanceof ApiError && q.error.status === 404
          ? <EmptyState title="This post isn’t available" body="It may have been deleted, or it’s in a community you can’t see." />
          : <ErrorState error={q.error} onRetry={() => void q.refetch()} />)
        : (
          <>
            {q.data.ancestors.map((p) => <PostCard key={p.id} post={p} compact />)}
            <PostCard post={q.data.post} focused onReply={focusReply} />
            {!q.data.post.deleted && (
              <div id={REPLY_BOX}><Composer mode="reply" parent={q.data.post} placeholder={`Reply to @${q.data.post.author.username}`} /></div>
            )}
            {q.data.replies.length === 0
              ? <EmptyState title="No replies yet" body={q.data.post.deleted ? undefined : 'Start the conversation.'} />
              : <div role="feed" aria-label="Replies">{q.data.replies.map((p) => <PostCard key={p.id} post={p} />)}</div>}
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
