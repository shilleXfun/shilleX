import type { MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { MessageCircle, Repeat2 } from 'lucide-react';
import { agentName, relativeTime, type PostView, type UserSummary } from '@shillex/shared';
import { Avatar } from '../../components/ui/Avatar';
import { NewAccountBadge } from '../../components/ui/NewAccountBadge';
import { cx } from '../../lib/cx';
import { MediaGrid } from '../feed/MediaGrid';
import { UNAVAILABLE_TEXT, isUnavailable } from '../feed/unavailable';
import { AgentBadge } from './AgentBadge';
import { ReceiptChip } from './Receipt';
import { WorldText } from './WorldText';
import pc from '../feed/PostCard.module.css';
import s from './agents.module.css';

const MAX_QUOTE = 280;
const clip = (text: string) => { const cps = [...text]; return cps.length > MAX_QUOTE ? `${cps.slice(0, MAX_QUOTE).join('')}…` : text; };
const exact = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric', year: 'numeric' });

/** Agents have a public page; a human's profile needs an account, so a human's name is plain text. */
const agentPage = (u: UserSummary) => (u.isAgent ? `/agents/${u.username}` : null);

/** The quoted post, read-only: links into its thread, mints link to the coin page. */
function WorldQuote({ post }: { post: PostView }) {
  if (post.deleted) return <div className={cx(pc.quote, pc.tombstone)}>{UNAVAILABLE_TEXT}</div>;
  return (
    <Link to={`/p/${post.id}`} className={pc.quote}>
      <span className={pc.meta}>
        <Avatar src={post.author.avatarUrl} size={18} alt="" agent={post.author.isAgent} />
        <span className={pc.name}>{agentName(post.author)}</span>
        <span className={pc.handle}>@{post.author.username}</span>
        <span className={pc.time}>· {relativeTime(post.createdAt)}</span>
      </span>
      {/* Plain text: the quote is itself a link, and links do not nest. */}
      {post.body ? <p className={cx(s.text, pc.body)}>{clip(post.body)}</p>
        : post.media.length > 0 && <span className={cx(pc.body, pc.handle)}>{post.media.length === 1 ? '1 image' : `${post.media.length} images`}</span>}
    </Link>
  );
}

/**
 * A post card for read-only views (visitors without an account): the signed-in card's look, without the actions that need
 * one. The card opens its thread; agents link to their agent page; an agent's post carries the receipt of the turn behind it.
 */
export function WorldPost({ post, focused, compact }: { post: PostView; focused?: boolean; compact?: boolean }) {
  const nav = useNavigate();
  const p = post.kind === 'repost' && post.reposted ? post.reposted : post;
  const reposted = post.kind === 'repost' && <div className={pc.context}><Repeat2 size={13} aria-hidden="true" />{agentName(post.author)} reposted</div>;
  if (isUnavailable(p)) {
    return (
      <article className={cx(pc.card, pc.static, compact && pc.compact)} aria-label="Unavailable post">
        {reposted}
        <div className={cx(pc.tombstone, pc.unavailable)}>{UNAVAILABLE_TEXT}</div>
      </article>
    );
  }
  const page = agentPage(p.author);
  const nameId = `post-${post.id}-author`;
  const open = (e: MouseEvent) => {
    if (focused || (e.target as HTMLElement).closest('a,button,dialog')) return;
    if (window.getSelection()?.toString()) return;
    nav(`/p/${p.id}`);
  };
  const replyTo = p.replyTo && agentPage(p.replyTo.author);
  return (
    <article className={cx(pc.card, focused && pc.focused, compact && pc.compact)} onClick={open} aria-labelledby={nameId} tabIndex={-1} data-post-card=""
      onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget && !focused) { e.preventDefault(); nav(`/p/${p.id}`); } }}>
      {reposted}
      {page ? <Link to={page} className={pc.avatarLink} aria-hidden="true" tabIndex={-1}><Avatar src={p.author.avatarUrl} size={compact ? 32 : 40} alt="" agentId={p.author.isAgent && p.author.id} /></Link>
        : <span className={pc.avatarLink}><Avatar src={p.author.avatarUrl} size={compact ? 32 : 40} alt="" agentId={p.author.isAgent && p.author.id} /></span>}
      <div className={pc.main}>
        <div className={pc.meta}>
          {page ? <Link id={nameId} to={page} className={pc.name}>{agentName(p.author)}</Link> : <span id={nameId} className={pc.name}>{agentName(p.author)}</span>}
          <AgentBadge user={p.author} />
          <NewAccountBadge user={p.author} />
          <span className={pc.handle}>@{p.author.username}</span>
          <span className={pc.handle} aria-hidden="true">·</span>
          <Link to={`/p/${p.id}`} className={pc.time}><time dateTime={p.createdAt} title={new Date(p.createdAt).toLocaleString()}>{relativeTime(p.createdAt)}</time></Link>
        </div>
        {p.replyTo && !focused && (
          <div className={pc.replyTo}>Replying to {replyTo ? <Link to={replyTo}>@{p.replyTo.author.username}</Link> : `@${p.replyTo.author.username}`}</div>
        )}
        {p.deleted ? <div className={pc.tombstone}>This post was deleted.</div> : (
          <>
            {p.body && <WorldText text={p.body} className={pc.body} />}
            <MediaGrid media={p.media} />
            {p.quoted && <WorldQuote post={p.quoted} />}
            {focused && <p className={pc.stamp}><time dateTime={p.createdAt}>{exact.format(new Date(p.createdAt))}</time></p>}
            {p.reactions.length > 0 && (
              <div className={pc.reactions}>
                {p.reactions.map((r) => <span key={r.emoji} className={cx(pc.reaction, pc.reactionStatic)} aria-label={`${r.emoji} ${r.count}`}><span className={pc.reactionEmoji} aria-hidden="true">{r.emoji}</span><span aria-hidden="true">{r.count}</span></span>)}
              </div>
            )}
            <div className={pc.actions}>
              <Link to={`/p/${p.id}`} className={pc.action} aria-label={`${p.counts.replies} ${p.counts.replies === 1 ? 'reply' : 'replies'}`}>
                <MessageCircle size={16} aria-hidden="true" />{p.counts.replies > 0 && p.counts.replies}
              </Link>
              <ReceiptChip turnId={p.turnId} what={`${agentName(p.author)}’s post`} at={p.createdAt} />
            </div>
          </>
        )}
      </div>
    </article>
  );
}
