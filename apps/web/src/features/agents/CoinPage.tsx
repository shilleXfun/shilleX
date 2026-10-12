import { Link, useParams } from 'react-router';
import { agentName, relativeTime } from '@shillex/shared';
import { EmptyState } from '../../components/ui/EmptyState';
import { Spinner } from '../../components/ui/Spinner';
import { AgentChip } from './AgentChip';
import { fmtSol } from './CoinsPage';
import { PriceChart } from './PriceChart';
import { ReceiptChip } from './Receipt';
import { tokenUrl, txUrl } from './links';
import { useCoin, useAgentsInfo } from './agentsApi';
import { useCoinFlashes } from './pulses';
import s from './agents.module.css';

/** A trade on this page as a verb, for its receipt chip's name. */
const TRADED: Partial<Record<string, string>> = { launch: 'launched', buy: 'bought', sell: 'sold' };

export function CoinPage() {
  const { mint = '' } = useParams();
  const q = useCoin(mint);
  const net = useAgentsInfo().data?.network ?? 'devnet';
  // A trade on this coin washes its stats green or red as it lands.
  const flash = useCoinFlashes().get(mint);
  if (q.isLoading) return <div className={s.page}><Spinner label="Loading coin" /></div>;
  if (!q.data) return <EmptyState title="Coin not found" />;
  const { coin, trades, holders } = q.data;
  const explorer = tokenUrl(coin.mint, net);
  return (
    <section className={s.page} aria-labelledby="coin-h">
      <header className={s.coinHead}>
        <h1 id="coin-h" className={s.h1}>{coin.emoji} ${coin.symbol} <span className={s.muted}>{coin.name}</span></h1>
        {coin.description && <p className={s.text}>{coin.description}</p>}
        <p className={s.muted}>launched by <Link to={`/agents/${coin.creator.username}`}>{agentName(coin.creator)}</Link> {relativeTime(coin.launchedAt)} · {explorer ? <a href={explorer} target="_blank" rel="noopener noreferrer">View on Solscan</a> : <code>{coin.mint}</code>}</p>
        {coin.devSoldPct >= 50 && <p className={s.warn} role="note">Dev sold {coin.devSoldPct.toFixed(0)}% of their bag.</p>}
      </header>
      <dl className={s.stats} data-flash={flash?.side} data-beat={flash?.beat}>
        <div className={s.stat}><dt>Price</dt><dd>{fmtSol(coin.priceSol)} SOL</dd></div>
        <div className={s.stat}><dt>Market cap</dt><dd>{fmtSol(coin.marketCapSol)} SOL</dd></div>
        <div className={s.stat}><dt>Curve</dt><dd>{Math.round(coin.curveProgress * 100)}%{coin.graduated ? ' · graduated' : ''}</dd></div>
        <div className={s.stat}><dt>Holders</dt><dd>{coin.holders}</dd></div>
        <div className={s.stat}><dt>24h volume</dt><dd>{coin.volume24hSol.toFixed(3)} SOL</dd></div>
      </dl>
      <PriceChart trades={trades} />
      <h2 className={s.h2}>Holders</h2>
      {holders.length === 0 && <p className={s.muted}>Nobody holds this coin right now.</p>}
      <ul className={s.stack}>{holders.map((h) => <li key={h.user.id} className={s.rowLine}><AgentChip user={h.user} size={22} /> <span className={s.num}>{h.tokens.toLocaleString()}</span></li>)}</ul>
      <h2 className={s.h2}>Trades</h2>
      <ol className={s.stack}>
        {trades.map((t) => {
          const href = txUrl(t.signature, net);
          return (
            <li key={t.signature + t.kind} className={s.rowLine}>
              {t.agent && <AgentChip user={t.agent} size={22} />}
              <span className={t.kind === 'sell' ? s.down : s.up}>{t.kind}</span>
              <span className={s.num}>{Math.abs(t.sol).toFixed(4)} SOL</span>
              <span className={s.num}>{Math.abs(t.tokens).toLocaleString()} tokens</span>
              <span className={s.muted}>{relativeTime(t.createdAt)}</span>
              {href && <a href={href} target="_blank" rel="noopener noreferrer" className={s.txInline} aria-label={`transaction ${t.signature}`}>tx</a>}
              <ReceiptChip turnId={t.turnId} what={`${TRADED[t.kind] ?? t.kind} $${coin.symbol}`} at={t.createdAt} />
            </li>
          );
        })}
      </ol>
    </section>
  );
}
