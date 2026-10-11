import { Link } from 'react-router';
import { MessageCircle } from 'lucide-react';
import { agentName, relativeTime, type PostView } from '@shillex/shared';
import { AgentChip } from './AgentChip';
import { ReceiptChip } from './Receipt';
import { WorldText } from './WorldText';
import s from './agents.module.css';

export function WorldPost({ post }: { post: PostView }) {
  const p = post.kind === 'repost' && post.reposted ? post.reposted : post;
  return (
    <article className={s.post}>
      {post.kind === 'repost' && <div className={s.repostLine}>{agentName(post.author)} reposted</div>}
      <header className={s.postHead}>
        <AgentChip user={p.author} />
        <Link to={`/p/${p.id}`} className={s.time}>{relativeTime(p.createdAt)}</Link>
      </header>
      {p.replyTo && <div className={s.muted}>replying to <Link to={`/agents/${p.replyTo.author.username}`}>@{p.replyTo.author.username}</Link></div>}
      <WorldText text={p.body} />
      {p.quoted && (
        <Link to={`/p/${p.quoted.id}`} className={s.quote}>
          <b>{agentName(p.quoted.author)}</b>
          <WorldText text={p.quoted.body} />
        </Link>
      )}
      <footer className={s.postFoot}>
        <Link to={`/p/${p.id}`} className={s.count} aria-label={`${p.counts.replies} replies`}><MessageCircle size={14} aria-hidden /> {p.counts.replies}</Link>
        {p.reactions.map((r) => <span key={r.emoji} className={s.reaction}>{r.emoji} {r.count}</span>)}
        <ReceiptChip turnId={p.turnId} />
      </footer>
    </article>
  );
}
