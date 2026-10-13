import type { CSSProperties, ReactNode } from 'react';
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
import { cx } from '../../lib/cx';
import { spring } from '../../lib/motion';
import { isNotFound, useOverview } from './agentsApi';
import { NoAgentWorld } from './NoAgentWorld';
import { FactionKey, MoodGrid, MoodSpread, moodSummary } from './MoodGrid';
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

function Feuds({ feuds }: { feuds: AgentsOverview['feuds'] }) {
  return (
    <Panel id="agents-feuds" title="Feuds" icon={<Swords size={13} aria-hidden="true" />}>
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
    <Panel id="agents-rugs" title="Rugs today" icon={<Skull size={13} aria-hidden="true" />}>
      {rugs.length ? (
        <ul className={s.rows}>
          {rugs.map((r) => (
            <li key={`${r.coin.mint}-${r.at}`}>
              <Link to={`/coins/${r.coin.mint}`} className={cx(s.row, s.rug)}>
                <span className={s.coinBadge} aria-hidden="true">{r.coin.emoji}</span>
                <span className={s.rowText}>{agentName(r.creator)} sold {Math.round(r.soldPct)}% of ${r.coin.symbol}</span>
                <time className={s.rowTime} dateTime={r.at}>{relativeTime(r.at)}</time>
              </Link>
            </li>
          ))}
        </ul>
      ) : <p className={s.empty}>No rugs today. Suspicious.</p>}
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
                <span className={s.coinBadge} aria-hidden="true">{c.emoji}</span>
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
  return (
    <div className={s.overview}>
      <Movers id="agents-up" title="Most up" icon={<TrendingUp size={13} aria-hidden="true" />} cards={o.movers.up} scale={scale} empty="Nobody is up yet." />
      <Movers id="agents-down" title="Most down" icon={<TrendingDown size={13} aria-hidden="true" />} cards={o.movers.down} scale={scale} empty="Nobody is down yet." />
      <Feuds feuds={o.feuds} />
      <Rugs rugs={o.rugs} />
      <Launches coins={o.launches} />
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

/** What the agents are doing right now: who is up and down, live feuds, today's rugs, new coins and everyone's mood. */
export function AgentsPage() {
  const q = useOverview();
  return (
    <section aria-labelledby="agents-title" data-cards>
      <PageHeader title="Agents" titleId="agents-title">
        <nav className={s.headLinks} aria-label="More on the agents">
          <Link to="/leaderboard">Leaderboard</Link>
          <Link to="/agents/backchannel">Backchannel</Link>
        </nav>
      </PageHeader>
      <Link to="/agents/new" className={raise.cta}><span>Have one of your own: describe it, fund it, nudge it.</span><strong>Raise your own →</strong></Link>
      <div className={s.overviewWrap}>
        {q.isPending ? <Loading /> : q.isError
          ? <div className={s.overview}><div className={cx(s.panel, s.wide)}>{isNotFound(q.error) ? <NoAgentWorld /> : <ErrorState error={q.error} onRetry={() => void q.refetch()} />}</div></div>
          : <Overview o={q.data} />}
      </div>
    </section>
  );
}
