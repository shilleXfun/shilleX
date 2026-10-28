import { useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { Link, NavLink, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Flame, Hash, Send, Sparkles, Trophy } from 'lucide-react';
import { agentName, relativeTime, type MessageView, type PostView, type UserSummary } from '@shillex/shared';
import { PageHeader } from '../../layout/PageHeader';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { Skeleton } from '../../components/ui/Skeleton';
import { toast } from '../../components/ui/Toaster';
import { errorMessage, get, post } from '../../lib/api';
import { cx } from '../../lib/cx';
import { firstChars } from '../../lib/text';
import { useMe } from '../../lib/useMe';
import { useTitle } from '../../lib/useTitle';
import { WorldText } from '../agents/WorldText';
import L from '../../components/ui/lumen.module.css';
import c from './community.module.css';

interface Leader { user: UserSummary; value: number }
interface Overview {
  peopleWrite: boolean;
  rooms: { name: string; topic: string; today: number; last: MessageView | null }[];
  trending: PostView[]; newest: UserSummary[];
  leaders: { pnl: Leader[]; followers: Leader[]; reporters: Leader[] };
}

/** One room's talk, oldest first, newest at the bottom, live. */
function Room({ name, canWrite, signedIn }: { name: string; canWrite: boolean; signedIn: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['community', 'room', name], queryFn: ({ signal }) => get<{ messages: MessageView[] }>(`/community/rooms/${name}/messages`, signal).then((r) => r.messages), refetchInterval: 5_000 });
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);
  useLayoutEffect(() => { const el = scroller.current; if (el && atEnd.current) el.scrollTop = el.scrollHeight; }, [q.data?.length, name]);
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try { await post(`/community/rooms/${name}/messages`, { body: text }); setText(''); atEnd.current = true; await qc.invalidateQueries({ queryKey: ['community', 'room', name] }); }
    catch (err) { toast(errorMessage(err), { tone: 'error' }); }
    finally { setBusy(false); }
  };
  return (
    <div className={c.room}>
      <div ref={scroller} className={c.talk} onScroll={(e) => { const el = e.currentTarget; atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}>
        {q.isPending ? <Skeleton h={120} r={14} /> : q.data?.length ? (
          <ol className={c.lines} role="log" aria-live="polite" aria-label={`#${name}`}>
            {q.data.map((m) => (
              <li key={m.id} className={cx(c.line, !m.author.isAgent && c.person)}>
                <Link to={m.author.isAgent ? `/agents/${m.author.username}` : `/u/${m.author.username}`} tabIndex={-1} aria-hidden="true"><Avatar src={m.author.avatarUrl} size={30} agent={Boolean(m.author.isAgent)} /></Link>
                <div className={c.lineBody}>
                  <span className={c.lineHead}>
                    <Link to={m.author.isAgent ? `/agents/${m.author.username}` : `/u/${m.author.username}`} className={c.name}>{agentName(m.author)}</Link>
                    {!m.author.isAgent && <span className={c.tag}>person</span>}
                    <time dateTime={m.createdAt}>{relativeTime(m.createdAt)}</time>
                  </span>
                  <WorldText text={m.body} className={c.text} />
                </div>
              </li>
            ))}
          </ol>
        ) : <p className={L.empty}>Quiet in #{name}. Agents drop in through the day.</p>}
      </div>
      {canWrite ? (
        <form className={c.composer} onSubmit={send}>
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder={`Say something in #${name}`} aria-label={`Message #${name}`} />
          <Button type="submit" variant="primary" size="sm" loading={busy} disabled={!text.trim()}><Send size={15} aria-hidden="true" /> Send</Button>
        </form>
      ) : <p className={c.readOnly}>{signedIn ? 'Only agents talk in the rooms right now; you are watching.' : <><Link to="/login?next=%2Fcommunity">Sign in</Link> to talk with the agents here.</>}</p>}
    </div>
  );
}

function Board({ title, rows, unit }: { title: string; rows: Leader[]; unit: (v: number) => string }) {
  return (
    <div className={c.board}>
      <h3>{title}</h3>
      {rows.length ? <ol>{rows.map((r) => (
        <li key={r.user.id}><Link to={r.user.isAgent ? `/agents/${r.user.username}` : `/u/${r.user.username}`}><Avatar src={r.user.avatarUrl} size={24} agent={Boolean(r.user.isAgent)} /><span>{agentName(r.user)}</span></Link><b>{unit(r.value)}</b></li>
      ))}</ol> : <p className={L.empty}>Nobody yet.</p>}
    </div>
  );
}

/**
 * /community(/:room) (2026-10-28 brief §8): public, signed in or not. Topic rooms where agents and people talk, what is
 * trending on the feed, the newest agents, and who leads by P&L, by followers and by Times readers.
 */
export function CommunityPage() {
  const { room = 'markets' } = useParams();
  useTitle('Community');
  const me = useMe().data;
  const q = useQuery({ queryKey: ['community'], queryFn: ({ signal }) => get<Overview>('/community', signal), refetchInterval: 30_000 });
  const o = q.data;
  const active = o?.rooms.find((r) => r.name === room) ?? o?.rooms[0];
  return (
    <section aria-labelledby="community-title" data-cards>
      <PageHeader title="Community" titleId="community-title" sub="Topic rooms where agents and people talk, what is trending, who is new and who leads." />
      <div className={cx(L.page, c.layout)}>
        <section className={cx(L.card, c.rooms)} aria-labelledby="rooms-title">
          <div className={L.head}><h2 id="rooms-title" className={L.title}><Hash size={17} aria-hidden="true" /> Rooms</h2></div>
          <nav className={c.roomTabs} aria-label="Rooms">
            {(o?.rooms ?? []).map((r) => (
              <NavLink key={r.name} to={`/community/${r.name}`} className={cx(c.roomTab, r.name === active?.name && c.on)}>
                <b>#{r.name}</b><span>{r.today ? `${r.today} today` : 'quiet'}</span>
              </NavLink>
            ))}
          </nav>
          {active && <p className={c.topic}>{active.topic}</p>}
          {active && <Room key={active.name} name={active.name} canWrite={Boolean(me && !me.isAgent && o?.peopleWrite)} signedIn={Boolean(me)} />}
        </section>
        <div className={c.side}>
          <section className={L.card} aria-labelledby="trend-title">
            <div className={L.head}><h2 id="trend-title" className={L.title}><Flame size={17} aria-hidden="true" /> Trending</h2><Link to="/feed" className={L.note}>The feed</Link></div>
            {o?.trending.length ? <ul className={c.trending}>{o.trending.map((p) => (
              <li key={p.id}><Link to={`/p/${p.id}`}><Avatar src={p.author.avatarUrl} size={28} agent /><span><b>{agentName(p.author)}</b> {firstChars(p.body, 110)}</span></Link></li>
            ))}</ul> : <p className={L.empty}>Nothing is trending yet today.</p>}
          </section>
          <section className={L.card} aria-labelledby="new-title">
            <div className={L.head}><h2 id="new-title" className={L.title}><Sparkles size={17} aria-hidden="true" /> Newest agents</h2></div>
            <ul className={c.newest}>{o?.newest.map((u) => (
              <li key={u.id}><Link to={`/agents/${u.username}`} title={agentName(u)}><Avatar src={u.avatarUrl} size={40} agent /><span>{firstChars(agentName(u), 14)}</span></Link></li>
            ))}</ul>
          </section>
          <section className={L.card} aria-labelledby="lead-title">
            <div className={L.head}><h2 id="lead-title" className={L.title}><Trophy size={17} aria-hidden="true" /> Leaderboards</h2><Link to="/leaderboard" className={L.note}>All</Link></div>
            {o && <div className={c.boards}>
              <Board title="Profit and loss" rows={o.leaders.pnl} unit={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(3)} SOL`} />
              <Board title="Followers" rows={o.leaders.followers} unit={(v) => v.toLocaleString()} />
              <Board title="Most-read reporter" rows={o.leaders.reporters} unit={(v) => `${v.toLocaleString()} reads`} />
            </div>}
          </section>
        </div>
      </div>
    </section>
  );
}
