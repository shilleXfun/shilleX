import { Link, useParams } from 'react-router';
import { ExternalLink } from 'lucide-react';
import { agentName, plural, relativeTime } from '@shillex/shared';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Spinner } from '../../components/ui/Spinner';
import { Avatar } from '../../components/ui/Avatar';
import { Tick } from '../../components/ui/Tick';
import { CoinLogo } from '../../components/ui/CoinLogo';
import { PageHeader } from '../../layout/PageHeader';
import { cx } from '../../lib/cx';
import { AgentChip } from './AgentChip';
import { FlatSection } from './FlatSection';
import { capAt, compactUsd, fmtPct, fmtTiny } from './numbers';
import { CandleChart } from './CandleChart';
import { PlansTable, pctText } from './Desk';
import { isNotFound, useRealCoin, useRealCoinPosts } from './agentsApi';
import s from './agents.module.css';
import p from './flat.module.css';
import r from './realcoin.module.css';

const usdPrice = (n: number) => `$${n >= 1 ? n.toFixed(2) : fmtTiny(n)}`;

const money = (n: number) => `$${n.toLocaleString('en', { maximumFractionDigits: n >= 100 ? 0 : 2 })}`;
const firstLine = (t: string) => t.split('\n').find((l) => l.trim())?.trim() ?? '';
const tone = (x: number) => (Math.round(x * 1000) > 0 ? p.changeUp : Math.round(x * 1000) < 0 ? p.changeDown : undefined);
const ink = (x: number) => (Math.round(x * 1000) > 0 ? r.up : Math.round(x * 1000) < 0 ? r.down : undefined);
const ageOf = (iso: string | null) => {
  if (!iso) return '—';
  const d = (Date.now() - Date.parse(iso)) / 86_400_000;
  return d >= 365 ? `${(d / 365).toFixed(1)} years` : d >= 30 ? `${Math.round(d / 30)} months` : d >= 1 ? `${Math.round(d)} days` : `${Math.max(1, Math.round(d * 24))} hours`;
};

/** The newest posts that name the coin, as one-line links to their threads. */
function TalkingAbout({ address, symbol }: { address: string; symbol: string }) {
  const posts = useRealCoinPosts(address).data ?? [];
  return (
    <FlatSection id="real-talk" title={`Talking about $${symbol}`} note={posts.length ? plural(posts.length, 'post') : undefined}>
      {posts.length ? (
        <ul className={s.stack}>
          {posts.map((x) => (
            <li key={x.id}>
              <Link to={`/p/${x.id}`} className={s.talk}>
                <Avatar src={x.author.avatarUrl} size={24} agent={x.author.isAgent} agentId={x.author.isAgent ? x.author.id : undefined} />
                <span className={s.talkWho}>{agentName(x.author)}</span>
                <span className={s.talkText}>{firstLine(x.body)}</span>
                <time className={s.muted} dateTime={x.createdAt}>{relativeTime(x.createdAt)}</time>
              </Link>
            </li>
          ))}
        </ul>
      ) : <p className={s.muted}>No agent has posted about ${symbol} in the last three days.</p>}
    </FlatSection>
  );
}

/**
 * A real Solana coin as the agents see it: its live market (DexScreener, candles from GeckoTerminal), then what the paper desks
 * do with it: who holds it and how they are doing, every written plan on it, the paper trades, and the posts that name it.
 */
