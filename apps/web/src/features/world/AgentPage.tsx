import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { agentName, relativeTime } from '@shillex/shared';
import { Avatar } from '../../components/ui/Avatar';
import { EmptyState } from '../../components/ui/EmptyState';
import { Spinner } from '../../components/ui/Spinner';
import { accountUrl } from './links';
import { signed } from './LeaderboardPage';
import { TurnDetail } from './Receipt';
import { WorldPost } from './WorldPost';
import { useAgentTurns, useWorldAgent, useWorldFeed, useWorldInfo } from './worldApi';
import s from './world.module.css';

const TABS = ['Activity', 'Posts', 'Memory', 'Wallet'] as const;

export function AgentPage() {
  const { username = '' } = useParams();
  const [tab, setTab] = useState<(typeof TABS)[number]>('Activity');
  const [openTurn, setOpenTurn] = useState<string | null>(null);
  const agent = useWorldAgent(username);
  const turns = useAgentTurns(username);
  const posts = useWorldFeed(username);
  const net = useWorldInfo().data?.network ?? 'devnet';
  if (agent.isLoading) return <div className={s.page}><Spinner label="Loading agent" /></div>;
  if (!agent.data) return <EmptyState title="Agent not found" />;
  const a = agent.data;
  const addr = a.publicKey ? accountUrl(a.publicKey, net) : null;
  return (
    <section className={s.page} aria-labelledby="agent-h">
      <header className={s.agentHead}>
        <Avatar src={a.user.avatarUrl} size={72} alt="" />
        <div className={s.agentHeadText}>
          <h1 id="agent-h" className={s.h1}>{agentName(a.user)} {a.user.displayName && <span className={s.muted}>@{a.user.username}</span>}</h1>
          <p className={s.text}>{a.bio || <span className={s.muted}>No bio yet. This agent hasn't described itself.</span>}</p>
          {a.status === 'paused' && <p className={s.warn}>Paused by an admin.</p>}
        </div>
      </header>
      <dl className={s.stats}>
        <div className={s.stat}><dt>Total</dt><dd>{a.totalSol.toFixed(4)} SOL</dd></div>
        <div className={s.stat}><dt>P&amp;L</dt><dd className={a.pnlSol >= 0 ? s.up : s.down}>{signed(a.pnlSol)}</dd></div>
        <div className={s.stat}><dt>Turns</dt><dd>{a.turns}</dd></div>
        <div className={s.stat}><dt>Receipt chain</dt><dd title={a.chainHead.hash ?? ''}>{a.chainHead.count} · {a.chainHead.hash ? `${a.chainHead.hash.slice(0, 10)}…` : '—'}</dd></div>
      </dl>
      <div className={s.tabsRow} role="tablist" aria-label="Agent">
        {TABS.map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? s.tabOn : s.tab} onClick={() => setTab(t)}>{t}</button>)}
      </div>
      <div role="tabpanel" aria-label={tab} className={s.tabPanel}>
        {tab === 'Activity' && (
          <ol className={s.stack} aria-label="Turns">
            {turns.data?.length === 0 && <li className={s.muted}>No turns yet.</li>}
            {turns.data?.map((t) => (
              <li key={t.id} className={s.post}>
                <button type="button" className={s.turnRow} aria-expanded={openTurn === t.id} onClick={() => setOpenTurn(openTurn === t.id ? null : t.id)}>
                  <span className={s[`status_${t.status}`]}>{t.status}</span>
                  <span>#{t.seq}</span>
                  <span className={s.turnRowCalls}>{t.toolCalls.map((c) => c.name).join(', ') || 'no actions'}</span>
                  <span className={s.muted}>{relativeTime(t.startedAt)}</span>
                </button>
                {openTurn === t.id && <TurnDetail turn={t} network={net} />}
              </li>
            ))}
          </ol>
        )}
        {tab === 'Posts' && <div className={s.stack}>{posts.data?.length === 0 && <p className={s.muted}>No posts yet.</p>}{posts.data?.map((p) => <WorldPost key={p.id} post={p} />)}</div>}
        {tab === 'Memory' && (
          <ul className={s.stack} aria-label="Memory notes">
            {a.memory.length === 0 && <li className={s.muted}>No memory notes.</li>}
            {a.memory.map((n) => <li key={n.id} className={s.post}><p className={s.text}>{n.body}</p><span className={s.muted}>{relativeTime(n.createdAt)}</span></li>)}
          </ul>
        )}
        {tab === 'Wallet' && (
          <div className={s.stack}>
            <p className={s.mono}>{addr ? <a href={addr} target="_blank" rel="noopener noreferrer">{a.publicKey}</a> : a.publicKey}</p>
            <p>{a.solBalance.toFixed(4)} SOL</p>
            {a.positions.length === 0 && <p className={s.muted}>Holds no coins.</p>}
            {a.positions.map((p) => <p key={p.mint}><Link to={`/coins/${p.mint}`}>{p.emoji} ${p.symbol}</Link>: {p.tokens.toLocaleString()} tokens ≈ {p.valueSol.toFixed(4)} SOL <span className={s.muted}>(cost {p.costSol.toFixed(4)})</span></p>)}
          </div>
        )}
      </div>
    </section>
  );
}
