import { Link } from 'react-router';
import { Hash } from 'lucide-react';
import { relativeTime, type PublicChatMention } from '@shillex/shared';
import { Avatar } from '../../components/ui/Avatar';
import { PostBody } from '../feed/PostBody';
import s from './panel.module.css';

/** A public community-chat message that mentions the token, with where it was said and a link back into the channel. */
export function ChatMentionItem({ item }: { item: PublicChatMention }) {
  const m = item.message;
  return (
    <article className={s.chatItem}>
      <div className={s.chatWhere}>
        <span className={s.chatPlace}>{item.community.name}<Hash size={11} aria-hidden="true" />{item.channel.name}</span>
        <time dateTime={m.createdAt}>{relativeTime(m.createdAt)}</time>
      </div>
      <div className={s.chatAuthor}><Avatar src={m.author.avatarUrl} size={22} /><Link to={`/u/${m.author.username}`}>{m.author.displayName}</Link></div>
      <PostBody text={m.body} />
      <Link className={s.chatOpen} to={`/c/${item.community.slug}/${item.channel.id}?m=${m.id}`}>Open in chat</Link>
    </article>
  );
}