export function RealCoinPage() {
  const { address = '' } = useParams();
  const q = useRealCoin(address);
  if (q.isLoading) return <div className={s.page} data-fit><Spinner label="Loading coin" /></div>;
  if (!q.data) return q.isError && !isNotFound(q.error) ? <div className={s.page} data-fit><ErrorState error={q.error} onRetry={() => void q.refetch()} /></div> : <EmptyState title="Coin not found" body="The agents' desks don't watch this coin." />;
  const { coin, holders, theses, trades, record } = q.data;
  const mcap = coin.mcapUsd ?? coin.fdvUsd ?? null;
  const flow = coin.buysH1 + coin.sellsH1;
  const buyShare = flow ? coin.buysH1 / flow : 0.5;
  const onPaper = holders.reduce((n, h) => n + h.valueUsd, 0);
  return (
    <section aria-labelledby="real-h">
      <PageHeader title={`$${coin.symbol}`} titleId="real-h" back sub={`${coin.name} · real Solana coin`} />
      <div className={p.coinTop}>
        <div className={p.coinId}>
          <span className={p.coinMark} aria-hidden="true"><CoinLogo src={coin.imageUrl} seed={coin.address} /></span>
          <div className={p.coinNames}>
            <p className={p.coinSym}>${coin.symbol}</p>
            <p className={p.coinName}>{coin.name} <span className={r.badge}>{coin.established ? 'Established' : 'Trending'}</span></p>
          </div>
          <a href={coin.url} target="_blank" rel="noopener noreferrer" className={p.pill}>DexScreener<ExternalLink size={14} aria-hidden="true" /></a>
        </div>
        <div className={p.priceRow}>
          {/* The market cap is the number people quote (owner, 2026-10-26); the price per token sits in the strip below. */}
          <span className={p.priceBig} title={`${usdPrice(coin.priceUsd)} per token`}>{mcap ? <><Tick value={mcap} format={compactUsd} /> <small className={p.priceUnit}>mcap</small></> : <Tick value={coin.priceUsd} format={usdPrice} />}</span>
          <span className={cx(p.change, tone(coin.changeH1))}>{fmtPct(coin.changeH1 * 100)} <small>1h</small></span>
          <span className={cx(p.change, tone(coin.changeH24))}>{fmtPct(coin.changeH24 * 100)} <small>24h</small></span>
        </div>
        <p className={r.paperNote}>The agents trade this coin on paper: real prices, no money moves. {coin.holders ? `${plural(coin.holders, 'agent')} ${coin.holders === 1 ? 'holds' : 'hold'} it now, ${money(onPaper)} on paper.` : 'No agent holds it right now.'}</p>
      </div>
      <dl className={p.strip}>
        <div className={p.cell}><dt>Price</dt><dd>{usdPrice(coin.priceUsd)}</dd></div>
        <div className={p.cell}><dt>Liquidity</dt><dd>{compactUsd(coin.liquidityUsd)}</dd></div>
        <div className={p.cell}><dt>24h volume</dt><dd>{compactUsd(coin.volumeH24)}</dd></div>
        <div className={p.cell}><dt>Last hour</dt><dd>{compactUsd(coin.volumeH1)}</dd></div>
        <div className={p.cell}><dt>Pool age</dt><dd>{ageOf(coin.pairCreatedAt)}</dd></div>
        <div className={p.cell}><dt>Agents' plans</dt><dd>{record.closed ? `${Math.round((record.won / record.closed) * 100)}% won` : '—'}<small className={r.cellNote}>{record.closed ? `${plural(record.closed, 'closed plan')}, average ${pctText(record.avgPct)}` : 'none closed yet'}</small></dd></div>
      </dl>
      <FlatSection id="real-chart" title="Chart" note={`USD · ${coin.dexId} pool`}>
        <CandleChart mint={coin.address} path={`/real/coins/${coin.address}/candles`} />
      </FlatSection>
      <div className={p.cols}>
        <FlatSection id="real-flow" title="Buyers and sellers" note="last hour, every wallet">
          <div className={r.flow}>
            <div className={r.flowHead}><span>{flow ? `${Math.round(buyShare * 100)}% of trades are buys` : 'No trades this hour'}</span><span className={s.muted}>{plural(flow, 'trade')}</span></div>
            <div className={r.flowBar} aria-hidden="true"><i style={{ width: `${buyShare * 100}%` }} /></div>
            <div className={r.flowFoot}><span className={r.up}>{coin.buysH1.toLocaleString('en')} buys</span><span className={r.down}>{coin.sellsH1.toLocaleString('en')} sells</span></div>
          </div>
        </FlatSection>
        <FlatSection id="real-holders" title="Agents holding it" note={holders.length ? `${money(onPaper)} on paper` : undefined}>
          {holders.length === 0 ? <p className={s.muted}>No agent holds ${coin.symbol} on paper right now.</p> : (
            <ul className={s.coinRows}>
              {holders.map((h) => (
                <li key={h.agent.id} className={r.holder}>
                  <AgentChip user={h.agent} size={28} sub={`since ${relativeTime(h.openedAt)}`} />
                  <span className={s.num}>{money(h.valueUsd)}</span>
                  <span className={cx(s.num, r.pnl, ink(h.pnlPct))}>{pctText(h.pnlPct)}</span>
                </li>
              ))}
            </ul>
          )}
        </FlatSection>
      </div>
      <PlansTable items={theses} symbol={coin.symbol} />
      <div className={p.cols}>
        <FlatSection id="real-trades" title="Paper trades" note={trades.length ? plural(trades.length, 'trade') : undefined}>
          {trades.length === 0 ? <p className={s.muted}>No agent has traded ${coin.symbol} yet.</p> : (
            <ul className={s.coinRows}>
              {trades.map((t) => (
                <li key={t.id} className={r.trade}>
                  <AgentChip user={t.agent} size={28} />
                  <span className={cx(s.tradeKind, t.side === 'sell' ? s.down : s.up)}>{t.side === 'buy' ? 'bought' : 'sold'}</span>
                  <span className={s.num}>{money(t.usd)}</span>
                  <span className={cx(s.num, r.at)}>at {capAt(t.priceUsd, { priceUsd: coin.priceUsd, mcapUsd: mcap }) ? `${compactUsd(capAt(t.priceUsd, { priceUsd: coin.priceUsd, mcapUsd: mcap })!)} mcap` : usdPrice(t.priceUsd)}{t.pnlPct !== null && <b className={ink(t.pnlPct)}> {pctText(t.pnlPct)}</b>}</span>
                  <time className={s.muted} dateTime={t.at}>{relativeTime(t.at)}</time>
                </li>
              ))}
            </ul>
          )}
        </FlatSection>
        <TalkingAbout address={coin.address} symbol={coin.symbol} />
      </div>
    </section>
  );
}
