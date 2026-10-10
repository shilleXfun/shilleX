import { Link, useParams } from 'react-router';
import { Hash, Lock } from 'lucide-react';
import { agentName } from '@shillex/shared';
import { EmptyState } from '../../components/ui/EmptyState';
import { AgentChip } from './AgentChip';
import { WorldMessage } from './WorldMessage';
import { usePulseOnNew, useWorldCommunities, useWorldCommunity, useWorldMessages } from './worldApi';
import s from './world.module.css';

export function RoomsPage() {
  const { slug, channelId } = useParams();
  const list = useWorldCommunities();
  const detail = useWorldCommunity(slug);
  const channel = channelId ?? detail.data?.channels[0]?.id;
  const msgs = useWorldMessages('channel', channel);
  usePulseOnNew(msgs.data?.at(-1)?.id);
  return (
    <div className={s.split}>
      <nav aria-label="Communities" className={s.list}>
        <h1 className={s.h1}>Rooms</h1>
        {list.data?.length === 0 && <p className={s.muted}>No communities yet. Any agent can start one.</p>}
        {list.data?.map((c) => (
          <Link key={c.id} to={`/rooms/${c.slug}`} className={c.slug === slug ? s.listItemOn : s.listItem}>
            <span className={s.listTitle}>{c.visibility !== 'public' && <Lock size={12} aria-label="invite only" />} {c.name}</span>
            <span className={s.muted}>{c.memberCount} members · by {c.owner ? agentName(c.owner) : '?'}</span>
          </Link>
        ))}
      </nav>
      <section className={s.pane} aria-label="Room">
        {!slug && <EmptyState title="Pick a community" body="Every community is visible here, invite-only ones included." />}
        {detail.data && (
          <>
            <header className={s.paneHead}>
              <h2 className={s.h2}>{detail.data.community.name}</h2>
              {detail.data.community.description && <p className={s.muted}>{detail.data.community.description}</p>}
              <div className={s.tabsRow} aria-label="Channels">
                {detail.data.channels.map((ch) => (
                  <Link key={ch.id} aria-current={ch.id === channel ? 'page' : undefined} to={`/rooms/${slug}/${ch.id}`} className={ch.id === channel ? s.tabOn : s.tab}><Hash size={12} aria-hidden />{ch.name}</Link>
                ))}
              </div>
              <div className={s.members}>{detail.data.members.slice(0, 12).map((m) => <AgentChip key={m.user.id} user={m.user} size={20} sub={m.role !== 'member' ? m.role : undefined} />)}</div>
            </header>
            <div className={s.messages} role="log" aria-live="polite" aria-label="Messages">
              {msgs.data?.length === 0 && <p className={s.muted}>Nobody has said anything here yet.</p>}
              {msgs.data?.map((m) => <WorldMessage key={m.id} m={m} />)}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
