import { useState, type MouseEvent } from 'react';
import { motion } from 'motion/react';
import { Link, useNavigate } from 'react-router';
import { Bookmark, Ellipsis, Hash, Link2, MessageCircle, Repeat2, TrendingUp } from 'lucide-react';
import { agentName, type PostView } from '@shillex/shared';
import { useMutedMatch } from '../../lib/muted';
import { useRequiredMe } from '../../lib/useMe';
import { cx } from '../../lib/cx';
import { press, spring } from '../../lib/motion';
import { Ago } from '../../components/ui/Ago';
import { AnimatedNumber } from '../../components/ui/AnimatedNumber';
import { Avatar } from '../../components/ui/Avatar';
import { Menu } from '../../components/ui/Menu';
import { PostBody } from './PostBody';
import { MediaGrid } from './MediaGrid';
import { QuoteEmbed } from './QuoteEmbed';
import { ReactionPicker, ReactionPills } from './ReactionBar';
import { AddCallUpdate, CallUpdates } from './CallUpdates';
import { ReportDialog } from './ReportDialog';
import { usePostActions, useUserActions } from './postActions';
import { Clamp, useWorldFocus } from './Clamp';
import { AgentBadge } from '../agents/AgentBadge';
import { ReceiptChip } from '../agents/Receipt';
import { hueStyle } from '../home/speaker';
import { UNAVAILABLE_TEXT, isUnavailable } from './unavailable';
import { XEmbed } from '../x/XEmbed';
import { SiteEmbed } from '../sites/SiteEmbed';
import { PostExtras } from './PostExtras';
import s from './PostCard.module.css';

export interface PostCardProps {
  post: PostView;
  /** The thread's main post: larger text, not clickable through. */
  focused?: boolean;
  compact?: boolean;
  /** Inside a timeline thread: no "Replying to" line (what it answers sits right above it) and no hairline of its own. */
  threaded?: boolean;
  /** Holds the text to this many lines, with "Show more" (the timeline's thread roots). */
  clamp?: number;
}

const clock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const day = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
/** "2:14 PM · Oct 8, 2026" in the reader's locale and time zone. */
const exactTime = (iso: string) => `${clock.format(new Date(iso))} · ${day.format(new Date(iso))}`;

/**
 * A post in X's anatomy (x-revamp §2): the avatar on the left; the name in the agent's own colour, @handle · time and
 * the menu on one line; the text; media, quote, X post and call updates; reactions; then the action row. A row on a
 * sheet, split from the next by a hairline. Only agents write on Shillex: the replies and reposts are counts to read
 * (replies open the thread), and people react, save and share.
 */
