import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { LIMITS, type ConversationView, type UserSummary } from '@shillex/shared';
import { errorMessage, get, post } from '../../lib/api';
import { spring } from '../../lib/motion';
import { Avatar } from '../../components/ui/Avatar';
import { Button, IconButton } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Skeleton } from '../../components/ui/Skeleton';
import { Tabs } from '../../components/ui/Tabs';
import s from './messages.module.css';

/** Start a DM (picking a person opens it) or a private group (name + up to 19 others). */
export function NewConversationDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (c: ConversationView) => void }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<'dm' | 'group'>('dm');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<UserSummary[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const term = q.trim();
  const users = useQuery({ queryKey: ['userSearch', term], queryFn: () => get<{ users: UserSummary[] }>(`/users?q=${encodeURIComponent(term)}`).then((r) => r.users), enabled: term.length >= 1 });
  const full = picked.length >= LIMITS.groupMax - 1;
  async function create(target?: UserSummary) {
    setBusy(true); setError(null);
    try {
      const r = await post<{ conversation: ConversationView }>('/conversations', kind === 'dm' ? { kind: 'dm', username: target!.username } : { kind: 'group', name: name.trim(), usernames: picked.map((u) => u.username) });
      await qc.invalidateQueries({ queryKey: ['conversations'] });
      onCreated(r.conversation); setPicked([]); setQ(''); setName('');
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  const toggle = (u: UserSummary) => setPicked((p) => (p.some((x) => x.id === u.id) ? p.filter((x) => x.id !== u.id) : [...p, u]));
  return (
    <Dialog open={open} onClose={onClose} title="New message"
      footer={kind === 'group' ? <><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!name.trim() || !picked.length} onClick={() => create()}>Create group</Button></> : undefined}>
      <Tabs label="Conversation type" idPrefix="newconv" value={kind} onChange={(v) => setKind(v as 'dm' | 'group')} tabs={[{ id: 'dm', label: 'Direct message' }, { id: 'group', label: 'Private group' }]} />
      <div className={s.picker}>
        {kind === 'group' && <input className={s.textInput} aria-label="Group name" placeholder="Group name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />}
        {kind === 'group' && picked.length > 0 && (
          <div className={s.chips}>
            <AnimatePresence initial={false}>
              {picked.map((u) => (
                <motion.span key={u.id} className={s.chip} initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.7, opacity: 0 }} transition={spring.bouncy}>
                  <Avatar src={u.avatarUrl} size={20} />{u.displayName}
                  <IconButton label={`Remove ${u.displayName}`} onClick={() => toggle(u)}><X size={12} /></IconButton>
                </motion.span>
              ))}
            </AnimatePresence>
          </div>
        )}
        <input className={s.textInput} autoFocus aria-label="Search people" placeholder="Search people by name or @handle" value={q} onChange={(e) => setQ(e.target.value)} />
        {!term ? <p className={s.hint}>{kind === 'dm' ? 'Pick someone to open a private conversation.' : `Add up to ${LIMITS.groupMax - 1} people. Groups are private and never appear in public discussion.`}</p>
          : users.isPending ? <div style={{ display: 'grid', gap: 8 }}><Skeleton h={40} r={10} /><Skeleton h={40} r={10} /></div>
          : !users.data?.length ? <p className={s.hint}>No one matches “{term}”.</p>
          : (
            <ul className={s.people}>
              {users.data.map((u) => {
                const on = picked.some((x) => x.id === u.id);
                return (
                  <li key={u.id}>
                    <button type="button" className={s.person} aria-pressed={kind === 'group' ? on : undefined} disabled={busy || (kind === 'group' && full && !on)}
                      onClick={() => (kind === 'dm' ? void create(u) : toggle(u))}>
                      <Avatar src={u.avatarUrl} size={32} /><span><strong>{u.displayName}</strong> <span className={s.personHandle}>@{u.username}</span></span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        {error && <p role="alert" className={s.formError}>{error}</p>}
      </div>
    </Dialog>
  );
}
