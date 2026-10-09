import { useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Reply, Ellipsis, ShieldAlert } from 'lucide-react';
import { relativeTime, type MessageView, type ReactionEmoji } from '@shillex/shared';
import { del, errorMessage, post, put } from '../../lib/api';
import { useRequiredMe } from '../../lib/useMe';
import { cx } from '../../lib/cx';
import { Avatar } from '../../components/ui/Avatar';
import { Button, IconButton } from '../../components/ui/Button';
import { Menu } from '../../components/ui/Menu';
import { toast } from '../../components/ui/Toaster';
import { PostBody } from '../feed/PostBody';
import { ReactionPicker, ReactionPills } from '../feed/ReactionBar';
import { ReportDialog } from '../feed/ReportDialog';
import { TokenCard } from './TokenCard';
import { upsertMessage, type MsgPages } from './chatState';
import s from './chat.module.css';

// Compact 24-hour clock for the narrow hover gutter (a 12-hour "07:57 PM" would wrap and stretch the row).
const clock = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export function MessageItem({ m, grouped, canModerate, onReply, onJumpTo, pinCommunitySlug, highlight }: {
  m: MessageView; grouped: boolean; canModerate: boolean; onReply: (m: MessageView) => void; onJumpTo?: (id: string) => void; pinCommunitySlug?: string; highlight?: boolean;
}) {
  const me = useRequiredMe();
  const qc = useQueryClient();
  const [report, setReport] = useState(false);
  const key = ['messages', m.scope.type, m.scope.id];
  const time = new Date(m.createdAt);
  const mineAuthor = m.author.id === me.id;
  // Message reactions carry userIds rather than a per-viewer flag.
  const reactions = m.reactions.map((r) => ({ ...r, mine: r.userIds ? r.userIds.includes(me.id) : r.mine }));
  const react = async (emoji: ReactionEmoji) => {
    const had = reactions.find((r) => r.emoji === emoji)?.mine;
    const path = `/messages/${m.id}/reactions/${encodeURIComponent(emoji)}`;
    try {
      const r = await (had ? del<{ reactions: MessageView['reactions'] }>(path) : put<{ reactions: MessageView['reactions'] }>(path));
      qc.setQueryData<MsgPages>(key, (d) => upsertMessage(d, { ...m, reactions: r.reactions }));
    } catch (e) { toast(errorMessage(e), { tone: 'error' }); }
  };
  const act = (fn: () => Promise<unknown>, ok: string) => async () => { try { await fn(); toast(ok); } catch (e) { toast(errorMessage(e), { tone: 'error' }); } };

  if (m.status === 'deleted') {
    return <div className={cx(s.msg, grouped && s.grouped)} id={`msg-${m.id}`}><span /><div className={s.deleted}>Message deleted</div></div>;
  }
  return (
    <div className={cx(s.msg, grouped && s.grouped, highlight && s.highlight, m.status === 'held' && s.heldMsg)} id={`msg-${m.id}`} tabIndex={-1}>
      {grouped ? <span className={s.gutterTime} aria-hidden="true">{clock(time)}</span>
        : <Link to={`/u/${m.author.username}`} tabIndex={-1} aria-hidden="true" className={s.avatarLink}><Avatar src={m.author.avatarUrl} size={36} me={mineAuthor} /></Link>}
      <div className={s.content}>
        {!grouped && (
          <div className={s.head}>
            <Link to={`/u/${m.author.username}`} className={cx(s.author, mineAuthor && s.authorMe)}>{m.author.displayName}</Link>
            <time className={s.time} dateTime={m.createdAt} title={time.toLocaleString()}>{relativeTime(m.createdAt)}</time>
          </div>
        )}
        {m.replyTo && (
          <button type="button" className={s.replyRef} onClick={() => onJumpTo?.(m.replyTo!.id)}
            aria-label={`Replying to ${m.replyTo.author.displayName}: ${m.replyTo.deleted ? 'deleted message' : m.replyTo.snippet}`}>
            <Reply size={12} aria-hidden="true" /><strong>{m.replyTo.author.displayName}</strong>
            <span>{m.replyTo.deleted ? 'Message deleted' : m.replyTo.snippet}</span>
          </button>
        )}
        {m.body && <PostBody text={m.body} className={s.body} />}
        {m.attachments.some((a) => a.type === 'image') && (
          <div className={s.images}>{m.attachments.map((a) => a.type === 'image' && (
            <a key={a.url} href={a.url} target="_blank" rel="noopener noreferrer"><img src={a.url} alt={a.alt} width={a.width} height={a.height} loading="lazy" /></a>
          ))}</div>
        )}
        {m.attachments.map((a) => a.type === 'token' && <TokenCard key={a.mint} mint={a.mint} />)}
        {m.status === 'held' && (
          <div className={s.held}><ShieldAlert size={14} aria-hidden="true" />Awaiting moderator approval
            {canModerate && <Button size="sm" onClick={act(() => post(`/messages/${m.id}/approve`), 'Approved')}>Approve</Button>}</div>
        )}
        <ReactionPills reactions={reactions} onToggle={react} scope={m.id} />
      </div>
      {m.status === 'visible' && (
        <div className={s.toolbar} role="toolbar" aria-label="Message actions">
          <IconButton label="Reply" onClick={() => onReply(m)}><Reply size={15} /></IconButton>
          <ReactionPicker onPick={react} scope={m.id} reactions={reactions} />
          <Menu label="More message actions" items={[
            { label: 'Copy text', onSelect: () => void navigator.clipboard?.writeText(m.body).then(() => toast('Copied')) },
            ...(canModerate && pinCommunitySlug && m.scope.type === 'channel' ? [{ label: 'Pin message', onSelect: act(() => post(`/communities/${pinCommunitySlug}/pins`, { targetType: 'message', targetId: m.id }), 'Pinned') }] : []),
            ...(!mineAuthor ? [{ label: 'Report', onSelect: () => setReport(true), danger: true }] : []),
            ...(mineAuthor || canModerate ? [{ label: 'Delete', onSelect: act(() => del(`/messages/${m.id}`), 'Message deleted'), danger: true }] : []),
          ]} trigger={(t) => <IconButton {...t} label="More message actions"><Ellipsis size={15} /></IconButton>} />
        </div>
      )}
      <ReportDialog target={report ? { type: 'message', id: m.id } : null} onClose={() => setReport(false)} />
    </div>
  );
}
