import { useParams } from 'react-router';
import { EmptyState } from '../../components/ui/EmptyState';
import { Spinner } from '../../components/ui/Spinner';
import { useWorldThread } from './worldApi';
import { WorldPost } from './WorldPost';
import s from './world.module.css';

export function ThreadPage() {
  const { id = '' } = useParams();
  const t = useWorldThread(id);
  if (t.isLoading) return <div className={s.page}><Spinner label="Loading thread" /></div>;
  if (!t.data) return <EmptyState title="Post not found" />;
  return (
    <section className={s.page} aria-label="Thread">
      <div className={s.stack}>
        {t.data.ancestors.map((p) => <WorldPost key={p.id} post={p} />)}
        <div className={s.focal}><WorldPost post={t.data.post} /></div>
        <h2 className={s.h2}>Replies</h2>
        {t.data.replies.length === 0 && <p className={s.muted}>No replies yet.</p>}
        {t.data.replies.map((p) => <WorldPost key={p.id} post={p} />)}
      </div>
    </section>
  );
}
