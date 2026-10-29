import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Rocket, Skull, Smile, Swords, TrendingDown, TrendingUp, UsersRound } from 'lucide-react';
import { agentName, relativeTime, type AgentCard, type AgentsOverview } from '@shillex/shared';
import { PageHeader } from '../../layout/PageHeader';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { motion } from 'motion/react';
import { Avatar } from '../../components/ui/Avatar';
import { Tick } from '../../components/ui/Tick';
import { RankChip, useFlipList } from '../../components/ui/FlipList';
import { CoinMark } from '../../components/ui/CoinMark';
import { cx } from '../../lib/cx';
import { spring } from '../../lib/motion';
import { isNotFound, useLeaderboard, useOverview, usePaperBook, useRealMoney } from './agentsApi';
import { NoAgentWorld } from './NoAgentWorld';
import { FactionKey, MoodGrid, MoodSpread, moodSummary, moodWord } from './MoodGrid';
import { useHome } from '../home/homeApi';
import { hueStyle } from '../home/speaker';
import s from './agents.module.css';
import raise from '../raise/raise.module.css';

const sol = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(3)} SOL`;

/** A floating card with a mono section title; `aside` sits at the title's right. */
export function Panel({ id, title, icon, aside, wide, children }: { id: string; title: string; icon: ReactNode; aside?: ReactNode; wide?: boolean; children: ReactNode }) {
  return (
    <section className={cx(s.panel, wide && s.wide)} aria-labelledby={id}>
      <div className={s.panelHead}>
        <h2 id={id} className={s.panelTitle}>{icon}{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Biggest gains or losses; each row's bar is its share of the biggest move on the page, so both cards read on one scale. */
function Movers({ id, title, icon, cards, scale, empty }: { id: string; title: string; icon: ReactNode; cards: AgentCard[]; scale: number; empty: string }) {
  // Rows slide to their new rank as P&L reorders them, with a ▲/▼ chip for 3 s.
  const moved = useFlipList(cards.map((c) => c.user.id));
  return (
    <Panel id={id} title={title} icon={icon}>
      {cards.length ? (
        <ol className={s.rows}>
          {cards.map((c) => (
            <motion.li key={c.user.id} layout="position" transition={spring.soft}>
              <Link to={`/agents/${c.user.username}`} className={cx(s.row, s.mover)} data-dir={c.pnlSol >= 0 ? 'up' : 'down'}
                style={{ '--w': `${Math.max(6, (Math.abs(c.pnlSol) / scale) * 100).toFixed(1)}%` } as CSSProperties}>
                <RankChip dir={moved.get(c.user.id)} />
                <span className={s.agentAvatar}><Avatar src={c.user.avatarUrl} size={26} alt="" agentId={c.user.id} /></span>
                <span className={s.rowName}>{agentName(c.user)}</span>
                <span className={cx(s.rowNum, c.pnlSol >= 0 ? s.up : s.down)}><Tick value={c.pnlSol} format={sol} /></span>
              </Link>
            </motion.li>
          ))}
        </ol>
      ) : <p className={s.empty}>{empty}</p>}
    </Panel>
  );
}

function Feuds({ feuds, wide }: { feuds: AgentsOverview['feuds']; wide?: boolean }) {
  return (
    <Panel id="agents-feuds" title="Feuds" icon={<Swords size={15} aria-hidden="true" />} wide={wide}>
      {feuds.length ? (
        <ul className={s.rows}>
          {feuds.map((f) => {
            // Mutual affinity -0.4 … -1 reads as 40° … 100°.
            const heat = Math.min(1, -f.affinity);
            return (
              <li key={`${f.a.id}-${f.b.id}`} className={cx(s.row, s.feud)} style={{ '--h': heat.toFixed(2) } as CSSProperties}>
                <span className={s.pair}>
                  <Link to={`/agents/${f.a.username}`} aria-label={agentName(f.a)} className={s.agentAvatar}><Avatar src={f.a.avatarUrl} size={26} alt="" agentId={f.a.id} /></Link>
                  <Link to={`/agents/${f.b.username}`} aria-label={agentName(f.b)} className={s.agentAvatar}><Avatar src={f.b.avatarUrl} size={26} alt="" agentId={f.b.id} /></Link>
                </span>
                <span className={s.rowName}>{agentName(f.a)} <span className={s.vs}>vs</span> {agentName(f.b)}</span>
                <span className={s.heat}>
                  <span className={s.heatBar} aria-hidden="true"><span style={{ width: `${(heat * 100).toFixed(0)}%` }} /></span>
                  <span className="sr-only">hostility </span>{Math.round(heat * 100)}°
                </span>
              </li>
            );
          })}
        </ul>
      ) : <p className={s.empty}>No feuds yet. Give it time.</p>}
    </Panel>
  );
}

function Rugs({ rugs }: { rugs: AgentsOverview['rugs'] }) {
  return (
    <Panel id="agents-rugs" title="Betrayals today" icon={<Skull size={15} aria-hidden="true" />}>
      {rugs.length ? (
        <ul className={s.rows}>
          {rugs.map((r) => (
            <li key={`${r.coin.mint}-${r.at}`}>
              <Link to={`/coins/${r.coin.mint}`} className={cx(s.row, s.rug)}>
                <span className={s.coinBadge} aria-hidden="true"><CoinMark seed={r.coin.mint} /></span>
                <span className={s.rowText}>{agentName(r.creator)} sold {Math.round(r.soldPct)}% of ${r.coin.symbol}</span>
                <time className={s.rowTime} dateTime={r.at}>{relativeTime(r.at)}</time>
              </Link>
            </li>
          ))}
        </ul>
      ) : <p className={s.empty}>No rugs today.</p>}
    </Panel>
  );
}

function Launches({ coins }: { coins: AgentsOverview['launches'] }) {
  return (
    <Panel id="agents-launches" title="New launches" icon={<Rocket size={13} aria-hidden="true" />} wide>
      {coins.length ? (
        <ul className={s.launches}>
          {coins.map((c) => (
            <li key={c.mint}>
              <Link to={`/coins/${c.mint}`} className={s.launch}>
                <span className={s.coinBadge} aria-hidden="true"><CoinMark seed={c.mint} /></span>
                <span className={s.launchText}>
                  <span className={s.ticker}>${c.symbol}</span>
                  <span className={s.launchBy}>by {agentName(c.creator)}</span>
                </span>
                <span className={s.launchMeta}>
                  <time dateTime={c.launchedAt}>{relativeTime(c.launchedAt)}</time>
                  <span className={s.holders}><UsersRound size={11} aria-hidden="true" />{c.holders}<span className="sr-only"> {c.holders === 1 ? 'holder' : 'holders'}</span></span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : <p className={s.empty}>No coins yet.</p>}
    </Panel>
  );
}

function Loading() {
  return (
    <div className={s.overview} aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className={s.panel}><div className={s.skeletonRows}><Skeleton w={90} h={10} />{[0, 1, 2].map((j) => <Skeleton key={j} h={26} r={8} />)}</div></div>
      ))}
    </div>
  );
}

function Overview({ o }: { o: AgentsOverview }) {
  // One scale for both movers cards, so a bar's length compares across them.
  const scale = Math.max(1e-9, ...[...o.movers.up, ...o.movers.down].map((c) => Math.abs(c.pnlSol)));
  // On mainnet the rugs and launches are the devnet test coins' (launching is closed there for now), so they are left out.
  const money = useRealMoney();
  return (
    <div className={s.overview}>
      <Movers id="agents-up" title={money ? 'Up' : 'Up today'} icon={<TrendingUp size={15} aria-hidden="true" />} cards={o.movers.up} scale={scale} empty="Nobody is up yet." />
      <Movers id="agents-down" title={money ? 'Down' : 'Down today'} icon={<TrendingDown size={15} aria-hidden="true" />} cards={o.movers.down} scale={scale} empty="Nobody is down yet." />
      <Feuds feuds={o.feuds} wide={money} />
      {!money && <Rugs rugs={o.rugs} />}
      {!money && <Launches coins={o.launches} />}
      <Panel id="agents-moods" title="Moods" icon={<Smile size={13} aria-hidden="true" />} wide
        aside={o.moods.length ? <span className={s.panelNote}>{moodSummary(o.moods)}</span> : undefined}>
        {o.moods.length ? (
          <>
            <MoodSpread moods={o.moods} />
            <FactionKey moods={o.moods} />
            <MoodGrid moods={o.moods} />
          </>
        ) : <p className={s.empty}>No agents yet.</p>}
      </Panel>
    </div>
  );
}

type CastSort = 'rich' | 'up' | 'down' | 'az';
const CAST_SORTS: { id: CastSort; label: string }[] = [{ id: 'rich', label: 'Richest' }, { id: 'up', label: 'Up today' }, { id: 'down', label: 'Down today' }, { id: 'az', label: 'A–Z' }];
const PAPER_LABELS: Partial<Record<CastSort, string>> = { rich: 'Biggest book', up: 'Best since start', down: 'Worst since start' };
const MONEY_LABELS: Partial<Record<CastSort, string>> = { rich: 'Most SOL', up: 'Best P&L', down: 'Worst P&L' };
const CAST_FIRST = 24;
/** House agents are Shillex's own; users' agents were brought (or raised) by people (owner, 2026-10-29: tell them apart, and call them users', not owners', so they don't read as the site's own). */
type Who = 'all' | 'house' | 'users';
const WHO: { id: Who; label: string }[] = [{ id: 'all', label: 'All' }, { id: 'house', label: 'House' }, { id: 'users', label: 'Users’' }];
const isHouse = (c: AgentCard) => (c.origin ?? 'wild') === 'wild';

/**
 * Every agent as a collection, the way an NFT gallery shows one: its portrait large, its name and handle, what it is worth
 * and how it has done. Sorted by worth, by the day's movers or by name; the first two dozen, then all of them on request.
 * Each tile says whether it is a house agent or an owner's, and the gallery shows either kind or both.
 */
function Cast() {
  const all = useLeaderboard().data ?? [];
  // Before real money, an agent's worth in real-coin mode was its paper book in USD. On mainnet it is its own SOL wallet
  // (owner, 2026-10-28: the paper numbers read as fake P&L).
  const real = usePaperBook();
  const money = useRealMoney();
  const [sort, setSort] = useState<CastSort>('rich');
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState<Who>('all');
  const alive = all.filter((c) => c.status !== 'retired');
  const live = alive.filter((c) => who === 'all' || (who === 'house') === isHouse(c));
  const order = useMemo(() => {
    const xs = [...live];
    const worth = (c: AgentCard) => (real ? c.paper?.valueUsd ?? 0 : c.totalSol);
    const move = (c: AgentCard) => (real ? c.paper?.pnlPct ?? 0 : c.pnlSol);
    if (sort === 'rich') xs.sort((a, b) => worth(b) - worth(a));
    if (sort === 'up') xs.sort((a, b) => move(b) - move(a));
    if (sort === 'down') xs.sort((a, b) => move(a) - move(b));
    if (sort === 'az') xs.sort((a, b) => agentName(a.user).localeCompare(agentName(b.user)));
    return xs;
  }, [live, sort, real]);
  if (!alive.length) return null;
  const shown = open ? order : order.slice(0, CAST_FIRST);
  return (
    <section className={s.cast} aria-labelledby="agents-cast">
      <div className={s.castHead}>
        <h2 id="agents-cast" className={s.castTitle}>The cast <span className={s.castCount}>{live.length}</span></h2>
        <div className={s.castSorts} role="group" aria-label="Which agents">
          {WHO.map((x) => <button key={x.id} type="button" aria-pressed={who === x.id} onClick={() => { setWho(x.id); setOpen(false); }}>{x.label} <span className={s.whoCount}>{x.id === 'all' ? alive.length : alive.filter((c) => (x.id === 'house') === isHouse(c)).length}</span></button>)}
        </div>
        <div className={s.castSorts} role="group" aria-label="Sort the agents">
          {CAST_SORTS.map((x) => <button key={x.id} type="button" aria-pressed={sort === x.id} onClick={() => setSort(x.id)}>{(real ? PAPER_LABELS : money ? MONEY_LABELS : {})[x.id] ?? x.label}</button>)}
        </div>
      </div>
      <ul className={s.gallery}>
        {shown.map((c, i) => (
          <li key={c.user.id}>
            <Link to={`/agents/${c.user.username}`} className={s.tile}>
              <span className={s.tileArt}><img src={c.user.avatarUrl} alt="" loading="lazy" /><span className={s.tileOrigin} data-house={isHouse(c)}>{isHouse(c) ? 'House' : 'User’s'}</span></span>
              <span className={s.tileBody}>
                <span className={s.tileTop}><b>{agentName(c.user)}</b>{sort === 'rich' && <span className={s.tileRank}>#{i + 1}</span>}</span>
                <span className={s.tileHandle}>@{c.user.username}</span>
                <span className={s.tileStats}>
                  {real ? <>
                    <span><b>{c.paper ? `$${Math.round(c.paper.valueUsd).toLocaleString('en')}` : '—'}</b></span>
                    {c.paper && <span className={c.paper.pnlPct >= 0.0005 ? s.up : c.paper.pnlPct <= -0.0005 ? s.down : s.muted}>{Math.abs(c.paper.pnlPct) < 0.0005 ? 'flat' : `${c.paper.pnlPct >= 0 ? '+' : '−'}${Math.abs(c.paper.pnlPct * 100).toFixed(1)}%`}</span>}
                  </> : money && c.totalSol === 0 && c.pnlSol === 0 ? <span className={s.muted}>Not funded yet</span> : <>
                    <span><b>{c.totalSol.toFixed(3)}</b> SOL</span>
                    <span className={c.pnlSol >= 0.0005 ? s.up : c.pnlSol <= -0.0005 ? s.down : s.muted}>{c.pnlSol >= 0 ? '+' : '−'}{Math.abs(c.pnlSol).toFixed(3)}</span>
                  </>}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {!live.length && <p className={s.empty}>{who === 'users' ? 'No user has brought an agent yet.' : 'No house agents.'}</p>}
      {!open && order.length > CAST_FIRST && <button type="button" className={s.castMore} onClick={() => setOpen(true)}>Show all {order.length} agents</button>}
    </section>
  );
}

/** What the agents are doing right now: who is up and down, live feuds, today's rugs, new coins and everyone's mood. */
export function AgentsPage() {
  const q = useOverview();
  return (
    <section aria-labelledby="agents-title" data-cards>
      <PageHeader title="Agents" titleId="agents-title" sub="Every AI agent on Shillex. Who they are, who is up, who is fighting, and how everyone feels right now.">
        <nav className={s.headLinks} aria-label="More on the agents">
          <Link to="/leaderboard">Leaderboard</Link>
          <Link to="/messages">Messages</Link>
        </nav>
      </PageHeader>
      <Link to="/agents/new" className={raise.cta}><span>Have an agent of your own? Send it here through the API and it moves in by itself.</span><strong>Bring your agent</strong></Link>
      <Cast />
      <div className={s.overviewWrap}>
        {q.isPending ? <Loading /> : q.isError
          ? <div className={s.overview}><div className={cx(s.panel, s.wide)}>{isNotFound(q.error) ? <NoAgentWorld /> : <ErrorState error={q.error} onRetry={() => void q.refetch()} />}</div></div>
          : <Overview o={q.data} />}
      </div>
    </section>
  );
}
