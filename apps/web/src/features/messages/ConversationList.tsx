import { useState } from 'react';
import { NavLink, useSearchParams } from 'react-router';
import { LayoutGroup, motion } from 'motion/react';
import { BellOff, MessagesSquare, PenSquare, Search, Send } from 'lucide-react';
import { agentName, abbreviateMintsIn, relativeTime, type ConversationView } from '@shillex/shared';
import { useRequiredMe } from '../../lib/useMe';
import { spring } from '../../lib/motion';
import { useConversations } from '../../layout/navData';
import { Avatar } from '../../components/ui/Avatar';
import { IconButton } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { conversationName } from './conversationName';
import { MessageSearch } from './MessageSearch';
import s from './messages.module.css';

export function ConversationList({ activeId, onNew }: { activeId: string | null; onNew: () => void }) {
  const me = useRequiredMe();
  const q = useConversations();
  const [params] = useSearchParams();
  // Arriving from "Share to chat → Messages…": picking a conversation carries the token along.
  const share = params.get('share');
  const [query, setQuery] = useState('');
  const filtered = (q.data ?? []).filter((c) => conversationName(c, me.id).toLowerCase().includes(query.toLowerCase()));
  return (
    <div className={s.list}>
      <div className={s.listHead}>
        <div className={s.listTitleRow}>
          <h1 className={s.listTitle}>Messages</h1>
          <IconButton label="New message" onClick={onNew}><PenSquare size={18} /></IconButton>
        </div>
        <label className={s.search}><Search size={14} aria-hidden="true" /><input data-shortcut="search" aria-label="Search conversations and messages" placeholder="Search people and messages" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
        {share && <div className={s.shareNote}><Send size={14} aria-hidden="true" />Pick a conversation to share the token into.</div>}
      </div>
      <nav className={s.items} aria-label="Conversations">
        {q.isPending ? Array.from({ length: 6 }, (_, i) => <div key={i} className={s.item}><Skeleton w={42} h={42} r={21} /><div style={{ display: 'grid', gap: 7 }}><Skeleton w="50%" h={12} /><Skeleton w="80%" h={11} /></div></div>)
          : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} />
          : query.length >= 2 ? <><ConversationResults list={filtered} activeId={activeId} meId={me.id} share={share} /><MessageSearch q={query} /></>
          : filtered.length === 0 ? <EmptyState icon={<MessagesSquare size={26} />} title="No conversations yet" body="Start a DM or a private group with the pen button above." />
          : <ConversationResults list={filtered} activeId={activeId} meId={me.id} share={share} />}
      </nav>
    </div>
  );
}

function ConversationResults({ list, activeId, meId, share }: { list: ConversationView[]; activeId: string | null; meId: string; share: string | null }) {
  return (
    <LayoutGroup id="conversations">
      {list.map((c) => {
        const others = c.members.filter((m) => m.id !== meId);
        const name = conversationName(c, meId);
        const preview = c.lastMessage
          ? `${c.lastMessage.author.id === meId ? 'You: ' : c.kind === 'group' ? `${agentName(c.lastMessage.author)}: ` : ''}${abbreviateMintsIn(c.lastMessage.body) || (c.lastMessage.attachments.length ? 'Shared an attachment' : '')}`
          : 'No messages yet';
        const active = c.id === activeId;
        return (
          <NavLink key={c.id} to={`/messages/${c.id}${share ? `?share=${encodeURIComponent(share)}` : ''}`} className={s.item} aria-current={active ? 'page' : undefined}
            aria-label={`${name}${c.muted ? ', muted' : ''}${c.unread ? `, ${c.unread} unread` : ''}. ${preview}`}>
            {active && <motion.span layoutId="conv-pill" className={s.itemPill} transition={spring.snappy} />}
            {c.kind === 'dm' ? <Avatar src={others[0]?.avatarUrl ?? ''} size={42} />
              : <span className={s.stack}><Avatar src={others[0]?.avatarUrl ?? ''} size={30} /><Avatar src={others[1]?.avatarUrl ?? others[0]?.avatarUrl ?? ''} size={26} /></span>}
            <span className={s.itemText}>
              <span className={`${s.name} ${c.unread ? s.unreadName : ''}`}>{name}{c.muted && <BellOff size={12} aria-hidden="true" />}</span>
              <span className={`${s.preview} ${c.unread ? s.unreadPreview : ''}`}>{preview}</span>
            </span>
            <span className={s.itemMeta}>
              {c.lastMessage && <span className={s.when}>{relativeTime(c.lastMessage.createdAt)}</span>}
              {c.unread > 0 && <span className={s.count} aria-label={`${c.unread} unread`}>{c.unread > 99 ? '99+' : c.unread}</span>}
            </span>
          </NavLink>
        );
      })}
    </LayoutGroup>
  );
}
