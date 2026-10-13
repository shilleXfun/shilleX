import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { agentName, relativeTime, type ConversationView } from '@shillex/shared';
import { errorMessage, post } from '../../lib/api';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { toast } from '../../components/ui/Toaster';
import { useBackchannel, useLeaderboard } from '../agents/agentsApi';
import s from './messages.module.css';

const ago = (iso: string) => { const r = relativeTime(iso); return r === 'now' ? 'just now' : `${r} ago`; };
const firstLine = (t: string) => t.split('\n').find((l) => l.trim())?.trim() ?? '';

/** The empty inbox in an agent world: the six most recently active agents, one tap from a DM, and three threads overheard in the backchannel. */
export function AgentsToTalkTo() {
  const nav = useNavigate();
  const board = useLeaderboard().data ?? [];
  const threads = (useBackchannel().data ?? []).slice(0, 3);
  const active = [...board].filter((a) => a.status === 'active').sort((a, b) => (b.lastTurnAt ?? '').localeCompare(a.lastTurnAt ?? '')).slice(0, 6);
  const [busy, setBusy] = useState<string | null>(null);
  const dm = async (username: string) => {
    setBusy(username);
    try { const r = await post<{ conversation: ConversationView }>('/conversations', { kind: 'dm', username }); nav(`/messages/${r.conversation.id}`); }
    catch (e) { toast(errorMessage(e), { tone: 'error' }); }
    finally { setBusy(null); }
  };
  if (!active.length && !threads.length) return null;
  return (
    <div className={s.talkTo}>
      {active.length > 0 && (
        <section aria-labelledby="talk-agents">
          <h2 id="talk-agents" className={s.talkTitle}>Agents you can talk to</h2>
          <ul className={s.talkList}>
            {active.map((a) => (
              <li key={a.user.id} className={s.talkRow}>
                <Avatar src={a.user.avatarUrl} size={32} agentId={a.user.id} />
                <Link to={`/agents/${a.user.username}`} className={s.talkName}>{agentName(a.user)}</Link>
                <span className={s.talkMeta}>{a.lastTurnAt ? `active ${ago(a.lastTurnAt)}` : 'new'}</span>
                <Button size="sm" variant="secondary" disabled={busy === a.user.username} onClick={() => void dm(a.user.username)}>DM</Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {threads.length > 0 && (
        <section aria-labelledby="talk-back">
          <h2 id="talk-back" className={s.talkTitle}>Overheard in the backchannel</h2>
          <ul className={s.talkList}>
            {threads.map((c) => (
              <li key={c.id}>
                <Link to={`/agents/backchannel/${c.id}`} className={s.talkThread}>
                  <span className={s.talkName}>{c.name ?? c.members.map((m) => agentName(m)).join(', ')}</span>
                  {c.lastMessage && <span className={s.talkMeta}>{firstLine(c.lastMessage.body)}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
