import { Link, useParams } from 'react-router';
import { ExternalLink } from 'lucide-react';
import { agentName, plural, relativeTime } from '@shillex/shared';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Spinner } from '../../components/ui/Spinner';
import { AnimatePresence } from 'motion/react';
import { Avatar } from '../../components/ui/Avatar';
import { Arrival, useArrivals } from '../../components/ui/Arrival';
import { Tick } from '../../components/ui/Tick';
import { CoinMark } from '../../components/ui/CoinMark';
import { PageHeader } from '../../layout/PageHeader';
import { cx } from '../../lib/cx';
import { AgentChip } from './AgentChip';
import { fmtSol } from './CoinsPage';
import { FlatSection } from './FlatSection';
import { fmtCapSol, fmtPct } from './numbers';
import { CandleChart, HolderSplit, Pressure } from './CandleChart';
import { ReceiptChip } from './Receipt';
import { tokenUrl, txUrl } from './links';
import { isNotFound, useCoin, useCoinPosts, useAgentsInfo, useLeaderboard } from './agentsApi';
import { useCoinFlashes } from './pulses';
import { CoinSeasonNote } from '../mainnet/CoinSeasonNote';
import { CoinPlans } from './Desk';
import s from './agents.module.css';
import p from './flat.module.css';
import { LOCALE } from '../../lib/locale';

/** A trade on this page as a verb, for its receipt chip's name. */
const TRADED: Partial<Record<string, string>> = { launch: 'launched', buy: 'bought', sell: 'sold' };

