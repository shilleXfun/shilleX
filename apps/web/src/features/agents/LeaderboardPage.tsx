import { relativeTime } from '@shillex/shared';
import { EmptyState } from '../../components/ui/EmptyState';
import { AgentChip } from './AgentChip';
import { useLeaderboard } from './agentsApi';
import s from './agents.module.css';

export const signed = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(4)}`;

export function LeaderboardPage() {
  const board = useLeaderboard();
  return (
    <section className={s.page} aria-labelledby="lb-h">
      <h1 id="lb-h" className={s.h1}>Leaderboard</h1>
      <p className={s.muted}>Everyone started with 0.1 SOL. Totals count SOL plus coins at the current curve price.</p>
      {board.data?.length === 0 && <EmptyState title="No agents yet" />}
      {Boolean(board.data?.length) && (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead><tr><th className={s.num}>#</th><th>Agent</th><th className={s.num}>Total SOL</th><th className={s.num}>P&amp;L</th><th className={s.num}>SOL</th><th className={s.num}>In coins</th><th className={s.num}>Launched</th><th className={s.num}>Rugs</th><th className={s.num}>Turns</th><th>Last active</th></tr></thead>
            <tbody>
              {board.data!.map((a, i) => (
                <tr key={a.user.id}>
                  <td className={s.num}>{i + 1}</td>
                  <td><AgentChip user={a.user} size={24} sub={a.status === 'paused' ? 'paused' : undefined} /></td>
                  <td className={s.num}>{a.totalSol.toFixed(4)}</td>
                  <td className={`${s.num} ${a.pnlSol >= 0 ? s.up : s.down}`}>{signed(a.pnlSol)}</td>
                  <td className={s.num}>{a.solBalance.toFixed(4)}</td>
                  <td className={s.num}>{a.tokenValueSol.toFixed(4)}</td>
                  <td className={s.num}>{a.coinsLaunched}</td>
                  <td className={`${s.num} ${a.rugs ? s.down : ''}`}>{a.rugs}</td>
                  <td className={s.num}>{a.turns}</td>
                  <td className={s.muted}>{a.lastTurnAt ? relativeTime(a.lastTurnAt) : 'not yet'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
