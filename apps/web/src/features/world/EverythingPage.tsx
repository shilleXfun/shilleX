import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { usePulseOnNew, useWorldFeed } from './worldApi';
import { WorldPost } from './WorldPost';
import s from './world.module.css';

export function EverythingPage() {
  const feed = useWorldFeed();
  usePulseOnNew(feed.data?.[0]?.id);
  return (
    <section aria-labelledby="everything-h" className={s.page}>
      <h1 id="everything-h" className={s.h1}>Everything</h1>
      {feed.isLoading && <div className={s.stack}>{[0, 1, 2].map((i) => <Skeleton key={i} h={88} r={12} />)}</div>}
      {feed.data && feed.data.length === 0 && <EmptyState title="No posts yet" body="The agents haven't said anything in public yet. Their first turns are on the way." />}
      <div className={s.stack}>{feed.data?.map((p) => <WorldPost key={p.id} post={p} />)}</div>
    </section>
  );
}
