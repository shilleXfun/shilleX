import { useState, type MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Bookmark, Ellipsis, Hash, Link2, MessageCircle, Repeat2, TrendingUp } from 'lucide-react';
import { relativeTime, type PostView } from '@shillex/shared';
import { useRequiredMe } from '../../lib/useMe';
import { cx } from '../../lib/cx';
import { Avatar } from '../../components/ui/Avatar';
import { Dialog } from '../../components/ui/Dialog';
import { Menu } from '../../components/ui/Menu';
import { PostBody } from './PostBody';
import { MediaGrid } from './MediaGrid';
import { QuoteEmbed } from './QuoteEmbed';
import { ReactionPicker, ReactionPills } from './ReactionBar';
import { AddCallUpdate, CallUpdates } from './CallUpdates';
import { ReportDialog } from './ReportDialog';
import { Composer } from './Composer';
import { usePostActions, useUserActions } from './postActions';
import { UNAVAILABLE_TEXT, isUnavailable } from './unavailable';
import s from './PostCard.module.css';

export interface PostCardProps {
  post: PostView;
  /** The thread's main post: larger text, not clickable through. */
  focused?: boolean;
  compact?: boolean;
  /** Replaces the default reply dialog (e.g. the thread page focuses its inline composer). */
  onReply?: (p: PostView) => void;
}

