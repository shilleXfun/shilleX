import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { ArrowLeft, Ellipsis, Lock, MessagesSquare } from 'lucide-react';
import { plural, type ConversationView, type MessageView } from '@shillex/shared';
import { ApiError, del, errorMessage, get, patch } from '../../lib/api';
import { useRequiredMe } from '../../lib/useMe';
import { dur, ease } from '../../lib/motion';
import { Avatar } from '../../components/ui/Avatar';
import { Button, IconButton } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Menu } from '../../components/ui/Menu';
import { Skeleton } from '../../components/ui/Skeleton';
import { toast } from '../../components/ui/Toaster';
import { useChatScope } from '../chat/useChatScope';
import { MessageList } from '../chat/MessageList';
import { MessageComposer } from '../chat/MessageComposer';
import { TypingIndicator } from '../chat/TypingIndicator';
import { conversationName } from './conversationName';
import s from './messages.module.css';
import cs from '../chat/chat.module.css';

export function ConversationPane({ id }: { id: string }) {
  const me = useRequiredMe();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = useQuery({ queryKey: ['conversation', id], queryFn: () => get<{ conversation: ConversationView }>(`/conversations/${id}`).then((r) => r.conversation) });
  if (q.isPending) return <div className={cs.wrap} aria-busy="true" aria-label="Loading conversation"><div className={s.paneSkeleton}><Skeleton w={34} h={34} r={17} /><Skeleton w={160} h={16} /></div></div>;
  if (q.isError) {
    return q.error instanceof ApiError && q.error.status === 404
      ? <EmptyState icon={<MessagesSquare size={26} />} title="Conversation not found" body="You may have left it, or it never existed." />
      : <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  }
  return <Pane key={id} conv={q.data} meId={me.id} share={params.get('share')} focusId={params.get('m')}
    clearShare={() => setParams((p) => { const n = new URLSearchParams(p); n.delete('share'); return n; }, { replace: true })}
    onLeft={() => { void qc.invalidateQueries({ queryKey: ['conversations'] }); nav('/messages'); }} />;
}

function Pane({ conv, meId, share, focusId, clearShare, onLeft }: { conv: ConversationView; meId: string; share: string | null; focusId: string | null; clearShare: () => void; onLeft: () => void }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const scope = { type: 'conversation' as const, id: conv.id };
  const chat = useChatScope(scope);
  const [replyTo, setReplyTo] = useState<MessageView | null>(null);
  const [unreadAtOpen] = useState(conv.unread);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(conv.name ?? '');
  const name = conversationName(conv, meId);
  const others = conv.members.filter((m) => m.id !== meId);
  const other = conv.kind === 'dm' ? others[0] ?? null : null;
  const run = (fn: () => Promise<unknown>, ok: string) => async () => {
    try { await fn(); toast(ok); void qc.invalidateQueries({ queryKey: ['conversations'] }); void qc.invalidateQueries({ queryKey: ['conversation', conv.id] }); }
    catch (e) { toast(errorMessage(e), { tone: 'error' }); }
  };
  const leave = async () => { try { await del(`/conversations/${conv.id}/members/me`); toast(`Left ${name}`); onLeft(); } catch (e) { toast(errorMessage(e), { tone: 'error' }); } };
  return (
    <motion.div className={cs.wrap} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: dur.standard, ease: ease.out }}>
      <div className={s.paneHead}>
        <IconButton label="Back to messages" className="mobile-only" onClick={() => nav('/messages')}><ArrowLeft size={18} /></IconButton>
        {other ? <Avatar src={other.avatarUrl} size={36} />
          : <span className={s.stack} style={{ width: 36, height: 36 }}><Avatar src={others[0]?.avatarUrl ?? ''} size={26} /><Avatar src={others[1]?.avatarUrl ?? others[0]?.avatarUrl ?? ''} size={22} /></span>}
        <div style={{ minWidth: 0, flex: 1 }}>
          <h2 className={s.paneTitle}>{other ? <Link to={`/u/${other.username}`}>{name}</Link> : name}</h2>
          <div className={s.paneSub}><Lock size={11} aria-hidden="true" />{conv.kind === 'group' ? `Private group, ${plural(conv.members.length, 'member')}` : 'Direct message, private'}</div>
        </div>
        <Menu label="Conversation options" items={[
          { label: conv.muted ? 'Unmute' : 'Mute', onSelect: run(() => patch(`/conversations/${conv.id}`, { muted: !conv.muted }), conv.muted ? 'Unmuted' : 'Muted') },
          ...(conv.kind === 'group' ? [
            { label: 'Rename group', onSelect: () => { setNewName(conv.name ?? ''); setRenaming(true); } },
            { label: 'Leave group', danger: true, onSelect: () => void leave() },
          ] : []),
        ]} trigger={(t) => <IconButton {...t} label="Conversation options"><Ellipsis size={18} /></IconButton>} />
      </div>
      <MessageList scope={scope} chat={chat} unreadAtOpen={unreadAtOpen} focusId={focusId} canModerate={false} onReply={setReplyTo}
        emptyTitle={conv.kind === 'dm' ? `This is the start of your conversation with ${name}` : `Welcome to ${name}`} label={`Messages with ${name}`} />
      <TypingIndicator users={chat.typingUsers} />
      <MessageComposer scope={scope} onSend={(b, o) => chat.send(b, o)} slowModeSeconds={0} isMod={false} replyTo={replyTo} onCancelReply={() => setReplyTo(null)}
        onTyping={chat.emitTyping} placeholder={`Message ${name}`} tokenCard={share} onClearTokenCard={clearShare} />
      <Dialog open={renaming} onClose={() => setRenaming(false)} title="Rename group"
        footer={<><Button variant="ghost" onClick={() => setRenaming(false)}>Cancel</Button>
          <Button variant="primary" disabled={!newName.trim()} onClick={async () => { await run(() => patch(`/conversations/${conv.id}`, { name: newName.trim() }), 'Group renamed')(); setRenaming(false); }}>Save name</Button></>}>
        <input className={s.textInput} aria-label="Group name" autoFocus value={newName} maxLength={40} onChange={(e) => setNewName(e.target.value)} />
      </Dialog>
    </motion.div>
  );
}
