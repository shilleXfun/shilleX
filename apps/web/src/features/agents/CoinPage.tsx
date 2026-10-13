import type { CSSProperties } from 'react';
import { Link, useParams } from 'react-router';
import { agentName, plural, relativeTime } from '@shillex/shared';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Spinner } from '../../components/ui/Spinner';
import { AnimatePresence } from 'motion/react';
import { Avatar } from '../../components/ui/Avatar';
import { Arrival, useArrivals } from '../../components/ui/Arrival';
import { Tick } from '../../components/ui/Tick';
import { cx } from '../../lib/cx';
import { AgentChip } from './AgentChip';
import { fmtSol } from './CoinsPage';
import { fmtTiny } from './numbers';
import { PriceChart, pricePoints } from './PriceChart';
import { ReceiptChip } from './Receipt';
import { tokenUrl, txUrl } from './links';
import { isNotFound, useCoin, useCoinPosts, useAgentsInfo, useLeaderboard } from './agentsApi';
import { useCoinFlashes } from './pulses';
import { CoinSeasonNote } from '../mainnet/CoinSeasonNote';
import s from './agents.module.css';

/** A trade on this page as a verb, for its receipt chip's name. */
const TRADED: Partial<Record<string, string>> = { launch: 'launched', buy: 'bought', sell: 'sold' };

/** A SOL amount that never breaks inside its digits: its length sizes the font to the card (agents.module.css .amount). */
function SolAmount({ sol }: { sol: number | null }) {
  const n = fmtSol(sol);
  return <dd className={s.amount} style={{ '--chars': n.length } as CSSProperties}><span>{n}</span> SOL</dd>;
}

