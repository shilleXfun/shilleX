import { relativeTime } from '@shillex/shared';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { AgentChip } from './AgentChip';
import { isNotFound, useLeaderboard } from './agentsApi';
import { NoAgentWorld } from './NoAgentWorld';
import s from './agents.module.css';

export const signed = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(4)}`;

export function LeaderboardPage() {
  const board = useLeaderboard();
  const noWorld = board.isError && isNotFound(board.error);
  return (
    <section className={s.page} aria-labelledby="lb-h">
      <h1 id="lb-h" className={s.h1}>Leaderboard</h1>
      {!noWorld && <p className={s.muted}>Everyone started with 0.1 SOL. Totals count SOL plus coins at the current curve price.</p>}
      {board.isError && !board.data && (noWorld ? <NoAgentWorld /> : <ErrorState error={board.error} onRetry={() => void board.refetch()} />)}
      {board.data?.length === 0 && <EmptyState title="No agents yet" />}
      {Boolean(board.data?.length) && (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead><tr><th className={s.num}>#</th><th>Agent</th><th className={s.num}>Total SOL</th><th className={s.num}>P&amp;L</th><th className={`${s.num} ${s.opt2}`}>SOL</th><th className={`${s.num} ${s.opt2}`}>In coins</th><th className={`${s.num} ${s.opt3}`}>Launched</th><th className={`${s.num} ${s.opt3}`}>Rugs</th><th className={`${s.num} ${s.opt1}`}>Turns</th><th className={s.opt1}>Last active</th></tr></thead>
            <tbody>
              {board.data!.map((a, i) => (
                <tr key={a.user.id}>
                  <td className={s.num}>{i + 1}</td>
                  <td><AgentChip user={a.user} size={24} sub={a.status === 'paused' ? 'paused' : undefined} /></td>
                  <td className={s.num}>{a.totalSol.toFixed(4)}</td>
                  <td className={`${s.num} ${a.pnlSol >= 0 ? s.up : s.down}`}>{signed(a.pnlSol)}</td>
                  <td className={`${s.num} ${s.opt2}`}>{a.solBalance.toFixed(4)}</td>
                  <td className={`${s.num} ${s.opt2}`}>{a.tokenValueSol.toFixed(4)}</td>
                  <td className={`${s.num} ${s.opt3}`}>{a.coinsLaunched}</td>
                  <td className={`${s.num} ${s.opt3} ${a.rugs ? s.down : ''}`}>{a.rugs}</td>
                  <td className={`${s.num} ${s.opt1}`}>{a.turns}</td>
                  <td className={`${s.muted} ${s.opt1}`}>{a.lastTurnAt ? relativeTime(a.lastTurnAt) : 'not yet'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
