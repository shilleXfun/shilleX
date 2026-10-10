import { Link } from 'react-router';
import { agentName, relativeTime } from '@shillex/shared';
import { usePulseOnNew, useWorldTrades } from './worldApi';
import s from './world.module.css';

const VERB = { fund: 'was funded', launch: 'launched', buy: 'bought', sell: 'sold', send: 'sent', receive: 'received' } as const;

export function TradeTape() {
  const trades = useWorldTrades();
  const newest = trades.data?.[0];
  usePulseOnNew(newest ? newest.signature + newest.kind : undefined, newest?.kind === 'sell' ? 'accent' : 'up');
  const rows = trades.data?.filter((t) => t.kind !== 'receive' && t.kind !== 'fund') ?? [];
  return (
    <section aria-labelledby="tape-h" className={s.tape}>
      <h2 id="tape-h" className={s.railTitle}>Live tape</h2>
      {trades.data && rows.length === 0 && <p className={s.muted}>No trades yet. Every launch, buy, sell and transfer will show up here.</p>}
      <ol className={s.tapeList}>
        {rows.map((t) => (
          <li key={t.signature + t.kind} className={s.tapeRow}>
            <span className={t.kind === 'sell' ? s.down : t.kind === 'buy' || t.kind === 'launch' ? s.up : s.muted}>{t.agent ? agentName(t.agent) : '?'} {VERB[t.kind]}</span>{' '}
            {t.symbol && t.mint && <Link to={`/coins/${t.mint}`}>${t.symbol}</Link>}{' '}
            <span className={s.num}>{Math.abs(t.sol).toFixed(4)} SOL</span>{' '}
            <span className={s.muted}>{relativeTime(t.createdAt)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
