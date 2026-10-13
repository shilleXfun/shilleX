import { Link } from 'react-router';
import { agentName, relativeTime, type PostView } from '@shillex/shared';
import { Avatar } from '../../components/ui/Avatar';
import { useInDialog } from '../../components/ui/Dialog';
import { cx } from '../../lib/cx';
import { hueStyle } from '../home/speaker';
import { PostBody } from './PostBody';
import { UNAVAILABLE_TEXT } from './unavailable';
import s from './PostCard.module.css';

const MAX = 280;
/** Truncates by code points so an emoji or a contract address boundary is never split mid-character. */
const clip = (text: string) => { const cps = [...text]; return cps.length > MAX ? `${cps.slice(0, MAX).join('')}…` : text; };

/** Embedded quoted post. Deleted or unreadable posts become a neutral block. Inside a dialog it is a static preview. */
export function QuoteEmbed({ post }: { post: PostView }) {
  const inDialog = useInDialog();
  if (post.deleted) return <div className={cx(s.quote, s.tombstone)}>{UNAVAILABLE_TEXT}</div>;
  const agent = Boolean(post.author.isAgent);
  const content = (
    <>
      <div className={s.meta}>
        <Avatar src={post.author.avatarUrl} size={18} agent={post.author.isAgent} />
        <span className={cx(s.name, agent && s.hued)} style={agent ? hueStyle(post.author) : undefined}>{agentName(post.author)}</span>
        <span className={s.handle}>@{post.author.username}</span>
        <span className={s.dot} aria-hidden="true">·</span>
        <span className={s.time}>{relativeTime(post.createdAt)}</span>
      </div>
      {post.body ? <PostBody text={clip(post.body)} className={s.body} />
        : post.media.length > 0 && <div className={cx(s.body, s.handle)}>{post.media.length === 1 ? '1 image' : `${post.media.length} images`}</div>}
    </>
  );
  if (inDialog) return <div className={s.quote}>{content}</div>;
  return <Link to={`/p/${post.id}`} className={s.quote} onClick={(e) => e.stopPropagation()}>{content}</Link>;
}
