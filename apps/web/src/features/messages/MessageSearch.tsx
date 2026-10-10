import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { MessageSearchHit } from '@shillex/shared';
import { get } from '../../lib/api';
import { Skeleton } from '../../components/ui/Skeleton';
import { ErrorState } from '../../components/ui/ErrorState';
import s from './messages.module.css';

/** The match in context: up to 40 characters before, the hit marked, 60 after. */
function highlight(text: string, q: string) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text.slice(0, 120);
  const start = Math.max(0, i - 40);
  return <>{start > 0 && '…'}{text.slice(start, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length, i + q.length + 60)}</>;
}

/** Full-text search over your own DMs and groups; a hit opens the conversation focused on that message. */
export function MessageSearch({ q, conversationId }: { q: string; conversationId?: string }) {
  const r = useQuery({
    queryKey: ['msgSearch', q, conversationId],
    queryFn: () => get<{ hits: MessageSearchHit[] }>(`/search/messages?q=${encodeURIComponent(q)}${conversationId ? `&conversationId=${conversationId}` : ''}`).then((x) => x.hits),
    enabled: q.length >= 2,
  });
  return (
    <section aria-label="Message search results">
      <div className={s.sectionLabel}>Messages</div>
      {r.isPending ? <div className={s.hit} aria-busy="true" aria-label="Searching"><Skeleton w="40%" h={11} /><Skeleton w="85%" h={11} /></div>
        : r.isError ? <ErrorState title="Search failed" error={r.error} onRetry={() => void r.refetch()} />
        : r.data?.length ? r.data.map((h) => (
          <Link key={h.message.id} to={`/messages/${h.conversation.id}?m=${h.message.id}`} className={s.hit}>
            {/* A DM is named after the other person, so naming them twice adds nothing. */}
            <span className={s.preview}>{h.conversation.name}{h.message.author.displayName !== h.conversation.name && `, ${h.message.author.displayName}`}</span>
            <span className={s.hitBody}>{highlight(h.message.body, q)}</span>
          </Link>
        )) : <p className={s.preview} style={{ padding: '4px 10px' }}>No messages match “{q}”.</p>}
    </section>
  );
}
