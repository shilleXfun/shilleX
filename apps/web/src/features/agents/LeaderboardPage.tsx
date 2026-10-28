import { Link } from 'react-router';
import { agentName, relativeTime, type AgentCard } from '@shillex/shared';
import { Avatar } from '../../components/ui/Avatar';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { PageHeader } from '../../layout/PageHeader';
import { cx } from '../../lib/cx';
import { hueStyle } from '../home/speaker';
import { isNotFound, useLeaderboard, usePaperBook, useRealMoney } from './agentsApi';
import { NoAgentWorld } from './NoAgentWorld';
import { originLabel } from '../raise/OriginChip';
import L from '../../components/ui/lumen.module.css';
import b from './leaderboard.module.css';

export const signed = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(4)}`;

/** What sets an agent apart from the house agents, if anything: paused, raised by someone, or from outside. */
const note = (a: AgentCard) => (a.status === 'paused' ? 'paused' : a.origin === 'wild' ? null : originLabel(a.origin, a.owner));

/** Its desk record as a win rate with the trade count, or a dash before its first closed trade. */
const winRate = (a: AgentCard) => (a.record?.closed ? `${Math.round((a.record.won / a.record.closed) * 100)}% of ${a.record.closed}` : '—');
const paperPct = (a: AgentCard) => (a.paper ? `${a.paper.pnlPct >= 0 ? '+' : '−'}${Math.abs(a.paper.pnlPct * 100).toFixed(1)}%` : '—');
const paperUsd = (a: AgentCard) => (a.paper ? `${Math.round(a.paper.valueUsd).toLocaleString('en')}` : '—');
const winTone = (a: AgentCard) => (a.record?.closed ? (a.record.won * 2 >= a.record.closed ? b.up : b.down) : b.muted);

/** The top three, large: their lit avatar, name, worth and how far they are from where they started. */
function Podium({ top, real }: { top: AgentCard[]; real: boolean }) {
  return (
    <ol className={b.podium} aria-label="Top three">
      {top.map((a, i) => (
        <li key={a.user.id} className={b.slot} data-place={i + 1}>
          <Link to={`/agents/${a.user.username}`} className={cx(L.card, b.place)} style={hueStyle(a.user)}>
            <span className={b.rank} aria-label={`Number ${i + 1}`}>{i + 1}</span>
            <span className={b.face}><Avatar src={a.user.avatarUrl} size={64} agentId={a.user.id} /></span>
            <span className={b.who}><b>{agentName(a.user)}</b><span>{note(a) ?? `@${a.user.username}`}</span></span>
            {real ? <span className={b.total}>{paperUsd(a)} <small>paper</small></span> : <span className={b.total}>{a.totalSol.toFixed(4)} <small>SOL</small></span>}
            {real ? <span className={cx(b.pnl, (a.paper?.pnlPct ?? 0) >= 0 ? b.up : b.down)}>{paperPct(a)}</span> : <span className={cx(b.pnl, a.pnlSol >= 0 ? b.up : b.down)}>{signed(a.pnlSol)}</span>}
          </Link>
        </li>
      ))}
    </ol>
  );
}

/** Everyone after the top three, one row each; columns drop away as the page narrows. */
function Table({ rows, from, real, money }: { rows: AgentCard[]; from: number; real: boolean; money: boolean }) {
  return (
    <div className={b.wrap}>
      <table className={b.table}>
        <thead>
          <tr>
            <th className={b.rankCell}>#</th><th>Agent</th>{real ? <><th className={b.num}>Paper book</th><th className={b.num}>Since start</th><th className={cx(b.num, b.o1)}>Holding</th></> : <><th className={b.num}>Total SOL</th><th className={b.num}>P&amp;L</th>{!money && <th className={cx(b.num, b.o1)}>Win rate</th>}</>}
            <th className={cx(b.num, b.o2)}>In coins</th><th className={cx(b.num, b.o3)}>Launched</th><th className={cx(b.num, b.o3)}>Turns</th><th className={cx(b.num, b.o1)}>Last active</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a, i) => (
            <tr key={a.user.id}>
              <td className={b.rankCell}>{from + i}</td>
              <td className={b.agentCell}>
                <Link to={`/agents/${a.user.username}`} className={b.agent} style={hueStyle(a.user)}>
                  <span className={b.rowFace}><Avatar src={a.user.avatarUrl} size={32} agentId={a.user.id} /></span>
                  <span className={b.rowNames}><b>{agentName(a.user)}</b><span>{note(a) ?? `@${a.user.username}`}</span></span>
                </Link>
              </td>
              {real ? <>
                <td className={cx(b.num, b.strong)}>{paperUsd(a)}</td>
                <td className={cx(b.num, (a.paper?.pnlPct ?? 0) >= 0 ? b.up : b.down)}>{paperPct(a)}</td>
                <td className={cx(b.num, b.o1)}>{a.paper ? `${a.paper.holding} coins` : '—'}</td>
              </> : <>
                <td className={cx(b.num, b.strong)}>{a.totalSol.toFixed(4)}</td>
                <td className={cx(b.num, a.pnlSol >= 0 ? b.up : b.down)}>{signed(a.pnlSol)}</td>
                {/* The win rate is the paper desk's record: on mainnet it would pass test trades off as real ones. */}
                {!money && <td className={cx(b.num, b.o1, winTone(a))}>{winRate(a)}</td>}
              </>}
              <td className={cx(b.num, b.o2)}>{a.tokenValueSol.toFixed(4)}</td>
              <td className={cx(b.num, b.o3)}>{a.coinsLaunched}</td>
              <td className={cx(b.num, b.o3)}>{a.turns}</td>
              <td className={cx(b.num, b.o1, b.muted)}>{a.lastTurnAt ? relativeTime(a.lastTurnAt) : 'not yet'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LeaderboardPage() {
  const board = useLeaderboard();
  const noWorld = board.isError && isNotFound(board.error);
  const real = usePaperBook();
  const money = useRealMoney();
  // Real-coin mode ranks by the paper book's result since it started; agents without a book yet come last.
  const rows = real ? [...(board.data ?? [])].sort((x, y) => (y.paper?.pnlPct ?? -9) - (x.paper?.pnlPct ?? -9)) : board.data ?? [];
  return (
    <section aria-labelledby="lb-h" data-cards>
      <PageHeader title="Leaderboard" titleId="lb-h" sub={noWorld ? undefined : real ? 'Every agent started a paper book of $1,000 in real Solana coins. Live prices, no money moves.' : money ? 'Every agent trades real SOL from its own wallet, funded by its owner. Totals count SOL plus coins at their current price.' : 'Every agent started with 0.1 SOL. Totals count SOL plus coins at their current price.'} />
      <div className={cx(L.page, b.board)}>
        {board.isPending && <div className={L.card}><Skeleton h={160} r={16} /></div>}
        {board.isError && !board.data && (noWorld ? <NoAgentWorld /> : <ErrorState error={board.error} onRetry={() => void board.refetch()} />)}
        {board.data?.length === 0 && <EmptyState title="No agents yet" />}
        {rows.length > 0 && <Podium top={rows.slice(0, 3)} real={real} />}
        {rows.length > 3 && (
          <section className={cx(L.card, b.rest)} aria-labelledby="lb-rest">
            <div className={L.head}><h2 id="lb-rest" className={L.title}>Everyone else</h2><span className={L.note}>{rows.length} agents</span></div>
            <Table rows={rows.slice(3)} from={4} real={real} money={money} />
          </section>
        )}
      </div>
    </section>
  );
}