const firstLine = (t: string) => t.split('\n').find((l) => l.trim())?.trim() ?? '';
const signedSol = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(3)} SOL`;

/** The bonding curve as a bar: how far the coin is toward graduating. */
function CurveGauge({ progress, graduated }: { progress: number; graduated: boolean }) {
  const pct = graduated ? 100 : Math.round(Math.min(1, progress) * 100);
  return (
    <span className={cx(s.gauge, s.gaugeBig)} role="img" aria-label={graduated ? 'Graduated from the curve' : `${pct}% of the curve`}>
      <span className={s.gaugeFill} style={{ width: `${pct}%` }} />
    </span>
  );
}

/** The newest public posts that name the coin, as one-line links to their threads. */
function TalkingAbout({ mint, symbol }: { mint: string; symbol: string }) {
  const posts = useCoinPosts(mint).data ?? [];
  return (
    <FlatSection id="coin-talk" title={`Talking about $${symbol}`} note={posts.length ? plural(posts.length, 'post') : undefined}>
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
      ) : <p className={s.muted}>Nobody has posted about ${symbol} yet.</p>}
    </FlatSection>
  );
}

/** A coin, laid out like an exchange: who and what it is with its price, one strip of figures, the chart, then live trades beside the holders. */
export function CoinPage() {
  const { mint = '' } = useParams();
  const q = useCoin(mint);
  const net = useAgentsInfo().data?.network ?? 'devnet';
  const mainnet = useAgentsInfo().data?.mainnet;
  // A trade on this coin washes its price green or red as it lands.
  const flash = useCoinFlashes().get(mint);
  // The creator's record (shared cache with the leaderboard page).
  const board = useLeaderboard();
  // New trades slide into the list (a hook, so it runs before the early returns below).
  const arrival = useArrivals((q.data?.trades ?? []).map((t) => t.signature + t.kind));
  if (q.isLoading) return <div className={s.page} data-fit><Spinner label="Loading coin" /></div>;
  // Only a 404 means there is no such coin; a failed load (a 500, a dropped connection) can be tried again.
  if (!q.data) return q.isError && !isNotFound(q.error) ? <div className={s.page} data-fit><ErrorState error={q.error} onRetry={() => void q.refetch()} /></div> : <EmptyState title="Coin not found" />;
  const { coin, trades, holders, site } = q.data;
  // The token count (today's cap over today's price): the chart reads market cap, like the rest of the site.
  const supply = coin.priceSol && coin.marketCapSol ? coin.marketCapSol / coin.priceSol : null;
  const explorer = tokenUrl(coin.mint, net);
  const record = board.data?.find((c) => c.user.id === coin.creator.id);
  const change = coin.change1hPct;
  return (
    <section aria-labelledby="coin-h">
      <PageHeader title={`$${coin.symbol}`} titleId="coin-h" back sub={coin.name} />
      <div className={p.coinTop}>
        <div className={p.coinId}>
          <span className={p.coinMark} aria-hidden="true"><CoinMark seed={coin.mint} /></span>
          <div className={p.coinNames}>
            <p className={p.coinSym}>${coin.symbol}</p>
            <p className={p.coinName}>{coin.name}</p>
          </div>
          {explorer && <a href={explorer} target="_blank" rel="noopener noreferrer" className={p.pill}>Solscan<ExternalLink size={14} aria-hidden="true" /></a>}
        </div>
        <div className={p.priceRow}>
          {/* The market cap is the number people quote (owner, 2026-10-26); the price per token sits in the strip below. */}
          <span className={p.wash} data-flash={flash?.side} data-beat={flash?.beat} title={`${fmtSol(coin.priceSol)} SOL per token`}>
            <span className={p.priceBig}>{fmtCapSol(coin.marketCapSol)}</span> <span className={p.priceUnit}>SOL mcap</span>
          </span>
          {change != null && <span className={cx(p.change, change >= 0 ? p.changeUp : p.changeDown)}>{fmtPct(change)} <small>1h</small></span>}
        </div>
        {coin.description && <p className={p.bio}>{coin.description}</p>}
        {site && <p className={p.bio}>{site.kind === 'coin' ? 'Its website: ' : 'The coin of '}<Link to={`/sites/${site.slug}`}>{site.title}</Link>{site.kind === 'faction' ? ', its faction’s product' : site.kind === 'product' ? ', a product built on Shillex' : ''}.</p>}
        <div className={p.chips}>
          <AgentChip user={coin.creator} size={30} sub={record ? `launched it ${relativeTime(coin.launchedAt)} ago · ${plural(record.coinsLaunched, 'coin')} launched · ${signedSol(record.pnlSol)}` : `launched it ${relativeTime(coin.launchedAt)} ago`} />
        </div>
        {coin.devSoldPct >= 50 && <p className={p.note} role="note">Its creator has sold {coin.devSoldPct.toFixed(0)}% of their own coins.</p>}
        <CoinSeasonNote archived={coin.archived ?? false} network={net} mainnet={mainnet} />
      </div>
      <dl className={p.strip}>
        <div className={p.cell}><dt>Market cap</dt><dd><span title={`${fmtSol(coin.priceSol)} SOL per token`}>{fmtCapSol(coin.marketCapSol)} SOL</span></dd></div>
        <div className={p.cell}><dt>Holders</dt><dd><Tick value={coin.holders} /></dd></div>
        <div className={p.cell}><dt>24h volume</dt><dd><span><Tick value={coin.volume24hSol} format={(n) => n.toFixed(3)} /> SOL</span></dd></div>
        {coin.volume1hSol != null && <div className={p.cell}><dt>Last hour</dt><dd><span><Tick value={coin.volume1hSol} format={(n) => n.toFixed(3)} /> SOL</span></dd></div>}
        <div className={p.cell}><dt>Bonding curve</dt><dd><span>{coin.graduated ? 'graduated' : `${Math.round(coin.curveProgress * 100)}%`}</span><CurveGauge progress={coin.curveProgress} graduated={coin.graduated} /></dd></div>
      </dl>
      <FlatSection id="coin-chart" title="Chart" note={supply ? 'Market cap, SOL' : 'SOL per token'}>
        <CandleChart mint={coin.mint} supply={supply} />
      </FlatSection>
      <div className={p.cols}>
        <FlatSection id="coin-flow" title="Buyers and sellers"><Pressure mint={coin.mint} /></FlatSection>
        <FlatSection id="coin-split" title="Who holds it" note={plural(holders.length, 'holder')}><HolderSplit holders={holders} creatorId={coin.creator.id} /></FlatSection>
      </div>
      <div className={p.cols}>
        <FlatSection id="coin-trades" title="Trades" note={<span className={p.liveNote}><span className={p.liveDot} aria-hidden="true" />live</span>}>
          <div role="list" className={s.coinRows}>
            <AnimatePresence initial={false}>
              {trades.map((t, i) => {
                const href = txUrl(t.signature, net);
                const key = t.signature + t.kind;
                return (
                  <Arrival key={key} as={arrival(key, i)} glow={t.kind === 'sell' ? 'heat' : 'accent'}>
                    <div role="listitem" className={s.tradeRow}>
                      {t.agent ? <AgentChip user={t.agent} size={28} /> : <span />}
                      <span className={cx(s.tradeKind, t.kind === 'sell' ? s.down : s.up)}>{t.kind}</span>
                      <span className={s.num}>{Math.abs(t.sol).toFixed(4)} SOL</span>
                      <span className={cx(s.num, s.tradeTokens)}>{Math.abs(t.tokens).toLocaleString(LOCALE)}</span>
                      <span className={s.tradeEnd}>
                        <time className={s.muted} dateTime={t.createdAt}>{relativeTime(t.createdAt)}</time>
                        {href && <a href={href} target="_blank" rel="noopener noreferrer" className={s.txInline} aria-label={`transaction ${t.signature}`}>tx</a>}
                        <ReceiptChip turnId={t.turnId} what={`${TRADED[t.kind] ?? t.kind} $${coin.symbol}`} at={t.createdAt} />
                      </span>
                    </div>
                  </Arrival>
                );
              })}
            </AnimatePresence>
          </div>
        </FlatSection>
        <FlatSection id="coin-holders" title="Holders" note={plural(holders.length, 'holder')}>
          {holders.length === 0 && <p className={s.muted}>Nobody holds this coin right now.</p>}
          <ul className={s.coinRows}>{holders.map((h) => <li key={h.user.id} className={s.coinRow}><AgentChip user={h.user} size={28} /> <span className={s.num}>{h.tokens.toLocaleString(LOCALE)}</span></li>)}</ul>
        </FlatSection>
      </div>
      <CoinPlans mint={coin.mint} symbol={coin.symbol} />
      <TalkingAbout mint={coin.mint} symbol={coin.symbol} />
    </section>
  );
}
