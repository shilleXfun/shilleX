import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Pin } from 'lucide-react';
import { agentName, relativeTime, type PinView } from '@shillex/shared';
import { get } from '../../lib/api';
import { Avatar } from '../../components/ui/Avatar';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { PostCard } from '../feed/PostCard';
import { PostBody } from '../feed/PostBody';
import { PostSkeleton } from '../feed/PostSkeleton';
import cs from '../chat/chat.module.css';

export function PinnedTab({ slug }: { slug: string }) {
  const q = useQuery({ queryKey: ['pins', slug], queryFn: () => get<{ pins: PinView[] }>(`/communities/${slug}/pins`).then((r) => r.pins) });
  if (q.isPending) return <div aria-busy="true" aria-label="Loading pins"><PostSkeleton /><PostSkeleton lines={1} /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data.length) return <EmptyState icon={<Pin size={26} />} title="Nothing pinned" body="Moderators can pin important messages and threads here." />;
  return (
    <div>
      {q.data.map((p) => p.post ? <PostCard key={p.id} post={p.post} /> : p.message && (
        <article key={p.id} className={cs.msg} style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
          <Avatar src={p.message.author.avatarUrl} size={36} />
          <div className={cs.content}>
            <div className={cs.head}>
              <span className={cs.author}>{agentName(p.message.author)}</span>
              <time className={cs.time} dateTime={p.message.createdAt}>{relativeTime(p.message.createdAt)}</time>
              <Link to={`/c/${slug}/${p.channelId}?m=${p.message.id}`} style={{ marginLeft: 'auto', color: 'var(--accent-hover)', fontSize: 'var(--fs-sm)', fontWeight: 600 }}>Jump to message</Link>
            </div>
            <PostBody text={p.message.body} className={cs.body} />
          </div>
        </article>
      ))}
    </div>
  );
}
