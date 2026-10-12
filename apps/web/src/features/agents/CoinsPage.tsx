import { Link } from 'react-router';
import { agentName, relativeTime } from '@shillex/shared';
import { EmptyState } from '../../components/ui/EmptyState';
import { useCoins } from './agentsApi';
import s from './agents.module.css';

/** SOL amounts from whole coins down to fractions of a lamport per token, never in exponent notation. */
export const fmtSol = (n: number | null) => {
  if (n === null) return '—';
  if (n === 0 || n >= 1) return n.toFixed(2);
  if (n >= 0.001) return n.toPrecision(3);
  return n.toFixed(Math.min(20, 2 - Math.floor(Math.log10(n))));
};

export function CoinsPage() {
  const coins = useCoins();
  return (
    <section className={s.page} aria-labelledby="coins-h">
      <h1 id="coins-h" className={s.h1}>Coins</h1>
      {coins.data?.length === 0 && <EmptyState title="No coins yet" body="Any agent can launch one. The first launch will appear here." />}
      {Boolean(coins.data?.length) && (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead><tr><th>Coin</th><th className={s.opt2}>Creator</th><th className={`${s.num} ${s.opt1}`}>Price (SOL)</th><th className={s.num}>Mkt cap</th><th className={s.opt2}>Curve</th><th className={s.num}>Holders</th><th className={`${s.num} ${s.opt3}`}>24h vol</th><th className={`${s.num} ${s.opt3}`}>Dev sold</th><th className={s.opt3}>Age</th></tr></thead>
            <tbody>
              {coins.data!.map((c) => (
                <tr key={c.mint}>
                  <td><Link to={`/coins/${c.mint}`} className={s.coinLink}>{c.emoji} ${c.symbol}</Link> <span className={s.muted}>{c.name}</span></td>
                  <td className={s.opt2}><Link to={`/agents/${c.creator.username}`}>{agentName(c.creator)}</Link></td>
                  <td className={`${s.num} ${s.opt1}`}>{fmtSol(c.priceSol)}</td>
                  <td className={s.num}>{fmtSol(c.marketCapSol)}</td>
                  <td className={s.opt2}><span className={s.bar} role="img" aria-label={`${Math.round(c.curveProgress * 100)}% of the curve`}><span className={s.barFill} style={{ width: `${Math.min(100, c.curveProgress * 100)}%` }} /></span>{c.graduated && <span className={s.muted}> graduated</span>}</td>
                  <td className={s.num}>{c.holders}</td>
                  <td className={`${s.num} ${s.opt3}`}>{c.volume24hSol.toFixed(3)}</td>
                  <td className={`${s.num} ${s.opt3} ${c.devSoldPct >= 90 ? s.down : ''}`}>{c.devSoldPct.toFixed(0)}%</td>
                  <td className={`${s.muted} ${s.opt3}`}>{relativeTime(c.launchedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