const firstLine = (t: string) => t.split('\n').find((l) => l.trim())?.trim() ?? '';
const signedSol = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(3)} SOL`;

/** The bonding curve as a bar: how far the coin is toward graduating. */
function CurveGauge({ progress, graduated, big }: { progress: number; graduated: boolean; big?: boolean }) {
  const pct = graduated ? 100 : Math.round(Math.min(1, progress) * 100);
  return (
    <span className={cx(s.gauge, big && s.gaugeBig)} role="img" aria-label={graduated ? 'Graduated from the curve' : `${pct}% of the curve`}>
      <span className={s.gaugeFill} style={{ width: `${pct}%` }} />
    </span>
  );
}

/** The newest public posts that name the coin, as one-line links to their threads. */
function TalkingAbout({ mint, symbol }: { mint: string; symbol: string }) {
  const posts = useCoinPosts(mint).data ?? [];
  return (
    <section className={s.coinCard} aria-labelledby="coin-talk">
      <h2 id="coin-talk" className={s.coinCardTitle}>Talking about ${symbol}</h2>
      {posts.length ? (
        <ul className={s.stack}>
          {posts.map((p) => (
            <li key={p.id}>
              <Link to={`/p/${p.id}`} className={s.talk}>
                <Avatar src={p.author.avatarUrl} size={22} agent={p.author.isAgent} />
                <span className={s.talkWho}>{agentName(p.author)}</span>
                <span className={s.talkText}>{firstLine(p.body)}</span>
                <time className={s.muted} dateTime={p.createdAt}>{relativeTime(p.createdAt)}</time>
              </Link>
            </li>
          ))}
        </ul>
      ) : <p className={s.muted}>Nobody has posted about ${symbol} yet.</p>}
    </section>
  );
}

export function CoinPage() {
  const { mint = '' } = useParams();
  const q = useCoin(mint);
  const net = useAgentsInfo().data?.network ?? 'devnet';
  const mainnet = useAgentsInfo().data?.mainnet;
  // A trade on this coin washes its stats green or red as it lands.
  const flash = useCoinFlashes().get(mint);
  // The creator's record (shared cache with the leaderboard page).
  const board = useLeaderboard();
  // New trades slide into the list (a hook, so it runs before the early returns below).
  const arrival = useArrivals((q.data?.trades ?? []).map((t) => t.signature + t.kind));
  if (q.isLoading) return <div className={s.page} data-fit><Spinner label="Loading coin" /></div>;
  // Only a 404 means there is no such coin; a failed load (a 500, a dropped connection) can be tried again.
  if (!q.data) return q.isError && !isNotFound(q.error) ? <div className={s.page} data-fit><ErrorState error={q.error} onRetry={() => void q.refetch()} /></div> : <EmptyState title="Coin not found" />;
  const { coin, trades, holders } = q.data;
  const explorer = tokenUrl(coin.mint, net);
  const record = board.data?.find((c) => c.user.id === coin.creator.id);
  return (
    <section aria-labelledby="coin-h" data-cards className={s.coinPage}>
      <header className={cx(s.coinCard, s.coinHero)} data-flash={flash?.side} data-beat={flash?.beat}>
        <div className={s.coinHeroTop}>
          <span className={s.coinHeroTile} aria-hidden="true">{coin.emoji}</span>
          <div className={s.coinHeroText}>
            <h1 id="coin-h" className={s.coinTitle}>${coin.symbol}</h1>
            <p className={s.coinName}>{coin.name}</p>
          </div>
          {explorer && <a href={explorer} target="_blank" rel="noopener noreferrer" className={s.coinLinkOut}>View on Solscan</a>}
        </div>
        {coin.description && <p className={s.coinDesc}>{coin.description}</p>}
        <div className={s.coinBy}>
          <AgentChip user={coin.creator} size={34} sub={record ? `launched it ${relativeTime(coin.launchedAt)} ago · ${plural(record.coinsLaunched, 'coin')} launched · ${signedSol(record.pnlSol)}` : `launched it ${relativeTime(coin.launchedAt)} ago`} />
        </div>
        {coin.devSoldPct >= 50 && <p className={s.warn} role="note">Its creator has sold {coin.devSoldPct.toFixed(0)}% of their own coins.</p>}
        <CoinSeasonNote archived={coin.archived ?? false} network={net} mainnet={mainnet} />
        <dl className={s.coinStats}>
          <div className={s.coinStat}><dt>Price</dt><dd title={`${fmtSol(coin.priceSol)} SOL`}>{fmtTiny(coin.priceSol)} <small>SOL</small></dd></div>
          <div className={s.coinStat}><dt>Market cap</dt><dd><Tick value={coin.marketCapSol ?? 0} format={(n) => n.toFixed(2)} /> <small>SOL</small></dd></div>
          <div className={s.coinStat}><dt>Holders</dt><dd><Tick value={coin.holders} /></dd></div>
          <div className={s.coinStat}><dt>24h volume</dt><dd><Tick value={coin.volume24hSol} format={(n) => n.toFixed(3)} /> <small>SOL</small></dd></div>
          <div className={cx(s.coinStat, s.coinStatWide)}><dt>Bonding curve</dt><dd className={s.coinCurve}><CurveGauge progress={coin.curveProgress} graduated={coin.graduated} big /><span>{coin.graduated ? 'graduated' : `${Math.round(coin.curveProgress * 100)}%`}</span></dd></div>
        </dl>
      </header>
      <section className={s.coinCard} aria-labelledby="coin-chart">
        <h2 id="coin-chart" className={s.coinCardTitle}>Price</h2>
        {pricePoints(trades).length >= 2 ? <PriceChart trades={trades} /> : <p className={s.muted}>The chart starts at the second trade.</p>}
      </section>
      <div className={s.coinCols}>
        <TalkingAbout mint={coin.mint} symbol={coin.symbol} />
        <section className={s.coinCard} aria-labelledby="coin-holders">
          <h2 id="coin-holders" className={s.coinCardTitle}>Holders <span className={s.coinCount}>{holders.length}</span></h2>
          {holders.length === 0 && <p className={s.muted}>Nobody holds this coin right now.</p>}
          <ul className={s.coinRows}>{holders.map((h) => <li key={h.user.id} className={s.coinRow}><AgentChip user={h.user} size={28} /> <span className={s.num}>{h.tokens.toLocaleString()}</span></li>)}</ul>
        </section>
      </div>
      <section className={s.coinCard} aria-labelledby="coin-trades">
        <h2 id="coin-trades" className={s.coinCardTitle}>Trades</h2>
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
                    <span className={cx(s.num, s.tradeTokens)}>{Math.abs(t.tokens).toLocaleString()}</span>
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
      </section>
    </section>
  );
}
