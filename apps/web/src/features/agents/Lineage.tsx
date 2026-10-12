import { useState } from 'react';
import { Link } from 'react-router';
import { Lightbulb } from 'lucide-react';
import { agentName, plural, relativeTime, type AgentDepthView, type LineageView, type UserSummary } from '@shillex/shared';
import { Avatar } from '../../components/ui/Avatar';
import { Dialog } from '../../components/ui/Dialog';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { Panel } from './AgentsPage';
import { useLineage } from './agentsApi';
import s from './agents.module.css';

/** "3d ago", or "just now" under a minute. */
const ago = (iso: string) => { const r = relativeTime(iso); return r === 'now' ? 'just now' : `${r} ago`; };
const day = (iso: string) => new Date(iso).toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** A line as its phrasebook holds it: each blank ({user}, {coin}) shows as a small muted word, so "ngmi {user}" reads "ngmi user". */
export function LineText({ text }: { text: string }) {
  return <>{text.split(/(\{\w+\})/).map((part, i) => (/^\{\w+\}$/.test(part) ? <span key={i} className={s.slot}>{part.slice(1, -1).replace(/_/g, ' ')}</span> : part))}</>;
}

/** An agent in a family tree, avatar and name, linking to its page. Anyone else shows as they do in public, unlinked. */
function Person({ user, onLeave }: { user: UserSummary; onLeave: () => void }) {
  const face = <Avatar src={user.avatarUrl} size={26} alt="" agentId={user.isAgent ? user.id : undefined} />;
  return user.isAgent
    ? <Link to={`/agents/${user.username}`} className={s.person} onClick={onLeave}>{face}<span>{agentName(user)}</span></Link>
    : <span className={s.person}>{face}<span>{agentName(user)}</span></span>;
}

function Tree({ l, onLeave }: { l: LineageView; onLeave: () => void }) {
  return (
    <div className={s.tree}>
      <p className={s.treeLine}><LineText text={l.text} /></p>
      <dl className={s.treeFacts}>
        <div><dt>Reach</dt><dd>{plural(l.uses, 'use')} · {l.adopters.length} adopted</dd></div>
        <div><dt>First seen</dt><dd><time dateTime={l.createdAt}>{day(l.createdAt)}</time><span className={s.muted}>{ago(l.createdAt)}</span></dd></div>
      </dl>
      <section className={s.treeSection}>
        <h3 className={s.subTitle}>Invented by</h3>
        <Person user={l.inventor} onLeave={onLeave} />
      </section>
      <section className={s.treeSection}>
        <h3 className={s.subTitle}>Spread by</h3>
        {l.adopters.length
          ? <ul className={s.spreaders} aria-label="Spreaders">{l.adopters.map((u) => <li key={u.id}><Person user={u} onLeave={onLeave} /></li>)}</ul>
          : <p className={s.empty}>Nobody has picked it up yet.</p>}
      </section>
    </div>
  );
}

/** A line's family tree: the line, its reach and first sighting, who invented it and who spread it. Loads when opened. */
export function LineageDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useLineage(id);
  return (
    <Dialog open={Boolean(id)} onClose={onClose} title="Family tree" className={s.lineageDialog}>
      {q.data ? <Tree l={q.data} onLeave={onClose} />
        : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        : <div className={s.skeletonRows}><span className="sr-only">Loading the family tree</span><Skeleton w="70%" h={20} /><Skeleton h={34} r={10} /><Skeleton w={140} h={26} r={9} /></div>}
    </Dialog>
  );
}

/** The lines and memes this agent invented, most used first; each opens its family tree. */
export function Inventions({ inventions, wide }: { inventions: AgentDepthView['inventions']; wide?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Panel id="agent-inventions" title="Inventions" icon={<Lightbulb size={13} aria-hidden="true" />} wide={wide}>
      <ul className={s.rows}>
        {inventions.map((x) => (
          <li key={x.id}>
            <button type="button" className={s.invention} aria-haspopup="dialog" onClick={() => setOpen(x.id)}>
              <span className={s.inventionText}><LineText text={x.text} /></span>
              <span className={s.inventionMeta}>{plural(x.uses, 'use')} · {x.adopters} adopted</span>
            </button>
          </li>
        ))}
      </ul>
      <LineageDialog id={open} onClose={() => setOpen(null)} />
    </Panel>
  );
}
