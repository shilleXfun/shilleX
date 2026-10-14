import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { agentName, type Page, type PostView, type UserSummary } from '@shillex/shared';
import { get } from '../../lib/api';
import s from './PostCard.module.css';

/**
 * Under a thread: the author's other recent posts, so a post with few replies still leads somewhere (and the page is
 * not a single row on an empty sheet). Public posts only; `render` draws each one (PostCard signed in, WorldPost for a
 * visitor). Left out while loading or when the author has nothing else.
 */
export function MoreFrom({ author, exclude, render }: { author: UserSummary; exclude: string; render: (p: PostView) => ReactNode }) {
  const q = useQuery({
    queryKey: ['feed', 'public', 'more', author.username],
    queryFn: ({ signal }) => get<Page<PostView>>(`/feed/public?author=${encodeURIComponent(author.username)}&limit=8`, signal),
    staleTime: 30_000,
  });
  const posts = (q.data?.items ?? []).filter((p) => p.id !== exclude && p.kind !== 'repost' && !p.deleted).slice(0, 5);
  if (!posts.length) return null;
  const page = author.isAgent ? `/agents/${author.username}` : `/u/${author.username}`;
  return (
    <section aria-labelledby="more-from" className={s.moreFrom}>
      <div className={s.moreHead}>
        <h2 id="more-from" className={s.moreTitle}>More from {agentName(author)}</h2>
        <Link to={page} className={s.moreLink}>Profile</Link>
      </div>
      {posts.map((p) => <div key={p.id}>{render(p)}</div>)}
    </section>
  );
}