export function PostCard({ post, focused, compact, onReply }: PostCardProps) {
  const me = useRequiredMe();
  const nav = useNavigate();
  const a = usePostActions(post);
  const p = a.target;
  const userActions = useUserActions(p.author);
  const [report, setReport] = useState<{ type: 'post' | 'user'; id: string } | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [replying, setReplying] = useState(false);
  const [addingCall, setAddingCall] = useState(false);

  const repostedBy = post.kind === 'repost' && (
    <div className={s.context}><Repeat2 size={13} aria-hidden="true" /><Link to={`/u/${post.author.username}`}>{post.author.displayName} reposted</Link></div>
  );
  if (isUnavailable(p)) {
    return (
      <article className={cx(s.card, s.static, compact && s.compact)} aria-label="Unavailable post">
        {repostedBy}
        <div className={cx(s.tombstone, s.unavailable)}>{UNAVAILABLE_TEXT}</div>
      </article>
    );
  }

  const isMine = p.author.id === me.id;
  const open = (e: MouseEvent) => {
    if (focused || (e.target as HTMLElement).closest('a,button,input,textarea,label,dialog')) return;
    if (window.getSelection()?.toString()) return;
    nav(`/p/${p.id}`);
  };
  const reply = () => (onReply ? onReply(p) : setReplying(true));
  const shares = p.counts.reposts + p.counts.quotes;

  return (
    <article className={cx(s.card, focused && s.focused, compact && s.compact)} onClick={open} aria-labelledby={`post-${post.id}-author`}>
      {repostedBy}
      <Link to={`/u/${p.author.username}`} className={s.avatarLink} aria-hidden="true" tabIndex={-1}><Avatar src={p.author.avatarUrl} size={compact ? 32 : 40} /></Link>
      <div className={s.main}>
        <div className={s.meta}>
          <Link id={`post-${post.id}-author`} to={`/u/${p.author.username}`} className={s.name}>{p.author.displayName}</Link>
          <span className={s.handle}>@{p.author.username}</span>
          <span className={s.handle} aria-hidden="true">·</span>
          <Link to={`/p/${p.id}`} className={s.time}><time dateTime={p.createdAt} title={new Date(p.createdAt).toLocaleString()}>{relativeTime(p.createdAt)}</time></Link>
          {p.community && <Link to={`/c/${p.community.slug}`} className={s.communityTag}><Hash size={11} aria-hidden="true" />{p.community.name}</Link>}
        </div>
        {p.replyTo && !focused && <div className={s.replyTo}>Replying to <Link to={`/u/${p.replyTo.author.username}`}>@{p.replyTo.author.username}</Link></div>}
        {p.deleted ? <div className={s.tombstone}>This post was deleted.</div> : (
          <>
            {p.body && <PostBody text={p.body} className={s.body} />}
            <MediaGrid media={p.media} />
            {p.quoted && <QuoteEmbed post={p.quoted} />}
            <CallUpdates post={p} />
            <ReactionPills reactions={p.reactions} onToggle={a.react} />
            <div className={s.actions} role="group" aria-label="Post actions">
              <button type="button" className={s.action} aria-label={`Reply, ${p.counts.replies} ${p.counts.replies === 1 ? 'reply' : 'replies'}`} onClick={(e) => { e.stopPropagation(); reply(); }}>
                <MessageCircle size={15} aria-hidden="true" />{p.counts.replies || ''}
              </button>
              <Menu label="Repost options" items={[
                { label: p.viewer.reposted ? 'Undo repost' : 'Repost', onSelect: a.toggleRepost },
                { label: 'Quote', onSelect: () => setQuoting(true) },
              ]} trigger={(t) => (
                <button {...t} type="button" className={s.action} aria-pressed={p.viewer.reposted} aria-label={`Repost options, ${shares} reposts and quotes`} onClick={(e) => { e.stopPropagation(); t.onClick(); }}>
                  <Repeat2 size={15} aria-hidden="true" />{shares || ''}
                </button>
              )} />
              <ReactionPicker onPick={a.react} />
              <button type="button" className={s.action} aria-pressed={p.viewer.bookmarked} aria-label={p.viewer.bookmarked ? 'Remove bookmark' : 'Bookmark'} onClick={(e) => { e.stopPropagation(); void a.toggleBookmark(); }}>
                <Bookmark size={15} aria-hidden="true" />
              </button>
              <button type="button" className={s.action} aria-label="Copy link" onClick={(e) => { e.stopPropagation(); void a.copyLink(); }}><Link2 size={15} aria-hidden="true" /></button>
              {p.viewer.canAddCallUpdate && (
                <button type="button" className={cx(s.action, s.callAction)} aria-label="Update call" title="Add a self-reported call update" onClick={(e) => { e.stopPropagation(); setAddingCall(true); }}>
                  <TrendingUp size={15} aria-hidden="true" /><span className={s.callLabel}>Update call</span>
                </button>
              )}
              <span className={s.more}>
                <Menu label="More" items={[
                  { label: p.viewer.subscribed ? 'Unfollow conversation' : 'Follow conversation', onSelect: a.toggleSubscribe },
                  ...(isMine ? [{ label: 'Delete post', onSelect: a.remove, danger: true }] : [
                    { label: `Mute @${p.author.username}`, onSelect: () => userActions.mute(true) },
                    { label: `Block @${p.author.username}`, onSelect: () => userActions.block(true), danger: true },
                    { label: 'Report post', onSelect: () => setReport({ type: 'post', id: p.id }), danger: true },
                  ]),
                ]} trigger={(t) => <button {...t} type="button" className={s.action} onClick={(e) => { e.stopPropagation(); t.onClick(); }}><Ellipsis size={15} aria-hidden="true" /></button>} />
              </span>
            </div>
          </>
        )}
      </div>
      <ReportDialog target={report} onClose={() => setReport(null)} />
      {p.viewer.canAddCallUpdate && <AddCallUpdate p={p} open={addingCall} onClose={() => setAddingCall(false)} />}
      <Dialog open={quoting} onClose={() => setQuoting(false)} title="Quote post">
        <Composer mode="quote" quote={p} autoFocus onPosted={() => setQuoting(false)} />
      </Dialog>
      <Dialog open={replying} onClose={() => setReplying(false)} title={`Reply to @${p.author.username}`}>
        <div className={s.replyContext}><QuoteEmbed post={p} /></div>
        <Composer mode="reply" parent={p} autoFocus onPosted={() => setReplying(false)} />
      </Dialog>
    </article>
  );
}
