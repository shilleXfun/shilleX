import { memo, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { Quote, Repeat2, Reply } from 'lucide-react';
import { agentName, plural, relativeTime, type ActivityItem, type PostView, type UserSummary } from '@shillex/shared';
import { Avatar } from '../../components/ui/Avatar';
import { cx } from '../../lib/cx';
import { PostCard } from '../feed/PostCard';
import { PostBody } from '../feed/PostBody';
import { focusProps } from '../feed/Clamp';
import { WorldPost } from '../agents/WorldPost';
import { WorldText } from '../agents/WorldText';
import { AgentBadge } from '../agents/AgentBadge';
import { hueStyle, speakerHue } from '../home/speaker';
import { actorOf } from './live';
import pc from '../feed/PostCard.module.css';
import t from './timeline.module.css';

/** A thread's root holds to this many lines in the timeline, with "Show more" (x-revamp §2). */
const ROOT_LINES = 6;

/** Agents have a public page; a person's needs an account, so to a visitor a person's name is plain text. */
const pageOf = (u: UserSummary, authed: boolean) => (u.isAgent ? `/agents/${u.username}` : authed ? `/u/${u.username}` : null);

const VERB = { reply: 'replied', quote: 'quoted', repost: 'reposted' } as const;
const ICON = { reply: Reply, quote: Quote, repost: Repeat2 } as const;

/** "Mott replied", "Mott and 2 others replied", "Wren reposted": what lifted the thread, above it. */
function Social({ item, authed }: { item: ActivityItem; authed: boolean }) {
  if (item.kind === 'post') return null;
  const lead = item.by[0] ?? actorOf(item);
  const others = Math.max(0, item.by.length - 1);
  const Icon = ICON[item.kind];
  const to = pageOf(lead, authed);
  return (
    <div className={t.social}>
      <Icon size={14} strokeWidth={2.4} aria-hidden="true" />
      <span className={t.socialText}>
        {to ? <Link to={to}>{agentName(lead)}</Link> : agentName(lead)}{others > 0 && ` and ${plural(others, 'other')}`} {VERB[item.kind]}
      </span>
    </div>
  );
}

/** What the thread line runs into below a post: that author's hue, and whether it lands on a small row (an 8 px top). */
type Next = { hue: number; small: boolean } | null;

/**
 * One post of a thread, with its stretch of the thread line: from under its avatar down to the next avatar, fading from
 * this author's hue into the next one's. `data-post-id` is where a bump's spark lands and its wash plays.
 */
function Seg({ post, next, small, children }: { post: PostView; next: Next; small?: boolean; children: ReactNode }) {
  const style = next ? ({ '--h1': speakerHue(post.author), '--h2': next.hue, '--reach': next.small ? '4px' : '8px' } as CSSProperties) : undefined;
  return <div className={cx(t.post, small && t.small)} data-post-id={post.id} data-line={next ? '' : undefined} style={style}>{children}</div>;
}

/** The post the newest reply answers, when that is neither the root nor shown: a compact row, two lines of text. */
function ContextPost({ post, authed }: { post: PostView; authed: boolean }) {
  const nav = useNavigate();
  const agent = Boolean(post.author.isAgent);
  const to = pageOf(post.author, authed);
  const open = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('a,button') || window.getSelection()?.toString()) return;
    nav(`/p/${post.id}`);
  };
  const name = <span className={cx(pc.name, agent && pc.hued)} style={agent ? hueStyle(post.author) : undefined}>{agentName(post.author)}</span>;
  return (
    <article className={t.context} onClick={open} aria-label={`Earlier in the thread, ${agentName(post.author)}`} {...focusProps(post.author)}>
      <span className={t.contextFace} data-avatar=""><Avatar src={post.author.avatarUrl} size={24} agentId={agent ? post.author.id : undefined} /></span>
      <div className={t.contextMain}>
        <div className={pc.meta}>
          {to ? <Link to={to} className={t.contextName}>{name}</Link> : name}
          <AgentBadge user={post.author} />
          <span className={pc.handle}>@{post.author.username}</span>
          <span className={pc.dot} aria-hidden="true">·</span>
          <Link to={`/p/${post.id}`} className={pc.time}><time dateTime={post.createdAt}>{relativeTime(post.createdAt)}</time></Link>
        </div>
        {post.deleted ? <p className={t.contextText}>This post was deleted.</p>
          : authed ? <PostBody text={post.body} className={t.contextText} /> : <WorldText text={post.body} className={t.contextText} />}
      </div>
    </article>
  );
}

/** While a conversation is still being written: who is most likely writing the next line. */
function Typing({ who }: { who: UserSummary }) {
  return (
    <div className={t.typing} style={hueStyle(who)}>
      <span className={t.typingFace}><Avatar src={who.avatarUrl} size={24} agentId={who.isAgent ? who.id : undefined} /></span>
      <span className={t.typingText}>{agentName(who)} is typing</span>
      <span className={t.dots} aria-hidden="true"><i /><i /><i /></span>
    </div>
  );
}

/**
 * One thread in the timeline, in the row anatomy of x-revamp §2: what lifted it, the root (six lines at most), the thread
 * line in its authors' colours, the context, the newest reactions, "Show N more replies", and a typing row while its
 * conversation runs. Memoised: a bump replaces only its own thread, so the rest of the list stays still.
 */
export const ThreadRow = memo(function ThreadRow({ item, authed }: { item: ActivityItem; authed: boolean }) {
  const typing = item.scene?.running ? item.scene.next : null;
  const href = item.scene ? `/scenes/${item.scene.id}` : `/p/${item.id}`;
  const chain = [
    { post: item.root, role: 'root' as const },
    ...(item.context ? [{ post: item.context, role: 'context' as const }] : []),
    ...item.latest.map((post) => ({ post, role: 'latest' as const })),
  ];
  const more = item.more > 0;
  const tail = typing ? speakerHue(typing) : null;
  const lastHue = speakerHue(chain.at(-1)!.post.author);
  const Card = authed ? PostCard : WorldPost;
  return (
    <div className={t.thread}>
      <Social item={item} authed={authed} />
      {chain.map((c, i) => {
        const below = chain[i + 1];
        // The line runs on to the next post; past the last one only into the typing row (through "Show more" if it is there).
        const next: Next = below ? { hue: speakerHue(below.post.author), small: below.role === 'context' } : tail === null ? null : { hue: more ? lastHue : tail, small: true };
        return (
          <Seg key={c.post.id} post={c.post} next={next} small={c.role === 'context'}>
            {c.role === 'context' ? <ContextPost post={c.post} authed={authed} /> : <Card post={c.post} threaded clamp={c.role === 'root' ? ROOT_LINES : undefined} />}
          </Seg>
        );
      })}
      {more && (
        <Link to={href} className={t.more} data-line={tail === null ? undefined : ''} style={tail === null ? undefined : ({ '--h1': lastHue, '--h2': tail } as CSSProperties)}>
          Show {item.more} more {item.more === 1 ? 'reply' : 'replies'}
        </Link>
      )}
      {typing && <Typing who={typing} />}
    </div>
  );
});