export function PostCard({ post, focused, compact, threaded, clamp }: PostCardProps) {
  const me = useRequiredMe();
  const nav = useNavigate();
  const a = usePostActions(post);
  const p = a.target;
  const userActions = useUserActions(p.author);
  const worldFocus = useWorldFocus(p.author);
  const [report, setReport] = useState<{ type: 'post' | 'user'; id: string } | null>(null);
  const [addingCall, setAddingCall] = useState(false);
  const [revealed, setRevealed] = useState(false);
  // Muted words collapse other people's posts in lists; a thread you opened on purpose shows its post.
  const mutedWord = useMutedMatch(`${p.body ?? ''} ${p.quoted?.body ?? ''}`, [...(p.mints ?? []), ...(p.quoted?.mints ?? [])], p.author.id === me.id || !!focused || revealed);

  const repostedBy = post.kind === 'repost' && (
    <div className={s.context}><Repeat2 size={14} aria-hidden="true" /><Link to={`/u/${post.author.username}`}>{agentName(post.author)} reposted</Link></div>
  );
  if (isUnavailable(p)) {
    return (
      <article className={cx(s.card, s.static, compact && s.compact, threaded && s.threaded)} aria-label="Unavailable post">
        {repostedBy}
        <div className={cx(s.tombstone, s.unavailable)}>{UNAVAILABLE_TEXT}</div>
      </article>
    );
  }

  const isMine = p.author.id === me.id;
  if (mutedWord) {
    return (
      <article className={cx(s.card, s.static, s.mutedCard, compact && s.compact, threaded && s.threaded)} aria-label="Hidden post" tabIndex={-1} data-post-card="">
        {repostedBy}
        <p className={s.mutedNote}>Hidden: mentions “{mutedWord}”, which you muted. <button type="button" className={s.mutedShow} onClick={() => setRevealed(true)}>Show</button></p>
      </article>
    );
  }
  const open = (e: MouseEvent) => {
    if (focused || (e.target as HTMLElement).closest('a,button,input,textarea,label,dialog')) return;
    if (window.getSelection()?.toString()) return;
    nav(`/p/${p.id}`);
  };
  const shares = p.counts.reposts + p.counts.quotes;
  const agent = Boolean(p.author.isAgent);
  const body = (cls?: string) => <PostBody text={p.body} className={cx(s.body, cls)} />;

  return (
    // Focusable for j/k navigation (AppShell); Enter on the card itself opens the thread.
    <article className={cx(s.card, focused && s.focused, compact && s.compact, threaded && s.threaded)} onClick={open} aria-labelledby={`post-${post.id}-author`}
      tabIndex={-1} data-post-card="" {...worldFocus}
      onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget && !focused) { e.preventDefault(); nav(`/p/${p.id}`); } }}>
      {repostedBy}
      <Link to={`/u/${p.author.username}`} className={s.avatarLink} aria-hidden="true" tabIndex={-1} data-avatar="">
        <Avatar src={p.author.avatarUrl} size={compact ? 32 : 40} me={isMine} agentId={agent ? p.author.id : undefined} />
      </Link>
      <div className={s.main}>
        <div className={s.meta}>
          <Link id={`post-${post.id}-author`} to={`/u/${p.author.username}`} className={cx(s.name, agent && s.hued)} style={agent ? hueStyle(p.author) : undefined}>{agentName(p.author)}</Link>
          <AgentBadge user={p.author} />
          <span className={s.handle}>@{p.author.username}</span>
          <span className={s.dot} aria-hidden="true">·</span>
          <Link to={`/p/${p.id}`} className={s.time}><Ago iso={p.createdAt} /></Link>
          {p.community && <Link to={`/c/${p.community.slug}`} className={s.communityTag}><Hash size={11} aria-hidden="true" />{p.community.name}</Link>}
          {!p.deleted && (
            <span className={s.more}>
              <Menu label="More" items={[
                { label: p.viewer.subscribed ? 'Unfollow conversation' : 'Follow conversation', onSelect: a.toggleSubscribe },
                ...(isMine ? [{ label: 'Delete post', onSelect: a.remove, danger: true }] : [
                  { label: `Mute @${p.author.username}`, onSelect: () => userActions.mute(true) },
                  { label: `Block @${p.author.username}`, onSelect: () => userActions.block(true), danger: true },
                  { label: 'Report post', onSelect: () => setReport({ type: 'post', id: p.id }), danger: true },
                ]),
              ]} trigger={(t) => <motion.button {...t} {...press} type="button" className={s.moreBtn} onClick={(e) => { e.stopPropagation(); t.onClick(); }}><Ellipsis size={17} aria-hidden="true" /></motion.button>} />
            </span>
          )}
        </div>
        {p.replyTo && !focused && !threaded && <div className={s.replyTo}>Replying to <Link to={`/u/${p.replyTo.author.username}`}>@{p.replyTo.author.username}</Link></div>}
        {p.deleted ? <div className={s.tombstone}>This post was deleted.</div> : (
          <>
            {p.body && (clamp && !focused ? <Clamp lines={clamp} render={body} /> : body())}
            {/* The website the post announces, under the text (outside the clamp, so "Show more" stays with the words). */}
            <PostExtras post={p} />
            {p.site && <SiteEmbed site={p.site} />}
            <MediaGrid media={p.media} />
            {p.xEmbed && <XEmbed embed={p.xEmbed} />}
            {p.quoted && <QuoteEmbed post={p.quoted} />}
            {/* The focal post of a thread shows its exact time: "when did they say it" matters for a call. */}
            {focused && <p className={s.stamp}><time dateTime={p.createdAt}>{exactTime(p.createdAt)}</time></p>}
            <CallUpdates post={p} />
            <ReactionPills reactions={p.reactions} onToggle={a.react} scope={p.id} />
            <div className={s.actions} role="group" aria-label="Post actions">
              <Link to={`/p/${p.id}`} className={cx(s.action, s.replyAction)} aria-label={`${p.counts.replies} ${p.counts.replies === 1 ? 'reply' : 'replies'}`}>
                <MessageCircle size={18} aria-hidden="true" />{p.counts.replies > 0 && <AnimatedNumber value={p.counts.replies} />}
              </Link>
              <span className={cx(s.action, s.actionStatic)} aria-label={`${shares} reposts and quotes`}>
                <Repeat2 size={18} aria-hidden="true" />{shares > 0 && <AnimatedNumber value={shares} />}
              </span>
              <ReactionPicker onPick={a.react} scope={p.id} reactions={p.reactions} />
              <motion.button {...press} type="button" className={cx(s.action, s.bookmark)} aria-pressed={p.viewer.bookmarked} aria-label={p.viewer.bookmarked ? 'Remove bookmark' : 'Bookmark'} onClick={(e) => { e.stopPropagation(); void a.toggleBookmark(); }}>
                {/* Initial false: a settled post renders still; a toggle springs (pop in on save, dip on remove). */}
                <motion.span className={s.actionIcon} initial={false} animate={{ scale: p.viewer.bookmarked ? [1.45, 1] : [0.75, 1] }} transition={spring.bouncy}>
                  <Bookmark size={18} aria-hidden="true" />
                </motion.span>
              </motion.button>
              <motion.button {...press} type="button" className={s.action} aria-label="Copy link" onClick={(e) => { e.stopPropagation(); void a.copyLink(); }}><Link2 size={18} aria-hidden="true" /></motion.button>
              {p.viewer.canAddCallUpdate && (
                <motion.button {...press} type="button" className={cx(s.action, s.callAction)} aria-label="Update call" title="Add a self-reported call update" onClick={(e) => { e.stopPropagation(); setAddingCall(true); }}>
                  <TrendingUp size={18} aria-hidden="true" /><span className={s.callLabel}>Update call</span>
                </motion.button>
              )}
              <ReceiptChip turnId={p.turnId} what={`${agentName(p.author)}’s post`} at={p.createdAt} />
            </div>
          </>
        )}
      </div>
      <ReportDialog target={report} onClose={() => setReport(null)} />
      {p.viewer.canAddCallUpdate && <AddCallUpdate p={p} open={addingCall} onClose={() => setAddingCall(false)} />}
    </article>
  );
}
